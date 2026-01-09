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

    // Query achievements from friends
    // Use raw SQL for complex joins (Supabase PostgREST joins can be tricky with composite keys)
    const supabase = getSupabaseAdmin();

    // Build WHERE conditions
    const conditions: string[] = [
      "ua.unlocked = true",
      "ua.unlocked_at IS NOT NULL",
      `ua.unlocked_at >= '${lookbackDate.toISOString()}'`,
      `ua.unlocked_at <= '${cooldownThreshold.toISOString()}'`,
      `ua.user_id = ANY(ARRAY[${friendSteamIds.map(id => `'${id}'`).join(',')}])`,
    ];

    if (gameId) {
      conditions.push(`ua.app_id = ${parseInt(gameId, 10)}`);
    }

    if (sinceDate) {
      conditions.push(`ua.unlocked_at >= '${sinceDate.toISOString()}'`);
    }

    const whereClause = conditions.join(" AND ");

    // Use RPC or raw query - for now, let's use multiple queries (simpler and more reliable)
    // First, get achievement unlocks
    let achievementQuery = supabase
      .from("user_achievements")
      .select("user_id, app_id, achievement_api_name, unlocked_at")
      .eq("unlocked", true)
      .not("unlocked_at", "is", null)
      .gte("unlocked_at", lookbackDate.toISOString())
      .lte("unlocked_at", cooldownThreshold.toISOString())
      .in("user_id", targetUserIds)
      .order("unlocked_at", { ascending: true });

    if (gameId) {
      achievementQuery = achievementQuery.eq("app_id", parseInt(gameId, 10));
    }

    if (sinceDate) {
      achievementQuery = achievementQuery.gte("unlocked_at", sinceDate.toISOString());
    }

    const { data: achievementData, error: achievementError } = await achievementQuery;

    if (achievementError) {
      console.error("Error fetching achievements:", achievementError);
      return ApiErrors.internalError("Failed to fetch achievements", achievementError.message);
    }

    if (!achievementData || achievementData.length === 0) {
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
          friendCount: friendSteamIds.length,
          cooldownMinutes: COOLDOWN_MINUTES,
        },
      });
    }

    // Get unique user IDs and app IDs for batch fetching
    const userIds = [...new Set(achievementData.map((a: any) => a.user_id))];
    const appIds = [...new Set(achievementData.map((a: any) => a.app_id))];
    const achievementKeys = [...new Set(
      achievementData.map((a: any) => `${a.app_id}-${a.achievement_api_name}`)
    )];

    // Batch fetch users
    const { data: usersData } = await supabase
      .from("users")
      .select("steam_id, username, avatar_url, profile_url")
      .in("steam_id", userIds);

    // Batch fetch games - get all games for these users, then filter in memory
    const { data: allGamesData } = await supabase
      .from("user_games")
      .select("user_id, app_id, name, cover_image_url, icon_url")
      .in("user_id", userIds)
      .in("app_id", appIds);

    // Filter to only games we need (composite key match)
    const neededGameKeys = new Set(
      achievementData.map((a: any) => `${a.user_id}-${a.app_id}`)
    );
    const gamesData = (allGamesData || []).filter((g: any) =>
      neededGameKeys.has(`${g.user_id}-${g.app_id}`)
    );

    // Batch fetch achievements - get all achievements for these app_ids, then filter
    const achievementAppIds = [...new Set(achievementData.map((a: any) => a.app_id))];
    const { data: allAchievementsData } = await supabase
      .from("achievements")
      .select("app_id, api_name, name, description, icon_url, icon_gray_url, global_percentage, hidden")
      .in("app_id", achievementAppIds);

    // Build map of achievements we need
    const achievementsMap = new Map<string, any>();
    const neededAchievementKeys = new Set(
      achievementData.map((a: any) => `${a.app_id}-${a.achievement_api_name}`)
    );
    (allAchievementsData || []).forEach((ach: any) => {
      const key = `${ach.app_id}-${ach.api_name}`;
      if (neededAchievementKeys.has(key)) {
        achievementsMap.set(key, ach);
      }
    });

    // Build lookup maps
    const usersMap = new Map(
      (usersData || []).map((u: any) => [u.steam_id, u])
    );
    const gamesMap2 = new Map(
      gamesData.map((g: any) => [`${g.user_id}-${g.app_id}`, g])
    );

    // Transform to AchievementRow format
    const achievements: AchievementRow[] = achievementData.map((row: any) => {
      const user = usersMap.get(row.user_id);
      const game = gamesMap2.get(`${row.user_id}-${row.app_id}`);
      const achievement = achievementsMap.get(`${row.app_id}-${row.achievement_api_name}`);

      return {
        user_id: row.user_id,
        app_id: row.app_id,
        achievement_api_name: row.achievement_api_name,
        unlocked_at: new Date(row.unlocked_at),
        username: user?.username || "",
        avatar_url: user?.avatar_url || "",
        profile_url: user?.profile_url || "",
        game_name: game?.name || "",
        cover_image_url: game?.cover_image_url || undefined,
        icon_url: game?.icon_url || undefined,
        achievement_name: achievement?.name || "",
        description: achievement?.description || "",
        achievement_icon_url: achievement?.icon_url || "",
        achievement_icon_gray_url: achievement?.icon_gray_url || "",
        global_percentage: achievement?.global_percentage ?? undefined,
        hidden: achievement?.hidden || false,
      };
    });

    if (!achievements || achievements.length === 0) {
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
          friendCount: friendSteamIds.length,
          cooldownMinutes: COOLDOWN_MINUTES,
        },
      });
    }

    // Group achievements into sessions
    let sessions = groupAchievementsIntoSessions(achievements);

    // Apply cooldown filter (additional safety check)
    sessions = filterSessionsByCooldown(sessions, COOLDOWN_MINUTES);

    // LEDGER APPROACH: Query playtime sessions from game_sessions table
    console.log('[Feed] Querying playtime sessions from game_sessions table...');
    const dataAccess = getDataAccess();
    
    // Calculate date filters
    const playtimeCooldownThreshold = new Date(now.getTime() - COOLDOWN_MINUTES * 60 * 1000);
    const playtimeLookbackDate = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    
    // LEDGER APPROACH: Query playtime sessions from game_sessions table
    console.log('[Feed] Querying playtime sessions from game_sessions table...');
    console.log('[Feed] Target user IDs:', targetUserIds.length);
    console.log('[Feed] Lookback date:', playtimeLookbackDate.toISOString());
    console.log('[Feed] Cooldown threshold:', playtimeCooldownThreshold.toISOString());
    
    // Query playtime sessions from game_sessions (already filtered by lookback in getGameSessions)
    const gameSessions = await dataAccess.getGameSessions(targetUserIds, 1000, 0, MAX_LOOKBACK_DAYS);
    
    // Filter by cooldown and type (only playtime sessions)
    const playtimeSessionsFromDB = gameSessions.filter(session => {
      // Only playtime sessions
      if (session.type !== 'playtime') return false;
      // Apply cooldown filter
      return session.sessionEnd <= playtimeCooldownThreshold;
    });
    
    console.log(`[Feed] Found ${playtimeSessionsFromDB.length} playtime sessions from game_sessions (after cooldown filter)`);
    
    // Convert GameSession to FeedSession and check for overlapping achievement sessions
    if (playtimeSessionsFromDB.length > 0) {
      const playtimeUserIds = [...new Set(playtimeSessionsFromDB.map(s => s.userId))];
      const playtimeAppIds = [...new Set(playtimeSessionsFromDB.map(s => s.appId))];
      
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
      
      for (const gameSession of playtimeSessionsFromDB) {
        const userId = gameSession.userId;
        const appId = gameSession.appId;
        const sessionKey = `${userId}-${appId}`;
        
        // Check if there's an achievement session that overlaps with this time window
        const hasOverlappingAchievementSession = sessions.some(session => {
          if (session.user.steamId !== userId || session.game.appId !== appId) {
            return false;
          }
          // Check if the achievement session overlaps with the playtime session window
          return session.sessionEnd >= gameSession.sessionStart && session.sessionStart <= gameSession.sessionEnd;
        });
        
        if (hasOverlappingAchievementSession) {
          console.log(`[Feed] Skipping playtime session ${sessionKey} - has overlapping achievement session`);
          continue;
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
          playtimeSessions.push(playtimeSession);
        } else {
          console.log(`[Feed] Missing user or game data for playtime session ${sessionKey}`);
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
    sessions.forEach(session => {
      // Keep the first occurrence (or could keep the most recent)
      if (!sessionMap.has(session.sessionId)) {
        sessionMap.set(session.sessionId, session);
      }
    });
    sessions = Array.from(sessionMap.values());
    console.log(`[Feed] Deduplicated sessions: ${sessions.length} unique sessions`);

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

    // Sync-on-Read: Sync stale friends visible in current feed page
    // Extract friend IDs from visible sessions (exclude logged-in user)
    const visibleFriendIds = new Set<string>();
    paginatedSessions.forEach(session => {
      if (session.user.steamId !== steamId) {
        visibleFriendIds.add(session.user.steamId);
      }
    });

    if (visibleFriendIds.size > 0) {
      // Check staleness (2 hour threshold)
      const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const staleFriends = await getStaleFriends(Array.from(visibleFriendIds), staleThreshold);

      if (staleFriends.length > 0) {
        console.log(`[Feed] Found ${staleFriends.length} stale friends in visible feed, triggering background sync`);
        
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
        console.log(`[Feed] All ${visibleFriendIds.size} visible friends are fresh (synced within 2 hours)`);
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
    return ApiErrors.internalServerError();
  }
}

// OLD CODE REMOVED - all the old playtime detection logic has been replaced with the ledger approach
// The old code that was here has been removed. If you see references to allUserGames, allPlaytimeGamesRaw, etc.
// those were part of the old snapshot-based approach and have been replaced with queries to game_sessions table.
