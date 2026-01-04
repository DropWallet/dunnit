import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { verifyIsFriend } from '@/lib/utils/authorization';

export async function GET(
  request: NextRequest,
  { params }: { params: { steamId: string } }
) {
  try {
    const loggedInSteamId = request.cookies.get('steam_id')?.value;
    const targetSteamId = params.steamId;

    if (!loggedInSteamId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    if (!targetSteamId) {
      return NextResponse.json(
        { error: 'steamId parameter is required' },
        { status: 400 }
      );
    }

    // Verify authorization: user must be viewing themselves or a friend
    const isAuthorized = await verifyIsFriend(loggedInSteamId, targetSteamId);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: You can only view your own achievements or your friends\' achievements' },
        { status: 403 }
      );
    }

    const dataAccess = getDataAccess();
    const games = await dataAccess.getUserGames(targetSteamId);

    // Fetch achievements for all games in parallel
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
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    );
  }
}
