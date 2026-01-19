import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { calculateStatistics } from '@/lib/utils/statistics';
import { ApiErrors } from '@/lib/utils/api-errors';
import type { UserAchievement } from '@/lib/data/types';

// Maximum age for cached statistics (24 hours in milliseconds)
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable ISR caching

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;

    if (!steamId) {
      return ApiErrors.notAuthenticated();
    }

    const dataAccess = getDataAccess();
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get('force') === 'true';
    
    // Get user to check lastSyncAt
    const user = await dataAccess.getUser(steamId);
    if (!user) {
      return ApiErrors.userNotFound(steamId);
    }

    // Get games early (needed for cache check)
    const games = await dataAccess.getUserGames(steamId);
    
    // Check for cached statistics - trust cache if less than 1 hour old (1-hour rule)
    if (!forceRefresh) {
      const cachedStats = await dataAccess.getUserStatistics(steamId);
      
      if (cachedStats) {
        const now = new Date();
        const cacheAge = now.getTime() - cachedStats.calculatedAt.getTime();
        const ONE_HOUR_MS = 60 * 60 * 1000;
        
        // Trust cache if less than 1 hour old - stats don't need to be real-time
        // If user earns one achievement, it's okay if global average doesn't move for 45 minutes
        if (cacheAge < ONE_HOUR_MS) {
          return NextResponse.json(
            { statistics: cachedStats.statistics },
            {
              headers: {
                'Cache-Control': 'private, max-age=300', // Browser cache for 5 minutes
                'CDN-Cache-Control': 'no-store',
                'Vercel-CDN-Cache-Control': 'no-store',
              },
            }
          );
        }
      }
    }
    
    // Need to recalculate statistics
    
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
      await dataAccess.saveUserStatistics(steamId, emptyStats);
      
      return NextResponse.json({ statistics: emptyStats });
    }
    
    // Fetch achievements for all games IN PARALLEL (not sequential)
    const achievementPromises = games.map(async (game) => {
      try {
        const achievements = await dataAccess.getUserAchievements(steamId, game.appId);
        return { appId: game.appId, achievements };
      } catch (error) {
        console.warn(`Failed to load achievements for game ${game.appId}:`, error);
        return { appId: game.appId, achievements: [] };
      }
    });
    
    // Wait for all achievement fetches to complete in parallel
    const achievementResults = await Promise.all(achievementPromises);
    
    // Build the map and track games without achievements
    const allAchievements = new Map<number, UserAchievement[]>();
    const gamesWithoutAchievements: number[] = [];
    achievementResults.forEach(({ appId, achievements }) => {
      if (achievements.length > 0) {
        allAchievements.set(appId, achievements);
      } else {
        // Track games that might have achievements but aren't synced yet
        // (games with playtime are more likely to have achievements)
        const game = games.find(g => g.appId === appId);
        if (game && game.playtimeMinutes > 0) {
          gamesWithoutAchievements.push(appId);
        }
      }
    });
    
    // Log games that might be missing achievements (for debugging)
    if (gamesWithoutAchievements.length > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[Stats] ${gamesWithoutAchievements.length} games with playtime but no achievements synced:`, 
        gamesWithoutAchievements.slice(0, 10)); // Log first 10 to avoid spam
    }
    
    // Calculate statistics
    const statistics = calculateStatistics(games, allAchievements);
    
    // Save to cache
    await dataAccess.saveUserStatistics(steamId, statistics);

    return NextResponse.json(
      { statistics },
      {
        headers: {
          'Cache-Control': 'private, max-age=300', // Browser cache for 5 minutes
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
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
