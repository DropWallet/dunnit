import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;

    if (!steamId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const dataAccess = getDataAccess();

    // Get all games for the user (from user_games)
    const games = await dataAccess.getUserGames(steamId);
    const appIds = games.map((g) => g.appId);
    const gameNameMap = new Map<number, string>();
    games.forEach((g) => gameNameMap.set(g.appId, g.name));

    // Fetch achievements for all games in parallel
    const achievementPromises = appIds.map(async (appId) => {
      try {
        const achievements = await dataAccess.getUserAchievements(steamId, appId);
        const gameName = gameNameMap.get(appId) || `Game ${appId}`;
        return achievements.map(ach => ({
          ...ach,
          gameName,
          appId,
        }));
      } catch (error) {
        console.warn(`Failed to load achievements for game ${appId}:`, error);
        return [];
      }
    });

    const allAchievementsArrays = await Promise.all(achievementPromises);
    const allAchievements = allAchievementsArrays.flat();

    return NextResponse.json(
      { achievements: allAchievements },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching all achievements:', error);
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    );
  }
}
