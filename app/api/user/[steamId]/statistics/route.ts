import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { getSteamClient } from '@/lib/steam/client';
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
    let user = await dataAccess.getUser(targetSteamId);
    
    // If user not in database, try fetching from Steam API (same as user endpoint)
    if (!user) {
      try {
        const steamClient = getSteamClient();
        const playerSummary = await steamClient.getPlayerSummary(targetSteamId);
        
        if (!playerSummary) {
          return ApiErrors.userNotFound(targetSteamId);
        }

        // Transform Steam API response to our User format
        const now = new Date();
        const newUser = {
          steamId: targetSteamId,
          username: playerSummary.personaname || 'Unknown',
          avatarUrl: playerSummary.avatarfull || playerSummary.avatar || '',
          profileUrl: playerSummary.profileurl || '',
          countryCode: playerSummary.loccountrycode || undefined,
          countryName: undefined, // Steam API doesn't provide country name directly
          joinDate: playerSummary.timecreated ? new Date(playerSummary.timecreated * 1000) : undefined,
          communityVisibilityState: playerSummary.communityvisibilitystate,
          createdAt: now,
          updatedAt: now,
        };

        // Save to database for future use
        await dataAccess.saveUser(newUser);
        user = newUser;
      } catch (error) {
        console.error(`Error fetching user ${targetSteamId} from Steam API:`, error);
        return ApiErrors.userNotFound(targetSteamId);
      }
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
          
          // Also check if any achievements were synced after stats were calculated
          // This is more accurate than just checking user.lastSyncAt
          // We sample a few games to avoid performance issues
          let achievementsSyncedAfter = false;
          if (!dataChanged) {
            // Get games to check (sample games with playtime, as they're more likely to have achievements)
            const games = await dataAccess.getUserGames(targetSteamId);
            const gamesToCheck = games
              .filter(g => g.playtimeMinutes > 0)
              .slice(0, 10); // Sample first 10 games with playtime
            
            // Check if any of these games had achievements synced after stats were calculated
            for (const game of gamesToCheck) {
              const lastSynced = await dataAccess.getAchievementLastSyncedAt(targetSteamId, game.appId);
              if (lastSynced && lastSynced.getTime() > cachedStats.calculatedAt.getTime()) {
                achievementsSyncedAfter = true;
                break;
              }
            }
          }
          
          // If data hasn't changed and no achievements were synced, return cached statistics
          if (!dataChanged && !achievementsSyncedAfter) {
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
    
    // Build the map and track games without achievements
    const allAchievements = new Map<number, any[]>();
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
