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

// Cooldown period: sessions only appear 30 minutes after completion
const COOLDOWN_MINUTES = 30;
const MAX_LOOKBACK_DAYS = 14;
const DEFAULT_LIMIT = 20;

export const dynamic = 'force-dynamic';

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

    // Detect playtime-only sessions (sessions without achievements)
    console.log('[Playtime Detection] Starting playtime-only session detection...');
    // Reuse existing supabase instance from above
    // Declare dataAccess here to use for both playtime detection and achievement counts
    const dataAccess = getDataAccess();
    
    // Log current time and constants for debugging
    console.log('[Playtime Detection] Current time (now):', now.toISOString());
    console.log('[Playtime Detection] COOLDOWN_MINUTES:', COOLDOWN_MINUTES);
    console.log('[Playtime Detection] MAX_LOOKBACK_DAYS:', MAX_LOOKBACK_DAYS);
    
    // Calculate date filters for playtime-only sessions
    const playtimeCooldownThreshold = new Date(now.getTime() - COOLDOWN_MINUTES * 60 * 1000);
    const playtimeLookbackDate = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    
    console.log('[Playtime Detection] Querying for playtime-only sessions...');
    console.log('[Playtime Detection] Target user IDs:', targetUserIds.length);
    console.log('[Playtime Detection] Lookback date:', playtimeLookbackDate.toISOString());
    console.log('[Playtime Detection] Cooldown threshold:', playtimeCooldownThreshold.toISOString());
    
    // Query for games with playtime increases (potential playtime-only sessions)
    // Note: We filter for playtime > previous_playtime in memory since Supabase doesn't support column comparisons
    // We allow previous_playtime_minutes to be NULL (first sync scenario) - will treat as 0
    const { data: allPlaytimeGames, error: playtimeError } = await supabase
      .from('user_games')
      .select('user_id, app_id, playtime_minutes, previous_playtime_minutes, last_played, playtime_last_synced_at')
      .in('user_id', targetUserIds)
      .gte('last_played', playtimeLookbackDate.toISOString())
      .lte('last_played', playtimeCooldownThreshold.toISOString())
      .not('playtime_last_synced_at', 'is', null)
      .gte('playtime_last_synced_at', playtimeLookbackDate.toISOString()); // Only recently synced data
    
    console.log('[Playtime Detection] Query result:', {
      allPlaytimeGamesCount: allPlaytimeGames?.length || 0,
      error: playtimeError?.message || null,
    });
    
    // Filter in memory: playtime must be at least 5 minutes more than previous
    // Handle NULL previous_playtime_minutes (first sync) by treating it as 0
    const playtimeGames = (allPlaytimeGames || []).filter((g: any) => {
      const previous = g.previous_playtime_minutes ?? 0;
      const current = g.playtime_minutes;
      const delta = current - previous;
      const hasIncrease = delta >= 5; // At least 5 minutes
      
      // Log ALL games, not just those with increases
      console.log(`[Playtime Detection] Game ${g.app_id} (user ${g.user_id}): current=${current}, previous=${previous}, delta=${delta}, hasIncrease=${hasIncrease}, lastPlayed=${g.last_played}, playtimeLastSyncedAt=${g.playtime_last_synced_at}`);
      
      return hasIncrease;
    });
    
    console.log('[Playtime Detection] Games with playtime increases (>=5min):', playtimeGames.length);

    if (!playtimeError && playtimeGames && playtimeGames.length > 0) {
      // Get user and game data for playtime sessions
      const playtimeUserIds = [...new Set(playtimeGames.map((g: any) => g.user_id))];
      const playtimeAppIds = [...new Set(playtimeGames.map((g: any) => g.app_id))];
      
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
      
      // Create a set of (user_id, app_id) pairs that have achievement sessions
      // to avoid duplicate playtime-only sessions
      const achievementSessionKeys = new Set(
        sessions.map(s => `${s.user.steamId}-${s.game.appId}`)
      );
      
      // Check each playtime game to see if it has achievements in the same time window
      const playtimeSessions: FeedSession[] = [];
      
      for (const playtimeGame of playtimeGames) {
        const userId = playtimeGame.user_id;
        const appId = playtimeGame.app_id;
        const sessionKey = `${userId}-${appId}`;
        
        // Skip if we already have an achievement session for this user+game
        if (achievementSessionKeys.has(sessionKey)) {
          continue;
        }
        
        // Check if any achievements were unlocked in the time window
        // Calculate the time window: from previous playtime sync to last_played
        const lastPlayed = new Date(playtimeGame.last_played);
        const previous = playtimeGame.previous_playtime_minutes ?? 0;
        const playtimeDelta = playtimeGame.playtime_minutes - previous;
        const sessionStartEstimate = new Date(lastPlayed.getTime() - playtimeDelta * 60 * 1000);
        
        console.log(`[Playtime Detection] Checking game ${appId} (user ${userId}): delta=${playtimeDelta}min, lastPlayed=${lastPlayed.toISOString()}`);
        
        // Check for achievements unlocked in this window
        const { data: achievementsInWindow } = await supabase
          .from('user_achievements')
          .select('unlocked_at')
          .eq('user_id', userId)
          .eq('app_id', appId)
          .eq('unlocked', true)
          .not('unlocked_at', 'is', null)
          .gte('unlocked_at', sessionStartEstimate.toISOString())
          .lte('unlocked_at', lastPlayed.toISOString())
          .limit(1);
        
        // If no achievements in this window, it's a playtime-only session
        if (!achievementsInWindow || achievementsInWindow.length === 0) {
          const user = playtimeUsersMap.get(userId);
          const game = playtimeGamesMap.get(sessionKey);
          
          if (user && game) {
            console.log(`[Playtime Detection] Creating playtime-only session for ${game.name} (${playtimeDelta}min)`);
            const playtimeSession = createSessionFromPlaytime(
              userId,
              appId,
              playtimeDelta,
              lastPlayed,
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
            console.log(`[Playtime Detection] Missing user or game data for ${sessionKey}`);
          }
        } else {
          console.log(`[Playtime Detection] Skipping ${sessionKey} - has achievements in window`);
        }
      }
      
      // Merge playtime-only sessions with achievement sessions
      console.log(`[Playtime Detection] Created ${playtimeSessions.length} playtime-only sessions`);
      sessions = [...sessions, ...playtimeSessions];
    } else {
      if (playtimeError) {
        console.error('[Playtime Detection] Error querying playtime games:', playtimeError);
      } else {
        console.log('[Playtime Detection] No playtime-only sessions found');
      }
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
          const unlocked = userAchievements.filter(ach => ach.unlocked).length;
          achievementCounts.set(key, { total, unlocked });
        } catch (error) {
          console.warn(`Failed to fetch achievement counts for ${key}:`, error);
          // Default to 0 if fetch fails
          achievementCounts.set(key, { total: 0, unlocked: 0 });
        }
      })
    );

    // Add achievement counts to each session
    sessions = sessions.map(session => {
      const key = `${session.user.steamId}-${session.game.appId}`;
      const counts = achievementCounts.get(key) || { total: 0, unlocked: 0 };
      return {
        ...session,
        totalGameAchievements: counts.total,
        unlockedGameAchievements: counts.unlocked,
      };
    });

    // Fetch like counts and user likes
    const sessionIds = sessions.map(s => s.sessionId);
    const likeCounts = await dataAccess.getLikeCounts(sessionIds);
    const userLikes = await dataAccess.getUserLikes(sessionIds, steamId);

    // Apply pagination before fetching liked by users (to reduce queries)
    const total = sessions.length;
    const paginatedSessions = sessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    // Fetch liked by users for paginated sessions only (first 3 users per session)
    const likedByUsersMap = new Map<string, Array<{ userId: string; avatarUrl: string }>>();
    await Promise.all(
      paginatedSessions.map(async (session) => {
        try {
          const users = await dataAccess.getLikedByUsers(session.sessionId, 3);
          likedByUsersMap.set(session.sessionId, users);
        } catch (error) {
          console.warn(`Failed to fetch liked by users for session ${session.sessionId}:`, error);
          likedByUsersMap.set(session.sessionId, []);
        }
      })
    );

    // Add like data to each session
    const sessionsWithLikes = paginatedSessions.map(session => ({
      ...session,
      likeCount: likeCounts.get(session.sessionId) || 0,
      isLiked: userLikes.has(session.sessionId),
      likedByUsers: likedByUsersMap.get(session.sessionId) || [],
    }));

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
          "Cache-Control": "private, max-age=60", // Cache for 1 minute (feed updates frequently)
        },
      }
    );
  } catch (error) {
    console.error("Error in feed route:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return ApiErrors.internalError("Failed to fetch feed", errorMessage);
  }
}
