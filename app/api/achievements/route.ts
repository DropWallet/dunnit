import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { verifyIsFriend } from '@/lib/utils/authorization';
import { ApiErrors } from '@/lib/utils/api-errors';
import type { UserAchievement } from '@/lib/data/types';

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

    // If viewing friend's achievements, verify authorization
    if (targetSteamId && targetSteamId !== loggedInSteamId) {
      const isAuthorized = await verifyIsFriend(loggedInSteamId, targetSteamId);
      if (!isAuthorized) {
        return ApiErrors.forbidden(
          'You can only view your own achievements or your friends\' achievements',
          `Access denied for Steam ID: ${targetSteamId}`
        );
      }
    }

    // Check if we have cached achievements
    const dataAccess = getDataAccess();
    const forceRefresh = searchParams.get('refresh') === 'true';
    let userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);

    // Check if cache is stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(steamId, appIdNum);
    const isStale = !lastSyncedAt || lastSyncedAt < oneHourAgo;

    // If no cached achievements, stale cache, or force refresh, fetch from Steam
    if (userAchievements.length === 0 || isStale || forceRefresh) {
      if (forceRefresh) {
        // Clear cache for this game
        await dataAccess.clearUserAchievements(steamId, appIdNum);
      }
      const steamClient = getSteamClient();

      // Fetch player achievements, game schema, global percentages, and XML achievements
      const [playerAchievementsResponse, gameSchemaResponse, globalPercentages, xmlAchievements] = await Promise.all([
        steamClient.getPlayerAchievements(steamId, appIdNum).catch(() => null),
        steamClient.getGameSchema(appIdNum).catch(() => null),
        steamClient.getGlobalAchievementPercentages(appIdNum).catch(() => new Map<string, number>()),
        steamClient.getPlayerAchievementsXML(steamId, appIdNum).catch(() => new Map()),
      ]);

      // If Steam API fails, check if we have cached data to return
      if (!playerAchievementsResponse || !gameSchemaResponse) {
        // If we have cached data, return it even if Steam fetch failed
        if (userAchievements.length > 0) {
          return NextResponse.json({ achievements: userAchievements });
        }
        // If no cached data and Steam fails, return empty array (game might not have achievements)
        return NextResponse.json({ achievements: [] });
      }

      // Extract unlocked achievement API names, unlock times, and descriptions
      const unlockedAchievements: string[] = [];
      const unlockTimes = new Map<string, number>();
      const achievementDescriptions = new Map<string, string>();
      
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

      // Transform schema achievements to our format
      const achievements = (gameSchemaResponse.game.availableGameStats?.achievements || []).map(
        (schemaAch) => {
          // Check if we have a description from player achievements (for unlocked achievements)
          const playerDescription = achievementDescriptions.get(schemaAch.name);
          const xmlDescription = xmlAchievements.get(schemaAch.name)?.description || '';
          const schemaDescription = schemaAch.description || '';
          const finalDescription = playerDescription || xmlDescription || schemaDescription || '';
          
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

      // Fetch again to get the formatted data
      userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);
    }

    return NextResponse.json({ achievements: userAchievements });
  } catch (error) {
    console.error('Error fetching achievements:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch achievements',
      errorMessage
    );
  }
}
