import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import { detectNewAchievementSessions, writeAchievementSessions } from '@/lib/utils/achievement-sessions';
import type { UserAchievement } from '@/lib/data/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable ISR caching

/** Parse HTTP status from Steam client error message e.g. "Steam API error: 403" */
function steamErrorStatus(err: unknown): number | null {
  if (err instanceof Error && /Steam API error: (\d+)/.test(err.message)) {
    const m = err.message.match(/Steam API error: (\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  return null;
}

/** Diagnostic reason when achievements are empty - distinguishes Steam vs our side */
export type AchievementEmptyReason =
  | 'steam-403'   // Steam: game details private / forbidden
  | 'steam-400'   // Steam: game has no achievements (expected)
  | 'steam-429'   // Steam: rate limited
  | 'steam-5xx'   // Steam: server error
  | 'steam-error' // Steam: other error (network, timeout, etc.)
  | 'no-schema';  // Schema fetch failed (our call or Steam)

export async function GET(request: NextRequest) {
  try {
    const loggedInSteamId = request.cookies.get('steam_id')?.value;
    const searchParams = request.nextUrl.searchParams;
    const appId = searchParams.get('appId');
    const targetSteamId = searchParams.get('steamId'); // Optional: for viewing friend's achievements

    if (!loggedInSteamId) {
      return ApiErrors.notAuthenticated();
    }

    if (!appId) {
      return ApiErrors.missingParameter('appId');
    }

    const appIdNum = parseInt(appId, 10);
    if (isNaN(appIdNum)) {
      return ApiErrors.invalidParameter('appId', 'appId must be a valid number');
    }

    // Determine which steamId to use
    const steamId = targetSteamId || loggedInSteamId;

    // No authorization check needed - Steam API enforces privacy
    // If profile is private, Steam API will return error/empty data
    // If profile is public, Steam API will return achievements
    // This matches Steam's behavior: public profiles = viewable achievements

    // Check if we have cached achievements
    const dataAccess = getDataAccess();
    const forceRefresh = searchParams.get('refresh') === 'true';
    
    // Only skip Steam for games not played in 14 days when we already have cached data.
    // When cache is empty, always try Steam so we get data or a diagnostic (e.g. steam-403 for friends).
    const game = await dataAccess.getUserGame(steamId, appIdNum);
    if (game && !forceRefresh) {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const lastPlayed = game.lastPlayed ? new Date(game.lastPlayed) : null;
      const derivedLastPlayed = game.derivedLastPlayed ? new Date(game.derivedLastPlayed) : null;
      const isRecentlyPlayed = (lastPlayed && lastPlayed > fourteenDaysAgo) ||
                               (derivedLastPlayed && derivedLastPlayed > fourteenDaysAgo);

      if (!isRecentlyPlayed) {
        const userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);
        // If we have cached data, return it (saves Steam API calls for old games).
        // If cache is empty, fall through and try Steam so friends get data or emptyReason.
        if (userAchievements.length > 0) {
          return NextResponse.json(
            { achievements: userAchievements },
            { headers: { 'Cache-Control': 'private, max-age=300' } }
          );
        }
      }
    }
    
    let userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);

    // Check if cache is stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(steamId, appIdNum);
    const isStale = !lastSyncedAt || lastSyncedAt < oneHourAgo;

    // If no cached achievements, stale cache, or force refresh, fetch from Steam
    if (userAchievements.length === 0 || isStale || forceRefresh) {
      // Get old achievements BEFORE saving (to detect new unlocks)
      const oldAchievements = userAchievements;
      if (forceRefresh) {
        // Clear cache for this game
        await dataAccess.clearUserAchievements(steamId, appIdNum);
      }
      const steamClient = getSteamClient();

      // Capture errors so we can return a diagnostic (Steam vs our side)
      const playerAchPromise = steamClient
        .getPlayerAchievements(steamId, appIdNum)
        .then((data) => ({ data, error: null as Error | null }))
        .catch((err) => ({ data: null, error: err instanceof Error ? err : new Error(String(err)) }));
      const schemaPromise = steamClient
        .getGameSchema(appIdNum)
        .then((data) => ({ data, error: null as Error | null }))
        .catch((err) => ({ data: null, error: err instanceof Error ? err : new Error(String(err)) }));

      const [playerAchResult, schemaResult, globalPercentages] = await Promise.all([
        playerAchPromise,
        schemaPromise,
        steamClient.getGlobalAchievementPercentages(appIdNum).catch(() => new Map<string, number>()),
      ]);

      const playerAchievementsResponse = playerAchResult.data;
      const gameSchemaResponse = schemaResult.data;

      // If Steam API fails, check if we have cached data to return
      if (!playerAchievementsResponse || !gameSchemaResponse) {
        // If we have cached data, return it even if Steam fetch failed
        if (userAchievements.length > 0) {
          return NextResponse.json({ achievements: userAchievements });
        }
        // No cached data: return empty with diagnostic so caller can tell Steam vs our side
        const playerStatus = steamErrorStatus(playerAchResult.error);
        const schemaStatus = steamErrorStatus(schemaResult.error);
        let emptyReason: AchievementEmptyReason | undefined;
        if (playerStatus === 403 || schemaStatus === 403) emptyReason = 'steam-403';
        else if (playerStatus === 400) emptyReason = 'steam-400';
        else if (playerStatus === 429 || schemaStatus === 429) emptyReason = 'steam-429';
        else if ((playerStatus !== null && playerStatus >= 500) || (schemaStatus !== null && schemaStatus >= 500)) emptyReason = 'steam-5xx';
        else if (!gameSchemaResponse && schemaResult.error) emptyReason = 'no-schema';
        else if (playerAchResult.error || schemaResult.error) emptyReason = 'steam-error';
        return NextResponse.json({ achievements: [], emptyReason });
      }

      // Extract unlocked achievement API names, unlock times, and descriptions
      const unlockedAchievements: string[] = [];
      const unlockTimes = new Map<string, number>();
      const achievementDescriptions = new Map<string, string>();
      
      // Check if playerstats and achievements exist before iterating
      if (playerAchievementsResponse.playerstats?.achievements) {
        playerAchievementsResponse.playerstats.achievements.forEach((ach) => {
        if (ach.achieved === 1) {
          unlockedAchievements.push(ach.apiname);
          if (ach.unlocktime > 0) {
            unlockTimes.set(ach.apiname, ach.unlocktime);
          }
          // Get description from player achievements (often has descriptions for unlocked hidden achievements)
          if (ach.description) {
            achievementDescriptions.set(ach.apiname, ach.description);
          }
        }
      });
      }

      // Transform schema achievements to our format
      const achievements = (gameSchemaResponse.game.availableGameStats?.achievements || []).map(
        (schemaAch) => {
          // Check if we have a description from player achievements (for unlocked achievements)
          const playerDescription = achievementDescriptions.get(schemaAch.name);
          const schemaDescription = schemaAch.description || '';
          // OPTIMIZATION #4: Removed XML fallback - player achievements API provides descriptions for unlocked,
          // and schema provides descriptions for locked achievements (except hidden ones, which are hidden by design)
          const finalDescription = playerDescription || schemaDescription || '';
          
          return {
            appId: appIdNum,
            apiName: schemaAch.name,
            name: schemaAch.displayName,
            description: finalDescription,
            iconUrl: schemaAch.icon,
            iconGrayUrl: schemaAch.icongray,
            hidden: schemaAch.hidden === 1,
          };
        }
      );

      // Save to cache with unlock times and global percentages
      await dataAccess.saveUserAchievements(
        steamId,
        appIdNum,
        achievements,
        unlockedAchievements,
        unlockTimes,
        globalPercentages
      );

      // LEDGER APPROACH: Write achievement sessions to game_sessions table
      // Fetch new achievements after save to detect new unlocks
      const newAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);
      
      // Detect new unlocks and group into sessions
      const achievementSessions = detectNewAchievementSessions(
        oldAchievements,
        newAchievements,
        steamId,
        appIdNum
      );

      // Write achievement sessions to database
      if (achievementSessions.length > 0) {
        await writeAchievementSessions(steamId, appIdNum, achievementSessions);
      }

      // Recalculate derived_last_played for this game if it doesn't have lastPlayed
      // This ensures sorting works immediately without waiting for achievements to load
      try {
        const game = await dataAccess.getUserGame(steamId, appIdNum);
        if (game && !game.lastPlayed) {
          // Check if achievements were just synced (newer than last calculation)
          const achievementLastSynced = await dataAccess.getAchievementLastSyncedAt(steamId, appIdNum);
          const shouldRecalculate = !game.derivedLastPlayedCalculatedAt || 
            (achievementLastSynced && achievementLastSynced > game.derivedLastPlayedCalculatedAt);

          if (shouldRecalculate) {
            // Fetch the achievements we just saved
            const savedAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);
            const latestUnlock = getLatestAchievementUnlockTime(savedAchievements);

            if (latestUnlock) {
              // Update the game with derived_last_played
              const updatedGame: typeof game = {
                ...game,
                derivedLastPlayed: latestUnlock,
                derivedLastPlayedCalculatedAt: new Date(),
              };
              
              // Save just this game to update derived_last_played
              await dataAccess.saveUserGames(steamId, [updatedGame]);
            }
          }
        }
      } catch (error) {
        // Non-critical - if this fails, sorting will still work, just might need to fetch achievements
        console.warn(`Failed to update derived_last_played for game ${appIdNum}:`, error);
      }

      // Fetch again to get the formatted data
      userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);
    }

    // Set HTTP cache headers
    // If force refresh, don't cache; otherwise cache for 5 minutes
    const cacheControl = forceRefresh
      ? 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
      : 'private, max-age=300'; // 5 minutes browser cache

    return NextResponse.json(
      { achievements: userAchievements },
      {
        headers: {
          'Cache-Control': cacheControl,
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    // Only log unexpected errors (not network errors that are handled)
    if (error instanceof Error && !error.message.includes('HeadersOverflowError')) {
      console.error('Error fetching achievements:', error);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch achievements',
      errorMessage
    );
  }
}
