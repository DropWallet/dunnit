import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import type { Game } from '@/lib/data/access';

/**
 * Sync playtime data for a single friend using GetRecentlyPlayedGames
 * This is a lightweight sync that only updates recently played games
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

    // Prepare games for upsert
    const syncTime = new Date();
    const gamesToUpsert: Game[] = [];

    for (const steamGame of recentlyPlayedGames) {
      const existingGame = existingGamesMap.get(steamGame.appid);
      
      // Move current playtime to previous_playtime_minutes
      const previousPlaytimeMinutes = existingGame?.playtimeMinutes ?? steamGame.playtime_forever ?? 0;
      const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;

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
