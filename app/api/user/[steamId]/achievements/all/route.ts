import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { getSteamClient } from '@/lib/steam/client';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';

// Number of games to sync immediately before returning response
const INITIAL_SYNC_BATCH_SIZE = 25;

/**
 * Sync achievements for a single game from Steam API
 */
async function syncGameAchievements(
  steamId: string,
  appId: number,
  dataAccess: ReturnType<typeof getDataAccess>,
  steamClient: ReturnType<typeof getSteamClient>
): Promise<void> {
  try {
    // Check if we have cached achievements
    const userAchievements = await dataAccess.getUserAchievements(steamId, appId);
    const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(steamId, appId);
    
    // Check if cache is stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isStale = !lastSyncedAt || lastSyncedAt < oneHourAgo;
    
    // Skip if we have fresh cached achievements
    if (userAchievements.length > 0 && !isStale) {
      return;
    }

    // Fetch from Steam API
    const [playerAchievementsResponse, gameSchemaResponse, globalPercentages, xmlAchievements] = await Promise.all([
      steamClient.getPlayerAchievements(steamId, appId).catch(() => null),
      steamClient.getGameSchema(appId).catch(() => null),
      steamClient.getGlobalAchievementPercentages(appId).catch(() => new Map<string, number>()),
      steamClient.getPlayerAchievementsXML(steamId, appId).catch(() => new Map()),
    ]);

    // If Steam API fails, skip this game (might be private or no achievements)
    if (!playerAchievementsResponse || !gameSchemaResponse) {
      return;
    }

    // Extract unlocked achievement API names, unlock times, and descriptions
    const unlockedAchievements: string[] = [];
    const unlockTimes = new Map<string, number>();
    const achievementDescriptions = new Map<string, string>();
    
    if (playerAchievementsResponse.playerstats?.achievements) {
      playerAchievementsResponse.playerstats.achievements.forEach((ach) => {
        if (ach.achieved === 1) {
          unlockedAchievements.push(ach.apiname);
          if (ach.unlocktime > 0) {
            unlockTimes.set(ach.apiname, ach.unlocktime);
          }
          if (ach.description) {
            achievementDescriptions.set(ach.apiname, ach.description);
          }
        }
      });
    }

    // Transform schema achievements to our format
    const achievements = (gameSchemaResponse.game.availableGameStats?.achievements || []).map(
      (schemaAch) => {
        const playerDescription = achievementDescriptions.get(schemaAch.name);
        const xmlDescription = xmlAchievements.get(schemaAch.name)?.description || '';
        const schemaDescription = schemaAch.description || '';
        const finalDescription = playerDescription || xmlDescription || schemaDescription || '';
        
        return {
          appId,
          apiName: schemaAch.name,
          name: schemaAch.displayName,
          description: finalDescription,
          iconUrl: schemaAch.icon,
          iconGrayUrl: schemaAch.icongray,
          hidden: schemaAch.hidden === 1,
        };
      }
    );

    // Save to cache
    await dataAccess.saveUserAchievements(
      steamId,
      appId,
      achievements,
      unlockedAchievements,
      unlockTimes,
      globalPercentages
    );

    // Update derived_last_played if needed
    try {
      const game = await dataAccess.getUserGame(steamId, appId);
      if (game && !game.lastPlayed) {
        const savedAchievements = await dataAccess.getUserAchievements(steamId, appId);
        const latestUnlock = getLatestAchievementUnlockTime(savedAchievements);

        if (latestUnlock) {
          const updatedGame = {
            ...game,
            derivedLastPlayed: latestUnlock,
            derivedLastPlayedCalculatedAt: new Date(),
          };
          await dataAccess.saveUserGames(steamId, [updatedGame]);
        }
      }
    } catch (error) {
      // Non-critical - skip if this fails
    }
  } catch (error) {
    // Silently fail for individual games - might be private or no achievements
    // Don't log to avoid noise from expected failures
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { steamId: string } }
) {
  try {
    const loggedInSteamId = request.cookies.get('steam_id')?.value;
    const targetSteamId = params.steamId;

    if (!loggedInSteamId) {
      return ApiErrors.notAuthenticated();
    }

    if (!targetSteamId) {
      return ApiErrors.missingParameter('steamId');
    }

    // No authorization check needed - Steam API enforces privacy
    // If profile is private, Steam API will return error/empty data
    // If profile is public, Steam API will return achievements
    // This matches Steam's behavior: public profiles = viewable achievements

    const dataAccess = getDataAccess();
    const user = await dataAccess.getUser(targetSteamId);
    const games = await dataAccess.getUserGames(targetSteamId);

    // Filter to games with playtime (more likely to have achievements)
    const gamesWithPlaytime = games.filter(game => game.playtimeMinutes > 0);

    // Check if we need to sync achievements
    // Sync if: no user, cache is stale, or sample check shows missing achievements
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let shouldSync = false;
    
    if (gamesWithPlaytime.length > 0) {
      if (!user?.lastSyncAt || user.lastSyncAt < oneHourAgo) {
        shouldSync = true;
      } else {
        // Sample check: if first few games have no cached achievements, sync is needed
        const sampleGames = gamesWithPlaytime.slice(0, 5);
        const sampleChecks = await Promise.all(
          sampleGames.map(async (game) => {
            const achievements = await dataAccess.getUserAchievements(targetSteamId, game.appId);
            const lastSynced = await dataAccess.getAchievementLastSyncedAt(targetSteamId, game.appId);
            return achievements.length === 0 || !lastSynced || lastSynced < oneHourAgo;
          })
        );
        shouldSync = sampleChecks.some(needsSync => needsSync);
      }
    }

    // If sync needed, sync first batch immediately, then continue in background
    if (shouldSync && gamesWithPlaytime.length > 0) {
      const steamClient = getSteamClient();
      
      // Sync first batch immediately (for quick response)
      const initialBatch = gamesWithPlaytime.slice(0, INITIAL_SYNC_BATCH_SIZE);
      await Promise.all(
        initialBatch.map(game => syncGameAchievements(targetSteamId, game.appId, dataAccess, steamClient))
      );

      // Continue syncing remaining games in background (fire and forget)
      const remainingGames = gamesWithPlaytime.slice(INITIAL_SYNC_BATCH_SIZE);
      if (remainingGames.length > 0) {
        // Don't await - let this run in background
        Promise.all(
          remainingGames.map(game => syncGameAchievements(targetSteamId, game.appId, dataAccess, steamClient))
        ).catch(() => {
          // Silently fail - background sync errors are not critical
        });
      }
    }

    // Fetch all cached achievements (including newly synced ones)
    const achievementPromises = games.map(async (game) => {
      try {
        const achievements = await dataAccess.getUserAchievements(targetSteamId, game.appId);
        return achievements.map(ach => ({
          ...ach,
          gameName: game.name,
          appId: game.appId,
        }));
      } catch (error) {
        console.warn(`Failed to load achievements for game ${game.appId}:`, error);
        return [];
      }
    });

    const allAchievementsArrays = await Promise.all(achievementPromises);
    const allAchievements = allAchievementsArrays.flat();

    return NextResponse.json(
      { achievements: allAchievements },
      {
        headers: {
          'Cache-Control': 'private, max-age=300', // 5 minutes browser cache
        },
      }
    );
  } catch (error) {
    console.error('Error fetching all achievements:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch achievements',
      errorMessage
    );
  }
}
