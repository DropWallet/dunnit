import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { calculateStatistics } from '@/lib/utils/statistics';
import { ApiErrors } from '@/lib/utils/api-errors';

// Maximum age for cached statistics (24 hours in milliseconds)
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

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
    // If profile is public, Steam API will return data
    // This matches Steam's behavior: public profiles = viewable statistics

    const dataAccess = getDataAccess();
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get('force') === 'true';
    
    // Get user to check lastSyncAt
    const user = await dataAccess.getUser(targetSteamId);
    if (!user) {
      return ApiErrors.userNotFound(targetSteamId);
    }

    // Check for cached statistics
    if (!forceRefresh) {
      const cachedStats = await dataAccess.getUserStatistics(targetSteamId);
      
      if (cachedStats) {
        const now = new Date();
        const cacheAge = now.getTime() - cachedStats.calculatedAt.getTime();
        
        // Safety net: Always recalculate if cache is older than 24 hours
        if (cacheAge < MAX_CACHE_AGE_MS) {
          // Check if data has changed since statistics were calculated
          const dataChanged = user.lastSyncAt && 
            user.lastSyncAt.getTime() > cachedStats.calculatedAt.getTime();
          
          // If data hasn't changed, return cached statistics
          if (!dataChanged) {
            return NextResponse.json(
              { statistics: cachedStats.statistics },
              {
                headers: {
                  'Cache-Control': 'private, max-age=300', // Browser cache for 5 minutes
                },
              }
            );
          }
        }
      }
    }
    
    // Need to recalculate statistics
    const games = await dataAccess.getUserGames(targetSteamId);
    
    // If no games, return empty statistics
    if (games.length === 0) {
      const emptyStats = {
        totalGames: 0,
        startedGames: 0,
        totalAchievements: 0,
        unlockedAchievements: 0,
        averageCompletionRate: 0,
      };
      
      // Save empty stats to cache
      await dataAccess.saveUserStatistics(targetSteamId, emptyStats);
      
      return NextResponse.json({ statistics: emptyStats });
    }
    
    // Fetch achievements for all games IN PARALLEL (not sequential)
    const achievementPromises = games.map(async (game) => {
      try {
        const achievements = await dataAccess.getUserAchievements(targetSteamId, game.appId);
        return { appId: game.appId, achievements };
      } catch (error) {
        console.warn(`Failed to load achievements for game ${game.appId}:`, error);
        return { appId: game.appId, achievements: [] };
      }
    });
    
    // Wait for all achievement fetches to complete in parallel
    const achievementResults = await Promise.all(achievementPromises);
    
    // Build the map
    const allAchievements = new Map<number, any[]>();
    achievementResults.forEach(({ appId, achievements }) => {
      if (achievements.length > 0) {
        allAchievements.set(appId, achievements);
      }
    });
    
    // Calculate statistics
    const statistics = calculateStatistics(games, allAchievements);
    
    // Save to cache
    await dataAccess.saveUserStatistics(targetSteamId, statistics);

    return NextResponse.json(
      { statistics },
      {
        headers: {
          'Cache-Control': 'private, max-age=300', // Browser cache for 5 minutes
        },
      }
    );
  } catch (error) {
    console.error('Error calculating statistics:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to calculate statistics',
      errorMessage
    );
  }
}
