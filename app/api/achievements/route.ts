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
    let userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);

    // If no cached achievements, fetch from Steam
    if (userAchievements.length === 0) {
      const steamClient = getSteamClient();

      // Fetch both player achievements and game schema
      const [playerAchievementsResponse, gameSchemaResponse] = await Promise.all([
        steamClient.getPlayerAchievements(steamId, appIdNum).catch(() => null),
        steamClient.getGameSchema(appIdNum).catch(() => null),
      ]);

      if (!playerAchievementsResponse || !gameSchemaResponse) {
        return NextResponse.json(
          { error: 'Failed to fetch achievements or game schema' },
          { status: 500 }
        );
      }

      // Extract unlocked achievement API names
      const unlockedAchievements = playerAchievementsResponse.playerstats.achievements
        .filter((ach) => ach.achieved === 1)
        .map((ach) => ach.apiname);

      // Transform schema achievements to our format
      const achievements = (gameSchemaResponse.game.availableGameStats?.achievements || []).map(
        (schemaAch) => ({
          appId: appIdNum,
          apiName: schemaAch.name,
          name: schemaAch.displayName,
          description: schemaAch.description || '',
          iconUrl: schemaAch.icon,
          iconGrayUrl: schemaAch.icongray,
          hidden: schemaAch.hidden === 1,
        })
      );

      // Save to cache
      await dataAccess.saveUserAchievements(
        steamId,
        appIdNum,
        achievements,
        unlockedAchievements
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
