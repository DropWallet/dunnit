import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import { detectNewAchievementSessions, writeAchievementSessions } from '@/lib/utils/achievement-sessions';
import { batchWithConcurrency, BATCH_CONFIG } from '@/lib/utils/rate-limiter';
import type { UserAchievement } from '@/lib/data/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface BatchRequest {
  appIds: number[];
  refresh?: boolean;
  steamId?: string; // Optional: for viewing friend's achievements
}

interface AchievementResult {
  appId: number;
  achievements: UserAchievement[];
  error?: string;
  privacyBlocked?: boolean;
}

/**
 * Fetch achievements for a single game.
 * Reuses the same logic as the individual achievements endpoint:
 * - 14-day cache check
 * - Stale cache detection
 * - Steam API fetch with error handling
 * - Achievement session detection
 */
async function fetchGameAchievements(
  steamId: string,
  appId: number,
  forceRefresh: boolean
): Promise<{ achievements: UserAchievement[]; error?: string; privacyBlocked?: boolean }> {
  const dataAccess = getDataAccess();

  // Track if we get a 403 (privacy) error from Steam API
  let privacyBlocked = false;

  // 14-day cache check (same logic as individual endpoint)
  const game = await dataAccess.getUserGame(steamId, appId);
  if (game) {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const lastPlayed = game.lastPlayed ? new Date(game.lastPlayed) : null;
    const derivedLastPlayed = game.derivedLastPlayed ? new Date(game.derivedLastPlayed) : null;

    const isRecentlyPlayed = (lastPlayed && lastPlayed > fourteenDaysAgo) ||
                             (derivedLastPlayed && derivedLastPlayed > fourteenDaysAgo);

    if (!isRecentlyPlayed && !forceRefresh) {
      const userAchievements = await dataAccess.getUserAchievements(steamId, appId);
      // Don't use cache if:
      // 1. No cached achievements (need to fetch from Steam)
      // 2. Achievements exist but none are unlocked (stale privacy-blocked data)
      const hasNoAchievements = userAchievements.length === 0;
      const hasAchievementsButNoneUnlocked = userAchievements.length > 0 &&
        !userAchievements.some(a => a.unlocked);
      const unlockedCount = userAchievements.filter(a => a.unlocked).length;
      if (!hasNoAchievements && !hasAchievementsButNoneUnlocked) {
        return { achievements: userAchievements };
      }
      // Fall through to refresh from Steam
    }
  }

  let userAchievements = await dataAccess.getUserAchievements(steamId, appId);

  // Stale cache check
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(steamId, appId);
  const isStale = !lastSyncedAt || lastSyncedAt < oneHourAgo;

  // Check for "suspicious" data: achievements exist but none are unlocked
  // This can happen when data was synced while profile was private (403 errors)
  // In this case, force a refresh to get the actual unlock status
  const hasAchievementsButNoneUnlocked = userAchievements.length > 0 &&
    !userAchievements.some(a => a.unlocked);

  const unlockedCount = userAchievements.filter(a => a.unlocked).length;
  const shouldCallSteam = userAchievements.length === 0 || isStale || forceRefresh || hasAchievementsButNoneUnlocked;

  if (shouldCallSteam) {
    const oldAchievements = userAchievements;
    if (forceRefresh) {
      await dataAccess.clearUserAchievements(steamId, appId);
    }

    const steamClient = getSteamClient();

    const [playerAchievementsResponse, gameSchemaResponse, globalPercentages] = await Promise.all([
      steamClient.getPlayerAchievements(steamId, appId).catch((err) => {
        if (err.message?.includes('403')) {
          privacyBlocked = true;
        }
        return null;
      }),
      steamClient.getGameSchema(appId).catch(() => null),
      steamClient.getGlobalAchievementPercentages(appId).catch(() => new Map<string, number>()),
    ]);

    if (!playerAchievementsResponse || !gameSchemaResponse) {
      if (userAchievements.length > 0) {
        return { achievements: userAchievements, privacyBlocked };
      }
      return { achievements: [], privacyBlocked };
    }

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

    const achievements = (gameSchemaResponse.game.availableGameStats?.achievements || []).map(
      (schemaAch) => {
        const playerDescription = achievementDescriptions.get(schemaAch.name);
        const schemaDescription = schemaAch.description || '';
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

    await dataAccess.saveUserAchievements(
      steamId,
      appId,
      achievements,
      unlockedAchievements,
      unlockTimes,
      globalPercentages
    );

    // Detect achievement sessions
    const newAchievements = await dataAccess.getUserAchievements(steamId, appId);
    const achievementSessions = detectNewAchievementSessions(
      oldAchievements,
      newAchievements,
      steamId,
      appId
    );

    if (achievementSessions.length > 0) {
      await writeAchievementSessions(steamId, appId, achievementSessions);
    }

    // Update derived_last_played if needed
    try {
      const updatedGame = await dataAccess.getUserGame(steamId, appId);
      if (updatedGame && !updatedGame.lastPlayed) {
        const achievementLastSynced = await dataAccess.getAchievementLastSyncedAt(steamId, appId);
        const shouldRecalculate = !updatedGame.derivedLastPlayedCalculatedAt ||
          (achievementLastSynced && achievementLastSynced > updatedGame.derivedLastPlayedCalculatedAt);

        if (shouldRecalculate) {
          const savedAchievements = await dataAccess.getUserAchievements(steamId, appId);
          const latestUnlock = getLatestAchievementUnlockTime(savedAchievements);

          if (latestUnlock) {
            const gameWithDerived = {
              ...updatedGame,
              derivedLastPlayed: latestUnlock,
              derivedLastPlayedCalculatedAt: new Date(),
            };
            await dataAccess.saveUserGames(steamId, [gameWithDerived]);
          }
        }
      }
    } catch (error) {
      console.warn(`[Batch] Failed to update derived_last_played for game ${appId}:`, error);
    }

    userAchievements = await dataAccess.getUserAchievements(steamId, appId);
  }

  return { achievements: userAchievements, privacyBlocked };
}

/**
 * POST /api/achievements/batch
 *
 * Fetches achievements for multiple games with concurrency control.
 * Respects Steam API rate limits by processing in batches with delays.
 *
 * Request body:
 * {
 *   "appIds": [123, 456, 789],
 *   "refresh": false,       // Force refresh from Steam API
 *   "steamId": "optional"   // For viewing friend's achievements
 * }
 *
 * Response:
 * {
 *   "results": [
 *     { "appId": 123, "achievements": [...] },
 *     { "appId": 456, "achievements": [...] },
 *     { "appId": 789, "achievements": [...], "error": "..." }  // Partial failures
 *   ],
 *   "processed": 3,
 *   "failed": 0,
 *   "timeMs": 450
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    const loggedInSteamId = request.cookies.get('steam_id')?.value;

    if (!loggedInSteamId) {
      return ApiErrors.notAuthenticated();
    }

    const body: BatchRequest = await request.json();
    const { appIds, refresh = false, steamId: targetSteamId } = body;

    if (!appIds || !Array.isArray(appIds)) {
      return ApiErrors.missingParameter('appIds');
    }

    if (appIds.length === 0) {
      return NextResponse.json({ results: [], processed: 0, failed: 0, timeMs: 0 });
    }

    // Enforce max batch size
    if (appIds.length > BATCH_CONFIG.MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Batch size exceeds maximum of ${BATCH_CONFIG.MAX_BATCH_SIZE} games` },
        { status: 400 }
      );
    }

    const steamId = targetSteamId || loggedInSteamId;

    // Process with concurrency control
    const batchResults = await batchWithConcurrency(
      appIds,
      BATCH_CONFIG.CONCURRENCY,
      BATCH_CONFIG.DELAY_MS,
      async (appId: number) => {
        return fetchGameAchievements(steamId, appId, refresh);
      }
    );

    // Transform results and track privacy blocks
    const results: AchievementResult[] = batchResults.map(({ item, result, error }) => ({
      appId: item,
      achievements: result?.achievements || [],
      ...(error && { error }),
      ...(result?.privacyBlocked && { privacyBlocked: true }),
    }));

    // Check if any game was blocked due to privacy settings (403 from Steam)
    const anyPrivacyBlocked = results.some(r => r.privacyBlocked);
    const failed = results.filter(r => r.error).length;
    const timeMs = Math.round(performance.now() - startTime);

    return NextResponse.json(
      {
        results,
        processed: results.length,
        failed,
        privacyBlocked: anyPrivacyBlocked,
        timeMs,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    if (error instanceof Error && !error.message.includes('HeadersOverflowError')) {
      console.error('[Batch] Error:', error);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError('Failed to fetch batch achievements', errorMessage);
  }
}
