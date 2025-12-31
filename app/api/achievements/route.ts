import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import type { UserAchievement } from '@/lib/data/types';

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;
    const searchParams = request.nextUrl.searchParams;
    const appId = searchParams.get('appId');

    if (!steamId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    if (!appId) {
      return NextResponse.json(
        { error: 'appId parameter is required' },
        { status: 400 }
      );
    }

    const appIdNum = parseInt(appId, 10);
    if (isNaN(appIdNum)) {
      return NextResponse.json(
        { error: 'Invalid appId' },
        { status: 400 }
      );
    }

    // Check if we have cached achievements
    const dataAccess = getDataAccess();
    const forceRefresh = searchParams.get('refresh') === 'true';
    let userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);

    // If no cached achievements or force refresh, fetch from Steam
    if (userAchievements.length === 0 || forceRefresh) {
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

      if (!playerAchievementsResponse || !gameSchemaResponse) {
        return NextResponse.json(
          { error: 'Failed to fetch achievements or game schema' },
          { status: 500 }
        );
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
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    );
  }
}
