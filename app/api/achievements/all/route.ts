import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';

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
    const games = await dataAccess.getUserGames(steamId);

    // Fetch achievements for all games in parallel
    const achievementPromises = games.map(async (game) => {
      try {
        const achievements = await dataAccess.getUserAchievements(steamId, game.appId);
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
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    );
  }
}
