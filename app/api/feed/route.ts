import { NextRequest, NextResponse } from "next/server";
import { getSteamClient } from "@/lib/steam/client";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import { getDataAccess } from "@/lib/data/access";
import { ApiErrors } from "@/lib/utils/api-errors";
import {
  groupAchievementsIntoSessions,
  filterSessionsByCooldown,
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

    // Sort by sessionEnd descending (newest first)
    sessions.sort((a, b) => b.sessionEnd.getTime() - a.sessionEnd.getTime());

    // Fetch achievement counts for each unique (user_id, app_id) combination
    const dataAccess = getDataAccess();
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
