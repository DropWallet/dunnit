import { NextRequest, NextResponse } from "next/server";
import { getSteamClient } from "@/lib/steam/client";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import { getDataAccess } from "@/lib/data/access";
import { ApiErrors } from "@/lib/utils/api-errors";
import {
  groupAchievementsIntoSessions,
  filterSessionsByCooldown,
  createSessionFromPlaytime,
  type AchievementRow,
  type FeedSession,
} from "@/lib/utils/feed-sessions";
import {
  getStaleFriends,
  syncFriendsInBackground,
} from "@/lib/utils/friend-sync";

// Cooldown period: sessions only appear 30 minutes after completion
// This prevents showing incomplete or rapidly changing data, and allows
// achievement sessions to be properly grouped together (30-minute merge window)
const COOLDOWN_MINUTES = 30;
const MAX_LOOKBACK_DAYS = 14;
const DEFAULT_LIMIT = 20;
const SYNC_TIMEOUT_MS = 5000; // 5 second timeout for friend syncs

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable ISR caching

/**
 * Sync friends for feed - runs BEFORE querying sessions to ensure feed is populated
 * This fixes the timing issue where feed queries sessions before syncs complete
 */
async function syncFriendsForFeed(
  friendSteamIds: string[],
  steamId: string,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  dataAccess: ReturnType<typeof getDataAccess>,
  now: Date
): Promise<void> {
  // FIX 2: Sync-on-Read: Sync stale friends who have recently played games (within 14 days)
  // Also sync friends who haven't been synced recently or have no games in user_games
  // This fixes the chicken-and-egg problem where friends with no games in DB aren't synced
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  // Step 1: Query user_games to find friends with recently played games
  // Query all friends' games and filter in JavaScript (more reliable than complex SQL OR)
  const { data: allFriendsGamesData, error: gamesQueryError } = await supabase
    .from('user_games')
    .select('user_id, last_played, derived_last_played')
    .in('user_id', friendSteamIds);
  
  if (gamesQueryError) {
    console.error('[Feed] Error querying user_games for recently played games:', gamesQueryError);
  }
  
  // Extract unique friend IDs who have recently played games
  // Check both last_played and derived_last_played
  const friendsWithRecentPlaytime = new Set<string>();
  const friendsWithGamesInDb = new Set<string>();
  if (allFriendsGamesData) {
    allFriendsGamesData.forEach((game: any) => {
      friendsWithGamesInDb.add(game.user_id);
      const lastPlayed = game.last_played ? new Date(game.last_played) : null;
      const derivedLastPlayed = game.derived_last_played ? new Date(game.derived_last_played) : null;
      
      // Check if either last_played or derived_last_played is within 14 days
      if ((lastPlayed && lastPlayed > fourteenDaysAgo) || 
          (derivedLastPlayed && derivedLastPlayed > fourteenDaysAgo)) {
        friendsWithRecentPlaytime.add(game.user_id);
      }
    });
  }
  
  // Step 2: Also check friends who haven't been synced recently or have no games in DB
  // Query users table to check lastSyncAt for all friends
  const { data: allFriendsUsers, error: usersQueryError } = await supabase
    .from('users')
    .select('steam_id, last_sync_at')
    .in('steam_id', friendSteamIds);
  
  if (usersQueryError) {
    console.error('[Feed] Error querying users for lastSyncAt:', usersQueryError);
  }
  
  // Find friends who need syncing:
  // 1. Friends with recent playtime in DB (already found above)
  // 2. Friends who haven't been synced recently (>14 days) or never synced
  const friendsNeedingSync = new Set<string>(friendsWithRecentPlaytime);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  
  if (allFriendsUsers) {
    allFriendsUsers.forEach((user: any) => {
      const lastSyncAt = user.last_sync_at ? new Date(user.last_sync_at) : null;
      const hasGamesInDb = friendsWithGamesInDb.has(user.steam_id);
      
      // Add friend if:
      // - Never synced (lastSyncAt is null), OR
      // - Last synced >14 days ago, OR
      // - Has no games in DB (first-time sync needed)
      if (!lastSyncAt || lastSyncAt < twoWeeksAgo || !hasGamesInDb) {
        friendsNeedingSync.add(user.steam_id);
      }
    });
  }
  
  // FIX #1: Include friends not in the users table (never synced before)
  // This ensures new users' friends get synced on first feed load
  const friendsInDb = new Set((allFriendsUsers || []).map((u: any) => u.steam_id));
  const friendsNotInDb = friendSteamIds.filter(id => !friendsInDb.has(id));
  
  // Add friends not in DB to sync queue
  // Limit to first 20 to prevent API overload on first sync (users with many friends)
  const MAX_FIRST_SYNC_FRIENDS = 20;
  const friendsNotInDbToSync = friendsNotInDb.slice(0, MAX_FIRST_SYNC_FRIENDS);
  
  // Limit first-sync friends to prevent API overload
  
  friendsNotInDbToSync.forEach(friendId => {
    friendsNeedingSync.add(friendId);
  });
  
  if (friendsNeedingSync.size > 0) {
    // OPTIMIZATION #5: Check last_feed_sync_attempt to prevent refresh spamming
    // Only trigger sync if last attempt was >15 minutes ago
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // Fetch last_feed_sync_attempt for all friends needing sync
    const friendsNeedingSyncArray = Array.from(friendsNeedingSync);
    const friendsToCheck = await Promise.all(
      friendsNeedingSyncArray.map(async (friendId) => {
        const friend = await dataAccess.getUser(friendId);
        return {
          friendId,
          lastFeedSyncAttempt: friend?.lastFeedSyncAttempt,
        };
      })
    );
    
    // Filter out friends who had a sync attempt within the last 15 minutes
    // BUT: Prioritize staleness over cooldown - stale friends (>2 hours) always sync
    const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    // First, identify stale friends (bypass cooldown)
    const staleFriendIds = new Set<string>();
    if (allFriendsUsers) {
      allFriendsUsers.forEach((user: any) => {
        const lastSyncAt = user.last_sync_at ? new Date(user.last_sync_at) : null;
        // Friend is stale if never synced or last sync >2 hours ago
        if (!lastSyncAt || lastSyncAt < staleThreshold) {
          staleFriendIds.add(user.steam_id);
        }
      });
    }
    // Also include friends not in DB (never synced = stale)
    friendsNotInDbToSync.forEach(friendId => staleFriendIds.add(friendId));
    
    // Filter friends: stale friends bypass cooldown, others respect 15-minute cooldown
    const friendsToSync = friendsToCheck
      .filter(f => {
        // Stale friends always sync (bypass cooldown)
        if (staleFriendIds.has(f.friendId)) {
          return true;
        }
        // Fresh friends respect 15-minute cooldown
        return !f.lastFeedSyncAttempt || f.lastFeedSyncAttempt < fifteenMinutesAgo;
      })
      .map(f => f.friendId);
    
    if (friendsToSync.length > 0) {
      // Check staleness (2 hour threshold) - sync stale friends
      // BUT ALSO sync friends with recent playtime in DB, even if not stale
      // This ensures we capture new playtime that occurred since last sync
      const staleFriends = await getStaleFriends(friendsToSync, staleThreshold);
      
      // Also include friends with recent playtime in DB (they might have new playtime since last sync)
      const friendsWithRecentPlaytimeToSync = Array.from(friendsWithRecentPlaytime).filter(friendId => 
        friendsToSync.includes(friendId)
      );
      
      // Combine stale friends and friends with recent playtime (deduplicate)
      const allFriendsToSync = Array.from(new Set([...staleFriends, ...friendsWithRecentPlaytimeToSync]));

      if (allFriendsToSync.length > 0) {
        // OPTIMIZATION #5: Update last_feed_sync_attempt for all friends we're about to sync
        // This prevents refresh spamming even if sync fails
        const updateTime = new Date();
        await Promise.allSettled(
          allFriendsToSync.map(friendId => 
            dataAccess.updateUser(friendId, { lastFeedSyncAttempt: updateTime })
          )
        );
        
        console.log(`[Feed] Syncing ${allFriendsToSync.length} friends (${staleFriends.length} stale, ${friendsWithRecentPlaytimeToSync.length} with recent playtime)`);
        
        // FIX #2: Await sync with timeout instead of fire-and-forget
        // This ensures sessions are available when we query, fixing empty feed for new users
        try {
          const syncPromise = syncFriendsInBackground(allFriendsToSync, 5); // 5 concurrent syncs
          
          // Wait for sync with timeout
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('Sync timeout')), SYNC_TIMEOUT_MS);
          });
          
          await Promise.race([syncPromise, timeoutPromise]);
        } catch (error) {
          // If timeout or error, log but continue - feed will still work with existing sessions
          // Background sync will continue to run
          if (error instanceof Error && error.message === 'Sync timeout') {
            console.log(`[Feed] ⏱️ Friend sync timed out after ${SYNC_TIMEOUT_MS}ms, continuing with existing sessions`);
          } else {
            console.error('[Feed] Friend sync failed:', error);
          }
        }
      }
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get authenticated user
    const cookies = request.cookies;
    const steamId = cookies.get("steam_id")?.value;

    if (!steamId) {
      return ApiErrors.notAuthenticated();
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const since = searchParams.get("since");
    const limit = parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const gameId = searchParams.get("gameId");
    const friendId = searchParams.get("friendId");

    // Get friend list
    const steamClient = getSteamClient();
    let friendSteamIds: string[] = [];

    try {
      friendSteamIds = await steamClient.getFriendList(steamId);
    } catch (error) {
      // Only log unexpected errors (not 401 which is expected for private profiles)
      if (error instanceof Error && !error.message.includes("401")) {
        console.error("Error fetching friend list:", error);
      }
      // If friend list fetch fails, return empty feed
      return NextResponse.json({
        sessions: [],
        pagination: {
          total: 0,
          limit,
          offset: 0,
          hasMore: false,
        },
        meta: {
          fetchedAt: new Date().toISOString(),
          friendCount: 0,
          cooldownMinutes: COOLDOWN_MINUTES,
        },
      });
    }

    // Include the logged-in user's own activity in the feed
    const targetUserIds = [steamId, ...friendSteamIds];
    
    // Apply friend filter if provided
    if (friendId) {
      if (!targetUserIds.includes(friendId)) {
        return ApiErrors.badRequest("Friend not found in your friend list");
      }
      // If filtering by friend, still include own activity
      const filteredIds = friendId === steamId ? [steamId] : [steamId, friendId];
      targetUserIds.splice(0, targetUserIds.length, ...filteredIds);
    }

    // Calculate date filters
    const now = new Date();
    const cooldownThreshold = new Date(now.getTime() - COOLDOWN_MINUTES * 60 * 1000);
    const lookbackDate = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const sinceDate = since ? new Date(since) : null;

    // LEDGER APPROACH: Initialize data access
    const supabase = getSupabaseAdmin();
    const dataAccess = getDataAccess();
    
    // FIX #2: Sync friends BEFORE querying sessions to ensure feed is populated on first load
    // This fixes the timing issue where feed queries sessions before syncs complete
    await syncFriendsForFeed(friendSteamIds, steamId, supabase, dataAccess, now);
    
    // Query achievement sessions from game_sessions (already filtered by lookback in getGameSessions)
    const allGameSessions = await dataAccess.getGameSessions(targetUserIds, 1000, 0, MAX_LOOKBACK_DAYS);
    
    // Filter by cooldown and type (only achievement sessions)
    const achievementSessionsFromDB = allGameSessions.filter(session => {
      if (session.type !== 'achievement') return false;
      return session.sessionEnd <= cooldownThreshold;
    });
    
    
    // Convert GameSession to FeedSession by fetching achievement details
    let sessions: FeedSession[] = [];
    
    if (achievementSessionsFromDB.length > 0) {
      // Get unique user IDs and app IDs for batch fetching
      const achievementUserIds = [...new Set(achievementSessionsFromDB.map(s => s.userId))];
      const achievementAppIds = [...new Set(achievementSessionsFromDB.map(s => s.appId))];
      
      // PRIVACY FIX: Fetch users first to identify private users
      const { data: usersData } = await supabase
        .from("users")
        .select("steam_id, username, avatar_url, profile_url, is_private")
        .in("steam_id", achievementUserIds);
      
      // Create map of private users
      const privateUserIds = new Set(
        (usersData || [])
          .filter((u: any) => u.is_private === true)
          .map((u: any) => u.steam_id)
      );
      
      // Filter out sessions from private users
      const publicSessions = achievementSessionsFromDB.filter(
        session => !privateUserIds.has(session.userId)
      );
      
      if (privateUserIds.size > 0) {
        console.log(`[Feed] 🔒 Filtered out ${achievementSessionsFromDB.length - publicSessions.length} sessions from ${privateUserIds.size} private users`);
      }
      
      // Only fetch data for public users
      const publicUserIds = achievementUserIds.filter(id => !privateUserIds.has(id));
      
      if (publicSessions.length > 0) {
        // Batch fetch games and achievements (only public users)
        const [gamesData, allAchievementsData] = await Promise.all([
        supabase
          .from("user_games")
          .select("user_id, app_id, name, cover_image_url, icon_url")
          .in("user_id", publicUserIds)
          .in("app_id", achievementAppIds),
        supabase
          .from("achievements")
          .select("app_id, api_name, name, description, icon_url, icon_gray_url, global_percentage, hidden")
          .in("app_id", achievementAppIds),
      ]);
      
      const usersMap = new Map(
        (usersData || [])
          .filter((u: any) => !u.is_private) // Only include public users
          .map((u: any) => [u.steam_id, u])
      );
      const gamesMap = new Map(
        (gamesData.data || []).map((g: any) => [`${g.user_id}-${g.app_id}`, g])
      );
      const achievementsMap = new Map(
        (allAchievementsData.data || []).map((ach: any) => [`${ach.app_id}-${ach.api_name}`, ach])
      );
      
      // For each public achievement session, fetch achievements within the time window
      for (const gameSession of publicSessions) {
        const userId = gameSession.userId;
        const appId = gameSession.appId;
        
        // Fetch achievements for this user/game within the session time window
        const { data: sessionAchievementsData } = await supabase
          .from("user_achievements")
          .select("user_id, app_id, achievement_api_name, unlocked_at")
          .eq("user_id", userId)
          .eq("app_id", appId)
          .eq("unlocked", true)
          .not("unlocked_at", "is", null)
          .gte("unlocked_at", gameSession.sessionStart.toISOString())
          .lte("unlocked_at", gameSession.sessionEnd.toISOString())
          .order("unlocked_at", { ascending: true });
        
        if (!sessionAchievementsData || sessionAchievementsData.length === 0) {
          continue;
        }
        
        // Transform to AchievementRow format
        const user = usersMap.get(userId);
        const game = gamesMap.get(`${userId}-${appId}`);
        
        if (!user || !game) {
          continue;
        }
        
        const achievements: AchievementRow[] = sessionAchievementsData.map((row: any) => {
          const achievement = achievementsMap.get(`${row.app_id}-${row.achievement_api_name}`);
          
          return {
            user_id: row.user_id,
            app_id: row.app_id,
            achievement_api_name: row.achievement_api_name,
            unlocked_at: new Date(row.unlocked_at),
            username: user.username,
            avatar_url: user.avatar_url,
            profile_url: user.profile_url,
            game_name: game.name,
            cover_image_url: game.cover_image_url || undefined,
            icon_url: game.icon_url || undefined,
            achievement_name: achievement?.name || "",
            description: achievement?.description || "",
            achievement_icon_url: achievement?.icon_url || "",
            achievement_icon_gray_url: achievement?.icon_gray_url || "",
            global_percentage: achievement?.global_percentage ?? undefined,
            hidden: achievement?.hidden || false,
          };
        });
        
        // Create FeedSession from achievements (reuse existing function)
        // Pass playtimeDelta from GameSession if available
        // Note: groupAchievementsIntoSessions might split into multiple sessions if there are gaps > 4 hours
        // This is fine - we'll create multiple FeedSessions from one GameSession if needed
        const playtimeDeltaMinutes = gameSession.playtimeDelta || undefined;
        const achievementSessions = groupAchievementsIntoSessions(achievements, playtimeDeltaMinutes);
        
        
        sessions.push(...achievementSessions);
      }
      
      // Apply cooldown filter (additional safety check)
      sessions = filterSessionsByCooldown(sessions, COOLDOWN_MINUTES);
      }
    }

    // LEDGER APPROACH: Query playtime sessions from game_sessions table
    // Calculate date filters
    const playtimeCooldownThreshold = new Date(now.getTime() - COOLDOWN_MINUTES * 60 * 1000);
    const playtimeLookbackDate = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    
    // Reuse the same query result instead of querying again (optimization)
    // Filter for playtime sessions from the already-fetched allGameSessions
    const gameSessions = allGameSessions;
    
    // Filter by cooldown and type (only playtime sessions)
    const playtimeSessionsFromDB = gameSessions.filter(session => {
      if (session.type !== 'playtime') return false;
      return session.sessionEnd <= playtimeCooldownThreshold;
    });
    
    
    // Enhanced deduplication: Check both sessionStart AND sessionEnd to catch duplicates
    // Pass 1: Deduplicate by (userId, appId, sessionStart) - existing logic
    const gameSessionMap = new Map<string, typeof playtimeSessionsFromDB[0]>();
    const duplicateGameSessions: typeof playtimeSessionsFromDB[0][] = [];
    
    playtimeSessionsFromDB.forEach(gameSession => {
      // Use sessionStart timestamp as key (rounded to nearest second to catch near-duplicates)
      const sessionStartTime = Math.floor(gameSession.sessionStart.getTime() / 1000) * 1000;
      const dedupKey = `${gameSession.userId}-${gameSession.appId}-${sessionStartTime}`;
      
      if (!gameSessionMap.has(dedupKey)) {
        gameSessionMap.set(dedupKey, gameSession);
      } else {
        // Found duplicate - keep the one with larger playtimeDelta
        const existing = gameSessionMap.get(dedupKey)!;
        if (gameSession.playtimeDelta > existing.playtimeDelta) {
          duplicateGameSessions.push(existing);
          gameSessionMap.set(dedupKey, gameSession);
        } else {
          duplicateGameSessions.push(gameSession);
        }
      }
    });
    
    let deduplicatedGameSessions = Array.from(gameSessionMap.values());
    console.log(`[Feed] Pass 1 deduplication (by sessionStart): ${deduplicatedGameSessions.length} unique (${duplicateGameSessions.length} duplicates removed)`);
    
    // Pass 2: Sort + Peek deduplication to catch sessions that are close in time
    // Group by (userId, appId), sort by sessionEnd, then merge adjacent sessions if they overlap or are close
    const FORTY_FIVE_MINUTES_MS = 45 * 60 * 1000; // 45 minute threshold for continuous sessions
    const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour - if sessions start more than 1 hour apart, they're separate
    const duplicateByEndTime: typeof deduplicatedGameSessions[0][] = [];
    
    // Group sessions by (userId, appId)
    const sessionsByUserAndGame = new Map<string, typeof deduplicatedGameSessions[0][]>();
    deduplicatedGameSessions.forEach(gameSession => {
      const groupKey = `${gameSession.userId}-${gameSession.appId}`;
      if (!sessionsByUserAndGame.has(groupKey)) {
        sessionsByUserAndGame.set(groupKey, []);
      }
      sessionsByUserAndGame.get(groupKey)!.push(gameSession);
    });
    
    // Process each group: sort by sessionEnd, then merge adjacent sessions
    const mergedSessions: typeof deduplicatedGameSessions[0][] = [];
    sessionsByUserAndGame.forEach((sessions, groupKey) => {
      // Sort by sessionEnd (ascending)
      const sortedSessions = [...sessions].sort((a, b) => 
        a.sessionEnd.getTime() - b.sessionEnd.getTime()
      );
      
      // Iterate through sorted sessions and merge adjacent ones
      let currentMerged: typeof deduplicatedGameSessions[0] | null = null;
      
      for (const session of sortedSessions) {
        if (currentMerged === null) {
          // First session in group - start with this one
          currentMerged = { ...session };
        } else {
          // Check if we should merge with currentMerged
          // Strict Overlap: If sessions overlap in time, always merge
          const hasOverlap = session.sessionStart < currentMerged.sessionEnd && 
                           session.sessionEnd > currentMerged.sessionStart;
          
          // Gap-based: If no overlap, check if gap is small enough and start times are close
          const gap = session.sessionStart.getTime() - currentMerged.sessionEnd.getTime();
          const startTimeDiff = Math.abs(session.sessionStart.getTime() - currentMerged.sessionStart.getTime());
          const isContinuousSession = gap >= 0 && gap < FORTY_FIVE_MINUTES_MS && startTimeDiff < ONE_HOUR_MS;
          
          if (hasOverlap || isContinuousSession) {
            // Merge: combine playtimeDelta, take earliest start, take latest end
            // TypeScript: currentMerged is guaranteed to be non-null here (we're in the else block)
            const merged: typeof deduplicatedGameSessions[0] = currentMerged!;
            currentMerged = {
              ...merged,
              playtimeDelta: merged.playtimeDelta + session.playtimeDelta,
              sessionStart: merged.sessionStart < session.sessionStart 
                ? merged.sessionStart 
                : session.sessionStart,
              sessionEnd: merged.sessionEnd > session.sessionEnd 
                ? merged.sessionEnd 
                : session.sessionEnd,
            };
            duplicateByEndTime.push(session);
          } else {
            // No merge - save currentMerged and start new one
            // TypeScript: currentMerged is guaranteed to be non-null here (we're in the else block)
            mergedSessions.push(currentMerged!);
            currentMerged = { ...session };
          }
        }
      }
      
      // Don't forget the last merged session
      if (currentMerged !== null) {
        mergedSessions.push(currentMerged);
      }
    });
    
    deduplicatedGameSessions = mergedSessions;
    console.log(`[Feed] Pass 2 deduplication (sort + peek): ${deduplicatedGameSessions.length} unique (${duplicateByEndTime.length} additional duplicates merged)`);
    console.log(`[Feed] Final deduplicated GameSessions: ${deduplicatedGameSessions.length} unique (${duplicateGameSessions.length + duplicateByEndTime.length} total duplicates removed)`);
    
    // Convert GameSession to FeedSession and check for overlapping achievement sessions
    if (deduplicatedGameSessions.length > 0) {
      const playtimeUserIds = [...new Set(deduplicatedGameSessions.map(s => s.userId))];
      const playtimeAppIds = [...new Set(deduplicatedGameSessions.map(s => s.appId))];
      
      const { data: playtimeUsersData } = await supabase
        .from('users')
        .select('steam_id, username, avatar_url, profile_url')
        .in('steam_id', playtimeUserIds);
      
      const { data: playtimeGamesData } = await supabase
        .from('user_games')
        .select('user_id, app_id, name, cover_image_url, icon_url')
        .in('user_id', playtimeUserIds)
        .in('app_id', playtimeAppIds);
      
      const playtimeUsersMap = new Map(
        (playtimeUsersData || []).map((u: any) => [u.steam_id, u])
      );
      const playtimeGamesMap = new Map(
        (playtimeGamesData || []).map((g: any) => [`${g.user_id}-${g.app_id}`, g])
      );
      
      // Convert GameSession to FeedSession and check for overlapping achievement sessions
      const playtimeSessions: FeedSession[] = [];
      
      for (const gameSession of deduplicatedGameSessions) {
        const userId = gameSession.userId;
        const appId = gameSession.appId;
        const sessionKey = `${userId}-${appId}`;
        const gameName = playtimeGamesMap.get(sessionKey)?.name || 'unknown';
        
        // Check if there's an achievement session that overlaps with this time window
        // Use refined proximity check: distance between start of one and end of the other (both ways)
        const THIRTY_MINUTES_MS = 30 * 60 * 1000;
        const hasOverlappingAchievementSession = sessions.some(session => {
          if (session.user.steamId !== userId || session.game.appId !== appId) {
            return false;
          }
          
          // 1. Check exact overlap
          const isExactOverlap = session.sessionEnd >= gameSession.sessionStart && 
                                 session.sessionStart <= gameSession.sessionEnd;
          
          // 2. Check proximity (are the sessions within 30 mins of each other?)
          // We check if the end of one is near the start of the other (both ways)
          const isClose = Math.min(
            Math.abs(session.sessionStart.getTime() - gameSession.sessionEnd.getTime()),
            Math.abs(gameSession.sessionStart.getTime() - session.sessionEnd.getTime())
          ) <= THIRTY_MINUTES_MS;
          
          return isExactOverlap || isClose;
        });
        
        if (hasOverlappingAchievementSession) {
          continue; // Skip playtime session if achievement session exists
        }
        
        // Also check for overlapping playtime sessions (same user/game)
        // This catches cases where deduplication missed sessions that are close but not within the 20-minute window
        // BUT: Only merge if sessions actually overlap or are part of the same continuous play session
        let overlappingSession: FeedSession | null = null;
        let overlapType: 'exact' | 'continuous' | null = null;
        
        const hasOverlappingPlaytimeSession = playtimeSessions.some(existingPlaytimeSession => {
          if (existingPlaytimeSession.user.steamId !== userId || existingPlaytimeSession.game.appId !== appId) {
            return false;
          }
          
          // Check for actual time overlap (strict overlap check)
          // Two intervals [a1, a2] and [b1, b2] overlap if: a1 < b2 AND b1 < a2
          const isExactOverlap = existingPlaytimeSession.sessionStart < gameSession.sessionEnd && 
                                 existingPlaytimeSession.sessionEnd > gameSession.sessionStart;
          
          // Check if they're part of the same continuous session:
          // - End within 30 minutes of each other
          // - AND start within 1 hour of each other (prevents merging separate play sessions)
          const startTimeDiff = Math.abs(existingPlaytimeSession.sessionStart.getTime() - gameSession.sessionStart.getTime());
          const endTimeDiff = Math.min(
            Math.abs(existingPlaytimeSession.sessionStart.getTime() - gameSession.sessionEnd.getTime()),
            Math.abs(gameSession.sessionStart.getTime() - existingPlaytimeSession.sessionEnd.getTime())
          );
          const ONE_HOUR_MS = 60 * 60 * 1000;
          const isContinuousSession = endTimeDiff <= THIRTY_MINUTES_MS && startTimeDiff <= ONE_HOUR_MS;
          
          if (isExactOverlap || isContinuousSession) {
            overlappingSession = existingPlaytimeSession;
            overlapType = isExactOverlap ? 'exact' : 'continuous';
            return true;
          }
          
          return false;
        });
        
        if (hasOverlappingPlaytimeSession && overlappingSession) {
          // Check if existing session is zero-duration (legacy session)
          // TypeScript: overlappingSession is guaranteed to be non-null here due to the condition check
          const existingSession: FeedSession = overlappingSession;
          const existingDuration = existingSession.sessionEnd.getTime() - existingSession.sessionStart.getTime();
          const isZeroDuration = existingDuration < 60 * 1000; // Less than 1 minute
          const newDuration = gameSession.sessionEnd.getTime() - gameSession.sessionStart.getTime();
          
          console.log(`[Feed] Overlap detected for ${userId}-${appId}: existing=${existingDuration}ms (zero=${isZeroDuration}), new=${newDuration}ms, overlapType=${overlapType}`);
          
          // If existing is zero-duration and new has actual duration, replace it
          if (isZeroDuration && newDuration >= 60 * 1000) {
            console.log(`[Feed] ✅ Replacing zero-duration session with new session for ${userId}-${appId}`);
            // Remove the zero-duration session and continue with the new one
            const index = playtimeSessions.indexOf(existingSession);
            if (index !== -1) {
              playtimeSessions.splice(index, 1);
            }
            // Continue to create the new session below
          } else {
            console.log(`[Feed] ⚠️ Skipping playtime session ${userId}-${appId} (overlaps with existing session, not zero-duration)`);
            continue; // Skip if another playtime session already exists for this time window
          }
        }
        
        const user = playtimeUsersMap.get(userId);
        const game = playtimeGamesMap.get(sessionKey);
        
        if (user && game) {
          // Sync window: sessionStart = playtimeLastSyncedAt, sessionEnd = syncTime
          const playtimeSession = createSessionFromPlaytime(
            userId,
            appId,
            gameSession.playtimeDelta,
            gameSession.sessionStart, // syncWindowStart (playtimeLastSyncedAt)
            gameSession.sessionEnd,   // syncWindowEnd (syncTime from database)
            {
              username: user.username,
              avatarUrl: user.avatar_url,
              profileUrl: user.profile_url,
            },
            {
              name: game.name,
              coverImageUrl: game.cover_image_url,
              iconUrl: game.icon_url,
            }
          );
          
          // relativeTime is already correctly calculated in createSessionFromPlaytime
          // using sessionEnd (the original sync time when the session was first created in the database)
          
          playtimeSessions.push(playtimeSession);
        }
      }
      
      // Merge playtime sessions with achievement sessions
      sessions = [...sessions, ...playtimeSessions];
    }

    // Deduplicate sessions by sessionId (in case of duplicates from multiple queries or processing)
    const sessionMap = new Map<string, FeedSession>();
    const duplicateSessionIds: string[] = [];
    sessions.forEach(session => {
      if (!sessionMap.has(session.sessionId)) {
        sessionMap.set(session.sessionId, session);
      } else {
        duplicateSessionIds.push(session.sessionId);
        console.log(`[Feed] ⚠️ Duplicate sessionId detected: ${session.sessionId} (user: ${session.user.steamId}, game: ${session.game.appId}, end: ${session.sessionEnd.toISOString()})`);
      }
    });
    sessions = Array.from(sessionMap.values());
    
    if (duplicateSessionIds.length > 0) {
      console.log(`[Feed] Deduplicated sessions: ${sessions.length} unique (${duplicateSessionIds.length} duplicates removed)`);
    }

    // Note: Friend sync now happens BEFORE querying sessions (see syncFriendsForFeed above)
    // This ensures sessions are available when building the feed, fixing empty feed for new users
    // The staleness and cooldown logic is already implemented in syncFriendsForFeed function

    // Sort by sessionEnd descending (newest first)
    sessions.sort((a, b) => b.sessionEnd.getTime() - a.sessionEnd.getTime());

    // Fetch achievement counts for each unique (user_id, app_id) combination
    // Reuse dataAccess instance declared above
    const uniqueGameKeys = new Set<string>();
    sessions.forEach(session => {
      uniqueGameKeys.add(`${session.user.steamId}-${session.game.appId}`);
    });

    // Batch fetch achievement counts
    const achievementCounts = new Map<string, { total: number; unlocked: number }>();
    
    await Promise.all(
      Array.from(uniqueGameKeys).map(async (key) => {
        const [userId, appIdStr] = key.split('-');
        const appId = parseInt(appIdStr, 10);
        
        try {
          const userAchievements = await dataAccess.getUserAchievements(userId, appId);
          const total = userAchievements.length;
          const unlocked = userAchievements.filter(a => a.unlocked).length;
          achievementCounts.set(key, { total, unlocked });
        } catch (error) {
          console.error(`[Feed] Error fetching achievement counts for ${key}:`, error);
          achievementCounts.set(key, { total: 0, unlocked: 0 });
        }
      })
    );

    // Add achievement counts to sessions
    sessions.forEach(session => {
      const key = `${session.user.steamId}-${session.game.appId}`;
      const counts = achievementCounts.get(key) || { total: 0, unlocked: 0 };
      session.totalGameAchievements = counts.total;
      session.unlockedGameAchievements = counts.unlocked;
    });

    // Apply pagination
    const total = sessions.length;
    const paginatedSessions = sessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    // Fetch like counts, comment counts, and user likes for paginated sessions
    const sessionIds = paginatedSessions.map(s => s.sessionId);
    const [likeCounts, commentCounts, userLikes] = await Promise.all([
      dataAccess.getLikeCounts(sessionIds),
      dataAccess.getCommentCounts(sessionIds),
      dataAccess.getUserLikes(sessionIds, steamId),
    ]);

    // Add like and comment data to sessions
    const sessionsWithLikes = paginatedSessions.map(session => ({
      ...session,
      likeCount: likeCounts.get(session.sessionId) || 0,
      isLiked: userLikes.has(session.sessionId),
      likedByUsers: [], // Will be populated on-demand
      commentCount: commentCounts.get(session.sessionId) || 0,
    }));

    // Sync-on-Read: Sync logged-in user's own data if stale
    // Check if user's data is stale (older than 1 hour)
    const user = await dataAccess.getUser(steamId);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isUserStale = !user?.lastSyncAt || user.lastSyncAt < oneHourAgo;

    if (isUserStale) {
      // Trigger background sync of user's games and achievements (fire-and-forget)
      // This will create new playtime and achievement sessions automatically
      const syncUserData = async () => {
        try {
          // Sync games (creates playtime sessions)
          const gamesUrl = new URL('/api/games', request.url);
          gamesUrl.searchParams.set('refresh', 'true');
          await fetch(gamesUrl.toString(), {
            method: 'GET',
            headers: {
              'Cookie': request.headers.get('Cookie') || '',
            },
          });

          // Sync achievements for recently played games (creates achievement sessions)
          // Get recently played games first
          const games = await dataAccess.getUserGames(steamId);
          const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
          const recentlyPlayedGames = games.filter(game => 
            game.lastPlayed && new Date(game.lastPlayed) > fourteenDaysAgo
          );

          // Sync achievements for recently played games (limit to first 10 to avoid too many API calls)
          const gamesToSync = recentlyPlayedGames.slice(0, 10);
          const steamClient = getSteamClient();
          
          for (const game of gamesToSync) {
            try {
              const achievementsUrl = new URL('/api/achievements', request.url);
              achievementsUrl.searchParams.set('appId', String(game.appId));
              achievementsUrl.searchParams.set('refresh', 'true');
              await fetch(achievementsUrl.toString(), {
                method: 'GET',
                headers: {
                  'Cookie': request.headers.get('Cookie') || '',
                },
              });
            } catch (error) {
              // Silently fail individual game syncs - not critical
            }
          }
        } catch (error) {
          console.error('[Feed] Background user sync failed:', error);
          // Don't throw - this is non-critical
        }
      };

      // Fire-and-forget background sync
      const syncPromise = syncUserData();
      
      // Try to use waitUntil if available (Next.js 13+)
      if (typeof (globalThis as any).waitUntil === 'function') {
        (globalThis as any).waitUntil(syncPromise);
      } else {
        // Fire-and-forget - don't await, let it run in background
        syncPromise.catch(error => {
          console.error('[Feed] Background user sync failed:', error);
          // Don't throw - this is non-critical
        });
      }
    }

    return NextResponse.json(
      {
        sessions: sessionsWithLikes,
        pagination: {
          total,
          limit,
          offset,
          hasMore,
        },
        meta: {
          fetchedAt: new Date().toISOString(),
          friendCount: friendSteamIds.length,
          cooldownMinutes: COOLDOWN_MINUTES,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", // Don't cache feed - users expect immediate updates
          "CDN-Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[Feed] Error:", error);
    return ApiErrors.internalError("Failed to fetch feed", error instanceof Error ? error.message : String(error));
  }
}

// OLD CODE REMOVED - all the old playtime detection logic has been replaced with the ledger approach
// The old code that was here has been removed. If you see references to allUserGames, allPlaytimeGamesRaw, etc.
// those were part of the old snapshot-based approach and have been replaced with queries to game_sessions table.
