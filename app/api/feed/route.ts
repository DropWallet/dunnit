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
    // RELAXED REQUIREMENT: We check last_played instead of playtime_last_synced_at
    // This allows friend sessions to appear even if their data hasn't been synced recently.
    // The trade-off is that playtime deltas might be slightly stale, but this is better than missing sessions entirely.
    // Data will self-correct when someone visits the friend's profile.
    
    // Debug: Check ALL games for this user (no time filter) to see what's in the database
    const { data: allUserGames, error: allGamesError } = await supabase
      .from('user_games')
      .select('user_id, app_id, playtime_minutes, previous_playtime_minutes, last_played, playtime_last_synced_at, name')
      .eq('user_id', DEBUG_USER_ID);

    if (allUserGames) {
      console.log(`[Playtime Detection] ALL games for user ${DEBUG_USER_ID} (no time filter):`, allUserGames.length);
      // Find StarRupture specifically
      const starRupture = allUserGames.find((g: any) => 
        g.name?.toLowerCase().includes('starrupture') || 
        g.name?.toLowerCase().includes('star-rupture')
      );
      if (starRupture) {
        const lastPlayedDate = starRupture.last_played ? new Date(starRupture.last_played) : null;
        const isInTimeWindow = lastPlayedDate && 
          lastPlayedDate >= playtimeLookbackDate &&
          lastPlayedDate <= playtimeCooldownThreshold;
        console.log(`[Playtime Detection] StarRupture found:`, {
          appId: starRupture.app_id,
          name: starRupture.name,
          playtime: starRupture.playtime_minutes,
          previous: starRupture.previous_playtime_minutes,
          lastPlayed: starRupture.last_played,
          lastPlayedDate: lastPlayedDate?.toISOString(),
          playtimeLastSyncedAt: starRupture.playtime_last_synced_at,
          isInTimeWindow,
          lookbackDate: playtimeLookbackDate.toISOString(),
          cooldownThreshold: playtimeCooldownThreshold.toISOString(),
        });
      } else {
        console.log(`[Playtime Detection] StarRupture NOT found in database for user ${DEBUG_USER_ID}`);
        // Log first few games to see what we have
        console.log(`[Playtime Detection] First 5 games for user ${DEBUG_USER_ID}:`, 
          allUserGames.slice(0, 5).map((g: any) => ({
            appId: g.app_id,
            name: g.name,
            lastPlayed: g.last_played,
            playtime: g.playtime_minutes,
            previous: g.previous_playtime_minutes,
          }))
        );
      }
    }
    
    // Query for games with playtime increases
    // Use pagination to fetch all games (Supabase may have hard limit on single queries)
    // We fetch all games and filter in memory to handle:
    // 1. Games where last_played is within the time window
    // 2. Games where last_played is null but playtime_last_synced_at is within the time window (fallback)
    // This handles cases where Steam API doesn't return rtime_last_played for friend games
    let allPlaytimeGamesRaw: any[] = [];
    let gamesOffset = 0; // Renamed to avoid conflict with feed pagination offset
    const pageSize = 1000;
    let hasMoreGames = true; // Renamed to avoid conflict with feed pagination hasMore
    let playtimeError: any = null;

    while (hasMoreGames) {
      const { data: page, error: error } = await supabase
        .from('user_games')
        .select('user_id, app_id, playtime_minutes, previous_playtime_minutes, last_played, playtime_last_synced_at')
        .in('user_id', targetUserIds)
        .range(gamesOffset, gamesOffset + pageSize - 1);
      
      if (error) {
        console.error('[Playtime Detection] Error fetching games page:', error);
        playtimeError = error;
        break;
      }
      
      if (!page || page.length === 0) {
        hasMoreGames = false;
      } else {
        allPlaytimeGamesRaw = allPlaytimeGamesRaw.concat(page);
        gamesOffset += pageSize;
        hasMoreGames = page.length === pageSize; // Continue if we got a full page
      }
    }
    
    console.log(`[Playtime Detection] Fetched ${allPlaytimeGamesRaw.length} games total (paginated)`);
    
    // Debug: Check if StarRupture is in raw results
    if (allPlaytimeGamesRaw) {
      const starRuptureInRaw = allPlaytimeGamesRaw.find((g: any) => 
        g.user_id === DEBUG_USER_ID && g.app_id === 1631270
      );
      if (starRuptureInRaw) {
        console.log(`[Playtime Detection] StarRupture found in raw query results:`, {
          appId: starRuptureInRaw.app_id,
          playtime: starRuptureInRaw.playtime_minutes,
          previous: starRuptureInRaw.previous_playtime_minutes,
          lastPlayed: starRuptureInRaw.last_played,
          playtimeLastSyncedAt: starRuptureInRaw.playtime_last_synced_at,
        });
      } else {
        console.log(`[Playtime Detection] StarRupture NOT found in raw query results (total games: ${allPlaytimeGamesRaw.length})`);
      }
    }
      // REMOVED: .not('playtime_last_synced_at', 'is', null)
      // REMOVED: .gte('playtime_last_synced_at', playtimeLookbackDate.toISOString())
      // We relaxed these requirements to allow friend sessions even when their data is stale
      // Now we also handle games where last_played is null by using playtime_last_synced_at as fallback
      // Database-level filtering reduces data transfer while still allowing fallback logic
    
    // Filter in memory: games must have last_played OR playtime_last_synced_at within the time window
    const allPlaytimeGames = (allPlaytimeGamesRaw || []).filter((g: any) => {
      const lastPlayed = g.last_played ? new Date(g.last_played) : null;
      const playtimeLastSynced = g.playtime_last_synced_at ? new Date(g.playtime_last_synced_at) : null;
      
      // Use last_played if available, otherwise fall back to playtime_last_synced_at
      const sessionDate = lastPlayed || playtimeLastSynced;
      
      if (!sessionDate) {
        return false; // No date available at all
      }
      
      // Check if session date is within the lookback window (14 days)
      const isWithinLookback = sessionDate >= playtimeLookbackDate;
      
      // Cooldown only applies if we have an actual last_played date
      // If we're using playtime_last_synced_at as fallback, we don't know when they actually played
      // so we skip the cooldown check to avoid filtering out valid sessions
      if (lastPlayed) {
        // We have an actual last_played date, so apply both lookback and cooldown
        const passes = isWithinLookback && sessionDate <= playtimeCooldownThreshold;
        // Debug: Log if StarRupture is being filtered
        if (g.user_id === DEBUG_USER_ID && g.app_id === 1631270) {
          console.log(`[Playtime Detection] StarRupture filter check (has last_played): isWithinLookback=${isWithinLookback}, passesCooldown=${sessionDate <= playtimeCooldownThreshold}, passes=${passes}`);
        }
        return passes;
      } else {
        // Using fallback date, only check lookback (not cooldown)
        // Debug: Log if StarRupture is being filtered
        if (g.user_id === DEBUG_USER_ID && g.app_id === 1631270) {
          console.log(`[Playtime Detection] StarRupture filter check (using fallback): isWithinLookback=${isWithinLookback}, sessionDate=${sessionDate.toISOString()}, lookbackDate=${playtimeLookbackDate.toISOString()}`);
        }
        return isWithinLookback;
      }
    });
    
    console.log('[Playtime Detection] Query result:', {
      allPlaytimeGamesCount: allPlaytimeGames?.length || 0,
      error: playtimeError?.message || null,
    });
    
    // Debug: Check games for specific user
    if (allPlaytimeGames) {
      const debugUserGames = allPlaytimeGames.filter((g: any) => g.user_id === DEBUG_USER_ID);
      console.log(`[Playtime Detection] Games for user ${DEBUG_USER_ID}:`, debugUserGames.length);
      if (debugUserGames.length > 0) {
        debugUserGames.forEach((g: any) => {
          console.log(`[Playtime Detection] User ${DEBUG_USER_ID} game ${g.app_id}:`, {
            current: g.playtime_minutes,
            previous: g.previous_playtime_minutes,
            lastPlayed: g.last_played,
            hasPrevious: g.previous_playtime_minutes !== null && g.previous_playtime_minutes !== undefined,
            playtimeLastSyncedAt: g.playtime_last_synced_at,
          });
        });
      } else {
        console.log(`[Playtime Detection] No games found for user ${DEBUG_USER_ID} in query results`);
      }
    }
    
    // Filter in memory: playtime must be at least 5 minutes more than previous
    // IMPORTANT: We require previous_playtime_minutes to exist - we can't calculate a delta without it
    // If previous_playtime_minutes is null/undefined, this is likely a first sync and we skip it
    const playtimeGames = (allPlaytimeGames || []).filter((g: any) => {
      // Skip if we don't have previous playtime (can't calculate delta)
      if (g.previous_playtime_minutes === null || g.previous_playtime_minutes === undefined) {
        // Debug: Log why we're skipping games for the specific user
        if (g.user_id === DEBUG_USER_ID) {
          console.log(`[Playtime Detection] Skipping game ${g.app_id} for user ${DEBUG_USER_ID}: missing previous_playtime_minutes`);
        }
        return false;
      }
      
      const previous = g.previous_playtime_minutes;
      const current = g.playtime_minutes;
      const delta = current - previous;
      const hasIncrease = delta >= 5; // At least 5 minutes
      
      // Log ALL games, not just those with increases
      console.log(`[Playtime Detection] Game ${g.app_id} (user ${g.user_id}): current=${current}, previous=${previous}, delta=${delta}, hasIncrease=${hasIncrease}, lastPlayed=${g.last_played}, playtimeLastSyncedAt=${g.playtime_last_synced_at}`);
      
      // Debug: Log if this game for the specific user didn't pass the filter
      if (g.user_id === DEBUG_USER_ID && !hasIncrease) {
        console.log(`[Playtime Detection] Game ${g.app_id} for user ${DEBUG_USER_ID} filtered out: delta=${delta} < 5 minutes`);
      }
      
      return hasIncrease;
    });
    
    console.log('[Playtime Detection] Games with playtime increases (>=5min):', playtimeGames.length);

    // Deduplicate playtimeGames by (user_id, app_id) before processing
    // This prevents processing the same game multiple times (can happen with pagination)
    const playtimeGamesDedupMap = new Map<string, typeof playtimeGames[0]>();
    playtimeGames.forEach(game => {
      const key = `${game.user_id}-${game.app_id}`;
      // Keep the first occurrence (or could keep the one with highest delta)
      if (!playtimeGamesDedupMap.has(key)) {
        playtimeGamesDedupMap.set(key, game);
      }
    });
    const uniquePlaytimeGames = Array.from(playtimeGamesDedupMap.values());
    console.log(`[Playtime Detection] Deduplicated playtime games: ${playtimeGames.length} -> ${uniquePlaytimeGames.length}`);

    if (!playtimeError && uniquePlaytimeGames && uniquePlaytimeGames.length > 0) {
      // Get user and game data for playtime sessions
      const playtimeUserIds = [...new Set(uniquePlaytimeGames.map((g: any) => g.user_id))];
      const playtimeAppIds = [...new Set(uniquePlaytimeGames.map((g: any) => g.app_id))];
      
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
      
      // Check each playtime game to see if it has achievements in the same time window
      const playtimeSessions: FeedSession[] = [];
      
      for (const playtimeGame of uniquePlaytimeGames) {
        const userId = playtimeGame.user_id;
        const appId = playtimeGame.app_id;
        const sessionKey = `${userId}-${appId}`;
        
        console.log(`[Playtime Detection] Processing game ${appId} (user ${userId})`);
        
        // Calculate the time window for this playtime session
        // Use last_played if available, otherwise fall back to playtime_last_synced_at
        const lastPlayedDate = playtimeGame.last_played 
          ? new Date(playtimeGame.last_played)
          : playtimeGame.playtime_last_synced_at 
            ? new Date(playtimeGame.playtime_last_synced_at)
            : null;
        
        if (!lastPlayedDate) {
          console.log(`[Playtime Detection] Skipping ${sessionKey} - no date available (last_played or playtime_last_synced_at)`);
          continue;
        }
        
        const previous = playtimeGame.previous_playtime_minutes ?? 0;
        const playtimeDelta = playtimeGame.playtime_minutes - previous;
        const sessionStartEstimate = new Date(lastPlayedDate.getTime() - playtimeDelta * 60 * 1000);
        
        // Check if there's an achievement session that overlaps with this time window
        const hasOverlappingAchievementSession = sessions.some(session => {
          if (session.user.steamId !== userId || session.game.appId !== appId) {
            return false;
          }
          // Check if the achievement session overlaps with the playtime session window
          return session.sessionEnd >= sessionStartEstimate && session.sessionStart <= lastPlayedDate;
        });
        
        if (hasOverlappingAchievementSession) {
          console.log(`[Playtime Detection] Skipping ${sessionKey} - has overlapping achievement session in time window`);
          continue;
        }
        
        console.log(`[Playtime Detection] Checking game ${appId} (user ${userId}): delta=${playtimeDelta}min, sessionDate=${lastPlayedDate.toISOString()}, usingLastPlayed=${!!playtimeGame.last_played}`);
        
        // Check for achievements unlocked in this window
        const { data: achievementsInWindow } = await supabase
          .from('user_achievements')
          .select('unlocked_at')
          .eq('user_id', userId)
          .eq('app_id', appId)
          .eq('unlocked', true)
          .not('unlocked_at', 'is', null)
          .gte('unlocked_at', sessionStartEstimate.toISOString())
          .lte('unlocked_at', lastPlayedDate.toISOString())
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
              lastPlayedDate, // Use the fallback date (last_played or playtime_last_synced_at)
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
            console.log(`[Playtime Detection] Missing user or game data for ${sessionKey} - user: ${!!user}, game: ${!!game}`);
          }
        } else {
          console.log(`[Playtime Detection] Skipping ${sessionKey} - has ${achievementsInWindow.length} achievement(s) in window`);
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
