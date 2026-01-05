import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';

export const maxDuration = 60; // 60 seconds
export const dynamic = 'force-dynamic';

/**
 * GET /api/user/[steamId]/sync-status
 * 
 * Calculates achievement sync progress by counting games that have been processed
 * (synced) compared to total games with playtime.
 * 
 * Games are counted as "processed" if they have metadata (either achievements or
 * a placeholder row for games with 0 achievements or failed syncs).
 * 
 * Returns:
 * - current: number of games that have been synced (have metadata)
 * - total: total games with playtime
 * - isSyncing: true if current < total (games still need syncing)
 */
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

    const dataAccess = getDataAccess();
    const games = await dataAccess.getUserGames(targetSteamId);

    // Filter to games with playtime (more likely to have achievements)
    const gamesWithPlaytime = games.filter(game => game.playtimeMinutes > 0);
    const total = gamesWithPlaytime.length;

    if (total === 0) {
      return NextResponse.json({
        current: 0,
        total: 0,
        isSyncing: false,
      });
    }

    // Batch fetch all achievement metadata in one query (avoids N+1 problem)
    // This is critical for users with large game libraries (500+ games)
    const achievementMetadata = await dataAccess.getAllAchievementMetadataForUser(targetSteamId);
    
    // Find games with playtime that are missing from the metadata map
    // These might be games that were just synced but the view hasn't updated yet
    const missingGames = gamesWithPlaytime.filter(game => !achievementMetadata.has(game.appId));
    
    
    // For missing games, check directly in the database to catch recently synced games
    // This handles read-after-write consistency where the view hasn't updated yet
    if (missingGames.length > 0) {
      // Check all missing games, but batch them to avoid overwhelming the database
      // Use a reasonable batch size (50) to balance performance and completeness
      const batchSize = 50;
      const batches = [];
      for (let i = 0; i < missingGames.length; i += batchSize) {
        batches.push(missingGames.slice(i, i + batchSize));
      }
      
      const recentlySyncedGames: Array<{ appId: number; lastSyncedAt: Date } | null> = [];
      
      // Process batches sequentially to avoid overwhelming the database
      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(async (game) => {
            try {
              const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(targetSteamId, game.appId);
              if (lastSyncedAt) {
                return { appId: game.appId, lastSyncedAt };
              }
              return null;
            } catch (error) {
              return null;
            }
          })
        );
        recentlySyncedGames.push(...batchResults);
      }
      
      // Add recently synced games to the metadata map
      let foundCount = 0;
      for (const gameData of recentlySyncedGames) {
        if (gameData && !achievementMetadata.has(gameData.appId)) {
          achievementMetadata.set(gameData.appId, {
            hasAchievements: false, // We don't know if it has achievements, but it's been synced
            lastSyncedAt: gameData.lastSyncedAt,
          });
          foundCount++;
        }
      }
    }
    
    // Process games using the batch metadata
    let current = 0;
    let latestSyncTime: Date | null = null;

    for (const game of gamesWithPlaytime) {
      const metadata = achievementMetadata.get(game.appId);
      
      // If we've synced this game (metadata exists), count it as processed
      // This includes games with achievements and games with 0 achievements (placeholders)
      if (metadata) {
        current++; // Increment for any processed game
        
        // Track the latest sync time to detect stalled syncs
        if (metadata.lastSyncedAt) {
          if (!latestSyncTime || metadata.lastSyncedAt > latestSyncTime) {
            latestSyncTime = metadata.lastSyncedAt;
          }
        }
      }
    }

    // Stalled sync detection: If sync hasn't progressed in 60 seconds and we're close to completion,
    // mark as complete to prevent infinite polling
    // Use adaptive threshold: 5% of total games (minimum 2, maximum 10) to handle both small and large libraries
    // This is more lenient to account for read-after-write consistency delays
    const completionThreshold = Math.min(10, Math.max(2, Math.ceil(total * 0.05)));
    const isStalled = latestSyncTime && 
      (Date.now() - latestSyncTime.getTime() > 60000) && 
      (total - current <= completionThreshold);
    
    // Sync is active if: Not all games have been processed AND sync is not stalled
    const isSyncing = current < total && !isStalled;

    return NextResponse.json(
      {
        current,
        total,
        isSyncing,
      },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate', // Don't cache sync status
        },
      }
    );
  } catch (error) {
    console.error('Error fetching sync status:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch sync status',
      errorMessage
    );
  }
}
