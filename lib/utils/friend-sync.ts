import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import type { Game } from '@/lib/data/access';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';

/**
 * Sync achievements for a single game
 * Returns true if sync was successful, false otherwise
 */
async function syncGameAchievements(
  friendId: string,
  appId: number,
  dataAccess: ReturnType<typeof getDataAccess>,
  steamClient: ReturnType<typeof getSteamClient>
): Promise<boolean> {
  try {
    // Check if we have cached achievements that are fresh (less than 1 hour old)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(friendId, appId);
    const userAchievements = await dataAccess.getUserAchievements(friendId, appId);
    
    // Skip if we have fresh cached achievements
    if (userAchievements.length > 0 && lastSyncedAt && lastSyncedAt > oneHourAgo) {
      return true;
    }

    // Fetch from Steam API
    const [playerAchievementsResponse, gameSchemaResponse, globalPercentages, xmlAchievements] = await Promise.all([
      steamClient.getPlayerAchievements(friendId, appId).catch(() => null),
      steamClient.getGameSchema(appId).catch(() => null),
      steamClient.getGlobalAchievementPercentages(appId).catch(() => new Map<string, number>()),
      steamClient.getPlayerAchievementsXML(friendId, appId).catch(() => new Map()),
    ]);

    // If Steam API fails, return false (but don't throw)
    if (!playerAchievementsResponse || !gameSchemaResponse) {
      // If we have cached data, that's okay - return true
      if (userAchievements.length > 0) {
        return true;
      }
      // No cached data and Steam failed - game might not have achievements or profile is private
      return false;
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
        const xmlDescription = xmlAchievements.get(schemaAch.name)?.description || '';
        const schemaDescription = schemaAch.description || '';
        const finalDescription = playerDescription || xmlDescription || schemaDescription || '';
        
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
      friendId,
      appId,
      achievements,
      unlockedAchievements,
      unlockTimes,
      globalPercentages
    );

    // Update derived_last_played if game doesn't have lastPlayed
    try {
      const game = await dataAccess.getUserGame(friendId, appId);
      if (game && !game.lastPlayed) {
        const achievementLastSynced = await dataAccess.getAchievementLastSyncedAt(friendId, appId);
        const shouldRecalculate = !game.derivedLastPlayedCalculatedAt || 
          (achievementLastSynced && achievementLastSynced > game.derivedLastPlayedCalculatedAt);

        if (shouldRecalculate) {
          const savedAchievements = await dataAccess.getUserAchievements(friendId, appId);
          const latestUnlock = getLatestAchievementUnlockTime(savedAchievements);

          if (latestUnlock) {
            const updatedGame: typeof game = {
              ...game,
              derivedLastPlayed: latestUnlock,
              derivedLastPlayedCalculatedAt: new Date(),
            };
            await dataAccess.saveUserGames(friendId, [updatedGame]);
          }
        }
      }
    } catch (error) {
      // Non-critical - if this fails, sorting will still work
      console.warn(`[Friend Sync] Failed to update derived_last_played for game ${appId}:`, error);
    }

    return true;
  } catch (error) {
    // Log error but don't throw - achievement sync failures shouldn't break the feed
    console.error(`[Friend Sync] Error syncing achievements for game ${appId}:`, error);
    return false;
  }
}

/**
 * Sync achievements for games with playtime increases
 * Only syncs games where playtime increased by >= 5 minutes
 */
async function syncFriendAchievements(
  friendId: string,
  gamesWithPlaytimeIncreases: Array<{ appId: number; playtimeDelta: number }>,
  concurrencyLimit: number = 3
): Promise<void> {
  if (gamesWithPlaytimeIncreases.length === 0) {
    return;
  }

  console.log(`[Friend Sync] Syncing achievements for ${gamesWithPlaytimeIncreases.length} games for ${friendId}`);

  const steamClient = getSteamClient();
  const dataAccess = getDataAccess();

  // Process games in batches with concurrency limit
  for (let i = 0; i < gamesWithPlaytimeIncreases.length; i += concurrencyLimit) {
    const batch = gamesWithPlaytimeIncreases.slice(i, i + concurrencyLimit);
    
    await Promise.allSettled(
      batch.map(({ appId }) => syncGameAchievements(friendId, appId, dataAccess, steamClient))
    );
  }

  console.log(`[Friend Sync] Completed achievement sync for ${gamesWithPlaytimeIncreases.length} games for ${friendId}`);
}

/**
 * Sync playtime data for a single friend using GetRecentlyPlayedGames
 * This is a lightweight sync that only updates recently played games
 * Phase 2: Also syncs achievements for games with playtime increases
 */
export async function syncFriendPlaytime(friendId: string): Promise<void> {
  try {
    const steamClient = getSteamClient();
    const dataAccess = getDataAccess();

    // Fetch recently played games from Steam
    const response = await steamClient.getRecentlyPlayedGames(friendId);
    const recentlyPlayedGames = response.response?.games || [];

    if (recentlyPlayedGames.length === 0) {
      // No recently played games - just update lastSyncAt timestamp
      await dataAccess.updateUser(friendId, { lastSyncAt: new Date() });
      console.log(`[Friend Sync] No recently played games for ${friendId}`);
      return;
    }

    // Get existing games for this friend to preserve previous_playtime_minutes
    const existingGames = await dataAccess.getUserGames(friendId);
    const existingGamesMap = new Map<number, Game>();
    existingGames.forEach(game => {
      existingGamesMap.set(game.appId, game);
    });

    // Prepare games for upsert and track games with playtime increases
    const syncTime = new Date();
    const gamesToUpsert: Game[] = [];
    const gamesWithPlaytimeIncreases: Array<{ appId: number; playtimeDelta: number }> = [];

    for (const steamGame of recentlyPlayedGames) {
      const existingGame = existingGamesMap.get(steamGame.appid);
      
      // Move current playtime to previous_playtime_minutes
      const previousPlaytimeMinutes = existingGame?.playtimeMinutes ?? steamGame.playtime_forever ?? 0;
      const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
      const playtimeDelta = currentPlaytimeMinutes - previousPlaytimeMinutes;

      // Track games with meaningful playtime increases (>= 5 minutes)
      // These are candidates for achievement syncing
      if (playtimeDelta >= 5) {
        gamesWithPlaytimeIncreases.push({
          appId: steamGame.appid,
          playtimeDelta,
        });
      }

      // Determine last_played timestamp
      let lastPlayed: Date | undefined;
      if (steamGame.rtime_last_played) {
        // Steam provided timestamp - use it
        lastPlayed = new Date(steamGame.rtime_last_played * 1000);
      } else if (existingGame?.lastPlayed) {
        // Preserve existing lastPlayed if Steam didn't provide one
        lastPlayed = existingGame.lastPlayed;
      } else {
        // Fallback to sync time
        lastPlayed = syncTime;
      }

      const game: Game = {
        appId: steamGame.appid,
        name: steamGame.name || 'Unknown Game',
        playtimeMinutes: currentPlaytimeMinutes,
        playtime2WeeksMinutes: steamGame.playtime_2weeks,
        iconUrl: existingGame?.iconUrl || steamGame.img_icon_url 
          ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_icon_url}.jpg`
          : undefined,
        logoUrl: existingGame?.logoUrl || steamGame.img_logo_url
          ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_logo_url}.jpg`
          : undefined,
        coverImageUrl: existingGame?.coverImageUrl, // Preserve existing cover image
        lastPlayed,
        previousPlaytimeMinutes: previousPlaytimeMinutes,
        playtimeLastSyncedAt: syncTime,
      };

      gamesToUpsert.push(game);
    }

    // Upsert games to database
    if (gamesToUpsert.length > 0) {
      await dataAccess.saveUserGames(friendId, gamesToUpsert);
    }

    // Update user's lastSyncAt
    await dataAccess.updateUser(friendId, { lastSyncAt: syncTime });

    console.log(`[Friend Sync] Synced ${gamesToUpsert.length} games for ${friendId}`);

    // Phase 2: Sync achievements for games with playtime increases
    // This enables achievement sessions to appear in the feed
    if (gamesWithPlaytimeIncreases.length > 0) {
      // Sync achievements in background (fire-and-forget)
      // Use lower concurrency limit (3) for achievements since they're more API-intensive
      syncFriendAchievements(friendId, gamesWithPlaytimeIncreases, 3).catch((error) => {
        console.error(`[Friend Sync] Background achievement sync failed for ${friendId}:`, error);
        // Don't throw - this is non-critical
      });
    }
  } catch (error) {
    // Log error but don't throw - background sync failures shouldn't break the feed
    console.error(`[Friend Sync] Error syncing friend ${friendId}:`, error);
    // Don't rethrow - this is a background operation
  }
}

/**
 * Sync playtime data for multiple friends with concurrency limiting
 */
export async function syncFriendsInBackground(
  friendIds: string[],
  concurrencyLimit: number = 5
): Promise<void> {
  if (friendIds.length === 0) {
    return;
  }

  console.log(`[Friend Sync] Starting background sync for ${friendIds.length} friends`);

  // Process friends in batches with concurrency limit
  for (let i = 0; i < friendIds.length; i += concurrencyLimit) {
    const batch = friendIds.slice(i, i + concurrencyLimit);
    
    // Use Promise.allSettled to ensure all friends in batch are processed
    // even if some fail
    await Promise.allSettled(
      batch.map(friendId => syncFriendPlaytime(friendId))
    );
  }

  console.log(`[Friend Sync] Completed background sync for ${friendIds.length} friends`);
}

/**
 * Get stale friends from a list of friend IDs
 * A friend is considered stale if their lastSyncAt is older than the threshold
 */
export async function getStaleFriends(
  friendIds: string[],
  staleThreshold: Date
): Promise<string[]> {
  if (friendIds.length === 0) {
    return [];
  }

  const dataAccess = getDataAccess();
  const staleFriends: string[] = [];

  // Check each friend's lastSyncAt
  // Use Promise.all for parallel checking
  const friendChecks = await Promise.allSettled(
    friendIds.map(async (friendId) => {
      const friend = await dataAccess.getUser(friendId);
      const isStale = !friend?.lastSyncAt || friend.lastSyncAt < staleThreshold;
      return { friendId, isStale };
    })
  );

  // Collect stale friend IDs
  friendChecks.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.isStale) {
      staleFriends.push(result.value.friendId);
    }
  });

  return staleFriends;
}
