import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch achievements',
      errorMessage
    );
  }
}
