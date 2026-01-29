import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { getSteamClient } from '@/lib/steam/client';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';

// Number of games to sync immediately before returning response
const INITIAL_SYNC_BATCH_SIZE = 25;

// Maximum concurrent Steam API calls to prevent overwhelming the system
// This prevents HeadersOverflowError and gateway timeouts
const MAX_CONCURRENT_SYNC = 8;

// Simple concurrency limiter
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  async limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        this.running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      };

      if (this.running < MAX_CONCURRENT_SYNC) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
}

/**
 * Retry helper for HeadersOverflowError
 * Retries the function once after a delay if HeadersOverflowError occurs
 */
async function retryOnHeadersOverflow<T>(
  fn: () => Promise<T>,
  maxRetries: number = 1,
  retryDelay: number = 2000
): Promise<T | null> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      const errorMessage = lastError.message || '';
      
      // Check if this is a HeadersOverflowError
      if (errorMessage.includes('HeadersOverflowError') || errorMessage.includes('UND_ERR_HEADERS_OVERFLOW')) {
        if (attempt < maxRetries) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      // If not HeadersOverflowError or max retries reached, return null
      return null;
    }
  }
  
  return null;
}

/**
 * Sync achievements for a single game from Steam API
 * @param onPrivacyBlocked - Called when Steam returns 403 (game details private)
 */
async function syncGameAchievements(
  steamId: string,
  appId: number,
  dataAccess: ReturnType<typeof getDataAccess>,
  steamClient: ReturnType<typeof getSteamClient>,
  onPrivacyBlocked?: () => void
): Promise<void> {
  try {
    // Check if we have cached achievements
    const userAchievements = await dataAccess.getUserAchievements(steamId, appId);
    const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(steamId, appId);
    
    // Check if cache is stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isStale = !lastSyncedAt || lastSyncedAt < oneHourAgo;
    
    // Skip if we have fresh cached achievements
    if (userAchievements.length > 0 && !isStale) {
      return;
    }

    // Fetch player achievements with 403 detection for privacy modal
    const getPlayerAchWithPrivacy = async () => {
      try {
        return await steamClient.getPlayerAchievements(steamId, appId);
      } catch (err) {
        if (err instanceof Error && err.message?.includes('403')) {
          onPrivacyBlocked?.();
          return null;
        }
        throw err;
      }
    };

    // OPTIMIZATION #4: Removed XML API call - it's slow and rate-limited
    const [playerAchievementsResponse, gameSchemaResponse, globalPercentages] = await Promise.all([
      retryOnHeadersOverflow(getPlayerAchWithPrivacy),
      retryOnHeadersOverflow(() => steamClient.getGameSchema(appId)),
      steamClient.getGlobalAchievementPercentages(appId).catch(() => new Map<string, number>()),
    ]);

    // If Steam API fails, create a placeholder to mark this game as "attempted but failed"
    // This prevents the progress bar from getting stuck on games that can't be synced
    if (!playerAchievementsResponse || !gameSchemaResponse) {
      // Create a placeholder to mark this game as "attempted but failed"
      // This prevents the progress bar from getting stuck
      try {
        await dataAccess.saveUserAchievements(
          steamId,
          appId,
          [], // Empty achievements array will trigger placeholder creation
          [],
          undefined,
          undefined
        );
      } catch (error) {
        // Silently fail - placeholder creation is best effort
        // Don't log to avoid noise from expected failures
      }
      return;
    }

    // Extract unlocked achievement API names, unlock times, and descriptions
    const unlockedAchievements: string[] = [];
    const unlockTimes = new Map<string, number>();
    const achievementDescriptions = new Map<string, string>();
    
    if (playerAchievementsResponse.playerstats?.achievements) {
      playerAchievementsResponse.playerstats.achievements.forEach((ach) => {
        if (ach.achieved === 1) {
          unlockedAchievements.push(ach.apiname);
          if (ach.unlocktime > 0) {
            unlockTimes.set(ach.apiname, ach.unlocktime);
          }
          if (ach.description) {
            achievementDescriptions.set(ach.apiname, ach.description);
          }
        }
      });
    }

    // Transform schema achievements to our format
    const achievements = (gameSchemaResponse.game.availableGameStats?.achievements || []).map(
      (schemaAch) => {
        const playerDescription = achievementDescriptions.get(schemaAch.name);
        const schemaDescription = schemaAch.description || '';
        // OPTIMIZATION #4: Removed XML fallback - player achievements API provides descriptions for unlocked,
        // and schema provides descriptions for locked achievements (except hidden ones, which are hidden by design)
        const finalDescription = playerDescription || schemaDescription || '';
        
        return {
          appId,
          apiName: schemaAch.name,
          name: schemaAch.displayName,
          description: finalDescription,
          iconUrl: schemaAch.icon,
          iconGrayUrl: schemaAch.icongray,
          hidden: schemaAch.hidden === 1,
        };
      }
    );

    // Save to cache
    await dataAccess.saveUserAchievements(
      steamId,
      appId,
      achievements,
      unlockedAchievements,
      unlockTimes,
      globalPercentages
    );

    // Update derived_last_played if needed
    try {
      const game = await dataAccess.getUserGame(steamId, appId);
      if (game && !game.lastPlayed) {
        const savedAchievements = await dataAccess.getUserAchievements(steamId, appId);
        const latestUnlock = getLatestAchievementUnlockTime(savedAchievements);

        if (latestUnlock) {
          const updatedGame = {
            ...game,
            derivedLastPlayed: latestUnlock,
            derivedLastPlayedCalculatedAt: new Date(),
          };
          await dataAccess.saveUserGames(steamId, [updatedGame]);
        }
      }
    } catch (error) {
      // Non-critical - skip if this fails
    }
  } catch (error) {
    // Silently fail for individual games - might be private or no achievements
    // Don't log to avoid noise from expected failures
  }
}

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
    const user = await dataAccess.getUser(targetSteamId);
    const games = await dataAccess.getUserGames(targetSteamId);

    // FIX 3: Only sync achievements for games with recent playtime (within 14 days)
    // This reduces API calls significantly - only sync games that are actively being played
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const gamesWithRecentPlaytime = games.filter(game => {
      // Check if game has been played recently (within 14 days)
      const lastPlayed = game.lastPlayed ? new Date(game.lastPlayed) : null;
      const derivedLastPlayed = game.derivedLastPlayed ? new Date(game.derivedLastPlayed) : null;
      
      // Include if either lastPlayed or derivedLastPlayed is within 14 days
      return (lastPlayed && lastPlayed > fourteenDaysAgo) || 
             (derivedLastPlayed && derivedLastPlayed > fourteenDaysAgo);
    });

    // Filter to games with playtime (more likely to have achievements)
    const gamesWithPlaytime = gamesWithRecentPlaytime.filter(game => game.playtimeMinutes > 0);

    // Check if we need to sync achievements
    // Sync if: no user, cache is stale, or sample check shows missing achievements
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let shouldSync = false;
    
    if (gamesWithPlaytime.length > 0) {
      if (!user?.lastSyncAt || user.lastSyncAt < oneHourAgo) {
        shouldSync = true;
      } else {
        // Sample check: if first few games have no cached achievements, sync is needed
        const sampleGames = gamesWithPlaytime.slice(0, 5);
        const sampleChecks = await Promise.all(
          sampleGames.map(async (game) => {
            const achievements = await dataAccess.getUserAchievements(targetSteamId, game.appId);
            const lastSynced = await dataAccess.getAchievementLastSyncedAt(targetSteamId, game.appId);
            return achievements.length === 0 || !lastSynced || lastSynced < oneHourAgo;
          })
        );
        shouldSync = sampleChecks.some(needsSync => needsSync);
      }
    }

    // Track if we actually started syncing (not just detected stale games)
    let actuallySyncing = false;
    let privacyBlocked = false;
    const onPrivacyBlocked = () => { privacyBlocked = true; };

    // If sync needed, sync first batch immediately, then continue in background
    if (shouldSync && gamesWithPlaytime.length > 0) {
      const steamClient = getSteamClient();
      const limiter = new ConcurrencyLimiter();
      
      // Sync first batch immediately (for quick response) with concurrency limit
      const initialBatch = gamesWithPlaytime.slice(0, INITIAL_SYNC_BATCH_SIZE);
      await Promise.all(
        initialBatch.map(game => 
          limiter.limit(() => syncGameAchievements(targetSteamId, game.appId, dataAccess, steamClient, onPrivacyBlocked))
        )
      );

      // Mark that we actually started syncing
      actuallySyncing = true;

      // Continue syncing remaining games in background (fire and forget) with concurrency limit
      const remainingGames = gamesWithPlaytime.slice(INITIAL_SYNC_BATCH_SIZE);
      if (remainingGames.length > 0) {
        // Don't await - let this run in background
        Promise.all(
          remainingGames.map(game => 
            limiter.limit(() => syncGameAchievements(targetSteamId, game.appId, dataAccess, steamClient, onPrivacyBlocked))
          )
        ).catch(() => {
          // Silently fail - background sync errors are not critical
        });
      }
    }

    // Fetch all cached achievements (including newly synced ones)
    // Return ALL cached achievements from ALL games (not just recently played)
    // The sync optimization above only affects which games get synced, not what's returned
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
      { 
        achievements: allAchievements,
        isSyncing: actuallySyncing,
        privacyBlocked,
      },
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
