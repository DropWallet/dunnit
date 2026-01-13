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

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable ISR caching

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
    
    // Debug: Check if specific user is in the list
    const DEBUG_USER_ID = '76561198024338178';
    console.log('[Playtime Detection] Target user IDs:', targetUserIds.length, 'users');
    console.log('[Playtime Detection] Looking for user', DEBUG_USER_ID + ':', targetUserIds.includes(DEBUG_USER_ID));

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

    // LEDGER APPROACH: Query achievement sessions from game_sessions table
    const supabase = getSupabaseAdmin();
    const dataAccess = getDataAccess();
    
    console.log('[Feed] Querying achievement sessions from game_sessions table...');
    console.log(`[Feed] Lookback window: ${MAX_LOOKBACK_DAYS} days, lookback date: ${lookbackDate.toISOString()}`);
    
    // Query achievement sessions from game_sessions (already filtered by lookback in getGameSessions)
    const allGameSessions = await dataAccess.getGameSessions(targetUserIds, 1000, 0, MAX_LOOKBACK_DAYS);
    console.log(`[Feed] Query returned ${allGameSessions.length} total sessions`);
    
    // Debug: Log breakdown by user and type
    const sessionBreakdown = new Map<string, { achievement: number; playtime: number }>();
    allGameSessions.forEach(s => {
      const key = s.userId;
      if (!sessionBreakdown.has(key)) {
        sessionBreakdown.set(key, { achievement: 0, playtime: 0 });
      }
      const counts = sessionBreakdown.get(key)!;
      if (s.type === 'achievement') counts.achievement++;
      if (s.type === 'playtime') counts.playtime++;
    });
    console.log(`[Feed] Session breakdown by user:`, Array.from(sessionBreakdown.entries()).map(([userId, counts]) => {
      const isOwnSession = userId === steamId;
      return `${userId.substring(0, 8)}...${isOwnSession ? ' (YOU)' : ''}: ${counts.achievement} achievement, ${counts.playtime} playtime`;
    }).join(', '));
    
    // Filter by cooldown and type (only achievement sessions)
    const achievementSessionsFromDB = allGameSessions.filter(session => {
      if (session.type !== 'achievement') return false;
      return session.sessionEnd <= cooldownThreshold;
    });
    
    console.log(`[Feed] Found ${achievementSessionsFromDB.length} achievement sessions from game_sessions (after cooldown filter)`);
    
    // Convert GameSession to FeedSession by fetching achievement details
    let sessions: FeedSession[] = [];
    
    if (achievementSessionsFromDB.length > 0) {
      // Get unique user IDs and app IDs for batch fetching
      const achievementUserIds = [...new Set(achievementSessionsFromDB.map(s => s.userId))];
      const achievementAppIds = [...new Set(achievementSessionsFromDB.map(s => s.appId))];
      
      // Batch fetch users and games
      const [usersData, gamesData, allAchievementsData] = await Promise.all([
        supabase
          .from("users")
          .select("steam_id, username, avatar_url, profile_url")
          .in("steam_id", achievementUserIds),
        supabase
          .from("user_games")
          .select("user_id, app_id, name, cover_image_url, icon_url")
          .in("user_id", achievementUserIds)
          .in("app_id", achievementAppIds),
        supabase
          .from("achievements")
          .select("app_id, api_name, name, description, icon_url, icon_gray_url, global_percentage, hidden")
          .in("app_id", achievementAppIds),
      ]);
      
      const usersMap = new Map(
        (usersData.data || []).map((u: any) => [u.steam_id, u])
      );
      const gamesMap = new Map(
        (gamesData.data || []).map((g: any) => [`${g.user_id}-${g.app_id}`, g])
      );
      const achievementsMap = new Map(
        (allAchievementsData.data || []).map((ach: any) => [`${ach.app_id}-${ach.api_name}`, ach])
      );
      
      // For each achievement session, fetch achievements within the time window
      for (const gameSession of achievementSessionsFromDB) {
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
          console.log(`[Feed] ⚠️ No achievements found for session ${userId}-${appId} in time window ${gameSession.sessionStart.toISOString()} to ${gameSession.sessionEnd.toISOString()}`);
          continue;
        }
        
        // Transform to AchievementRow format
        const user = usersMap.get(userId);
        const game = gamesMap.get(`${userId}-${appId}`);
        
        if (!user || !game) {
          console.log(`[Feed] ⚠️ Missing user or game data for session ${userId}-${appId}`);
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
        
        // Debug: Log if GameSession was split into multiple FeedSessions
        if (achievementSessions.length > 1) {
          console.log(`[Feed] ⚠️ GameSession ${gameSession.id} (${userId}-${appId}) split into ${achievementSessions.length} FeedSessions`);
        }
        
        // Debug: Log sessionIds being created
        achievementSessions.forEach(s => {
          console.log(`[Feed] Created achievement FeedSession: ${s.sessionId} (user: ${s.user.steamId}, game: ${s.game.appId}, end: ${s.sessionEnd.toISOString()})`);
        });
        
        sessions.push(...achievementSessions);
      }
      
      // Apply cooldown filter (additional safety check)
      const beforeCooldownFilter = sessions.length;
      sessions = filterSessionsByCooldown(sessions, COOLDOWN_MINUTES);
      const afterCooldownFilter = sessions.length;
      
      if (beforeCooldownFilter !== afterCooldownFilter) {
        console.log(`[Feed] Cooldown filter removed ${beforeCooldownFilter - afterCooldownFilter} sessions`);
      }
    } else {
      console.log('[Feed] No achievement sessions found in game_sessions table');
    }

    // LEDGER APPROACH: Query playtime sessions from game_sessions table
    console.log('[Feed] Querying playtime sessions from game_sessions table...');
    
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
    
    console.log(`[Feed] Found ${playtimeSessionsFromDB.length} playtime sessions from game_sessions (after cooldown filter)`);
    
    // Deduplicate GameSession records by (userId, appId, sessionStart) before converting to FeedSession
    // This prevents duplicate FeedSessions from being created
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
          console.log(`[Feed] ⚠️ Duplicate GameSession detected: ${dedupKey} (keeping delta ${gameSession.playtimeDelta}min, discarding ${existing.playtimeDelta}min, GameSession IDs: ${gameSession.id} vs ${existing.id})`);
        } else {
          duplicateGameSessions.push(gameSession);
          console.log(`[Feed] ⚠️ Duplicate GameSession detected: ${dedupKey} (keeping delta ${existing.playtimeDelta}min, discarding ${gameSession.playtimeDelta}min, GameSession IDs: ${existing.id} vs ${gameSession.id})`);
        }
      }
    });
    
    const deduplicatedGameSessions = Array.from(gameSessionMap.values());
    console.log(`[Feed] Deduplicated GameSessions: ${deduplicatedGameSessions.length} unique (${duplicateGameSessions.length} duplicates removed)`);
    
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
        
        // Debug: Log GameSession details before creating FeedSession
        const calculatedSessionStart = new Date(gameSession.sessionEnd.getTime() - Math.min(gameSession.playtimeDelta, 240) * 60 * 1000);
        const calculatedSessionId = `${userId}-${appId}-${calculatedSessionStart.getTime()}-playtime`;
        console.log(`[Feed] Processing GameSession ${gameSession.id}: userId=${userId}, appId=${appId} (${gameName}), start=${gameSession.sessionStart.toISOString()}, end=${gameSession.sessionEnd.toISOString()}, delta=${gameSession.playtimeDelta}min, calculatedSessionId=${calculatedSessionId}`);
        
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
          console.log(`[Feed] ⏭️ Skipping playtime session for ${gameName} (${appId}): overlapping achievement session found`);
          continue; // Skip playtime session if achievement session exists
        }
        
        const user = playtimeUsersMap.get(userId);
        const game = playtimeGamesMap.get(sessionKey);
        
        if (user && game) {
          const playtimeSession = createSessionFromPlaytime(
            userId,
            appId,
            gameSession.playtimeDelta,
            gameSession.sessionEnd,
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
          
          // Debug: Log playtime session creation
          console.log(`[Feed] Created playtime FeedSession: ${playtimeSession.sessionId} (user: ${userId}, game: ${appId} (${game.name}), end: ${playtimeSession.sessionEnd.toISOString()}, delta: ${gameSession.playtimeDelta}min)`);
          
          playtimeSessions.push(playtimeSession);
        } else {
          console.log(`[Feed] ⚠️ Missing user or game data for playtime session ${sessionKey} (${gameName}): user=${!!user}, game=${!!game}`);
        }
      }
      
      // Merge playtime sessions with achievement sessions
      console.log(`[Feed] Merging ${playtimeSessions.length} playtime sessions with achievement sessions`);
      sessions = [...sessions, ...playtimeSessions];
    } else {
      console.log('[Feed] No playtime sessions found in game_sessions table');
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
    console.log(`[Feed] Deduplicated sessions: ${sessions.length} unique sessions (${duplicateSessionIds.length} duplicates removed)`);
    
    // Debug: Log breakdown of final sessions by user
    const finalSessionBreakdown = new Map<string, number>();
    sessions.forEach(s => {
      const userId = s.user.steamId;
      finalSessionBreakdown.set(userId, (finalSessionBreakdown.get(userId) || 0) + 1);
    });
    console.log(`[Feed] Final session breakdown by user:`, Array.from(finalSessionBreakdown.entries()).map(([userId, count]) => {
      const isOwnSession = userId === steamId;
      return `${userId.substring(0, 8)}...${isOwnSession ? ' (YOU)' : ''}: ${count} sessions`;
    }).join(', '));
    
    // Debug: Log recent sessions (last 5) to see what's appearing
    const recentSessions = sessions.slice(0, 5);
    console.log(`[Feed] Most recent 5 sessions:`, recentSessions.map(s => 
      `${s.sessionId} - ${s.user.steamId === steamId ? 'YOU' : 'FRIEND'} - ${s.game.name} - ${s.sessionEnd.toISOString()}`
    ).join(', '));

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
      const friendsToSync = friendsToCheck
        .filter(f => !f.lastFeedSyncAttempt || f.lastFeedSyncAttempt < fifteenMinutesAgo)
        .map(f => f.friendId);
      
      if (friendsToSync.length === 0) {
        console.log(`[Feed] All ${friendsNeedingSync.size} friends needing sync had recent sync attempts (within 15 minutes), skipping to prevent refresh spamming`);
      } else {
        // Check staleness (2 hour threshold) - only sync if stale
        const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const staleFriends = await getStaleFriends(friendsToSync, staleThreshold);

        if (staleFriends.length > 0) {
          // OPTIMIZATION #5: Update last_feed_sync_attempt for all friends we're about to sync
          // This prevents refresh spamming even if sync fails
          const now = new Date();
          await Promise.allSettled(
            staleFriends.map(friendId => 
              dataAccess.updateUser(friendId, { lastFeedSyncAttempt: now })
            )
          );
          
          console.log(`[Feed] Found ${staleFriends.length} stale friends needing sync (out of ${friendsNeedingSync.size} total, ${friendsNeedingSync.size - friendsToSync.length} skipped due to recent attempts):`);
          console.log(`  - ${friendsWithRecentPlaytime.size} with recent playtime in DB`);
          console.log(`  - ${friendsNeedingSync.size - friendsWithRecentPlaytime.size} with no games in DB or old sync`);
          console.log(`  - Triggering background sync`);
          
          // Trigger background sync (fire-and-forget)
          // Use waitUntil if available (Next.js/Vercel), otherwise just fire-and-forget
          const syncPromise = syncFriendsInBackground(staleFriends, 5); // 5 concurrent syncs
          
          // Try to use waitUntil if available (Next.js 13+)
          if (typeof (globalThis as any).waitUntil === 'function') {
            (globalThis as any).waitUntil(syncPromise);
          } else {
            // Fire-and-forget - don't await, let it run in background
            syncPromise.catch(error => {
              console.error('[Feed] Background friend sync failed:', error);
              // Don't throw - this is non-critical
            });
          }
        } else {
          console.log(`[Feed] All ${friendsToSync.length} friends needing sync are fresh (synced within 2 hours)`);
        }
      }
    } else {
      console.log(`[Feed] No friends needing sync found`);
    }

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

    // Fetch like counts and user likes for paginated sessions
    const sessionIds = paginatedSessions.map(s => s.sessionId);
    const [likeCounts, userLikes] = await Promise.all([
      dataAccess.getLikeCounts(sessionIds),
      dataAccess.getUserLikes(sessionIds, steamId),
    ]);

    // Add like data to sessions
    const sessionsWithLikes = paginatedSessions.map(session => ({
      ...session,
      likeCount: likeCounts.get(session.sessionId) || 0,
      isLiked: userLikes.has(session.sessionId),
      likedByUsers: [], // Will be populated on-demand
    }));

    // Sync-on-Read: Sync logged-in user's own data if stale
    // Check if user's data is stale (older than 1 hour)
    const user = await dataAccess.getUser(steamId);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isUserStale = !user?.lastSyncAt || user.lastSyncAt < oneHourAgo;

    if (isUserStale) {
      console.log(`[Feed] User's own data is stale (lastSyncAt: ${user?.lastSyncAt?.toISOString() || 'never'}), triggering background sync`);
      
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
          
          console.log(`[Feed] Background sync of user's own data completed`);
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
    } else {
      console.log(`[Feed] User's own data is fresh (lastSyncAt: ${user?.lastSyncAt?.toISOString()})`);
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
