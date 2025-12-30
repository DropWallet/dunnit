import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { calculateStatistics } from '@/lib/utils/statistics';

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
    
    // Get all games
    const games = await dataAccess.getUserGames(steamId);
    
    // If no games, return empty statistics
    if (games.length === 0) {
      return NextResponse.json({
        statistics: {
          totalGames: 0,
          startedGames: 0,
          totalAchievements: 0,
          unlockedAchievements: 0,
          averageCompletionRate: 0,
        },
      });
    }
    
    // Get achievements for all games
    const allAchievements = new Map<number, any[]>();
    
    for (const game of games) {
      try {
        const achievements = await dataAccess.getUserAchievements(steamId, game.appId);
        if (achievements.length > 0) {
          allAchievements.set(game.appId, achievements);
        }
      } catch (error) {
        // Skip games that fail to load achievements
        console.warn(`Failed to load achievements for game ${game.appId}:`, error);
      }
    }
    
    // Calculate statistics
    const statistics = calculateStatistics(games, allAchievements);

    return NextResponse.json({ statistics });
  } catch (error) {
    console.error('Error calculating statistics:', error);
    return NextResponse.json(
      { error: 'Failed to calculate statistics' },
      { status: 500 }
    );
  }
}
