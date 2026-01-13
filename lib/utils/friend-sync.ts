import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import type { Game, GameSession } from '@/lib/data/access';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import { detectNewAchievementSessions, writeAchievementSessions } from '@/lib/utils/achievement-sessions';

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
    
    // Get old achievements BEFORE saving (to detect new unlocks)
    const oldAchievements = await dataAccess.getUserAchievements(friendId, appId);
    
    // Skip if we have fresh cached achievements
    if (oldAchievements.length > 0 && lastSyncedAt && lastSyncedAt > oneHourAgo) {
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
      if (oldAchievements.length > 0) {
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

    // LEDGER APPROACH: Write achievement sessions to game_sessions table
    // Fetch new achievements after save to detect new unlocks
    const newAchievements = await dataAccess.getUserAchievements(friendId, appId);
    
    // Detect new unlocks and group into sessions
    const achievementSessions = detectNewAchievementSessions(
      oldAchievements,
      newAchievements,
      friendId,
      appId
    );

    // Write achievement sessions to database
    if (achievementSessions.length > 0) {
      await writeAchievementSessions(friendId, appId, achievementSessions);
    }

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

    // Try GetRecentlyPlayedGames first (more accurate for recent games)
    let recentlyPlayedGames: any[] = [];
    try {
      const response = await steamClient.getRecentlyPlayedGames(friendId);
      recentlyPlayedGames = response.response?.games || [];
    } catch (error) {
      // GetRecentlyPlayedGames failed (likely privacy) - fall back to GetOwnedGames
      console.log(`[Friend Sync] GetRecentlyPlayedGames failed for ${friendId}, falling back to GetOwnedGames`);
    }

    // If GetRecentlyPlayedGames returned empty, try GetOwnedGames as fallback
    // This handles cases where game details are private but profile is public
    if (recentlyPlayedGames.length === 0) {
      try {
        const ownedGamesResponse = await steamClient.getOwnedGames(friendId, true);
        const allGames = ownedGamesResponse.response?.games || [];
        
        // Filter to games played in last 14 days (similar to GetRecentlyPlayedGames scope)
        const fourteenDaysAgo = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60);
        recentlyPlayedGames = allGames.filter((game: any) => {
          // Include if has rtime_last_played within 14 days
          return game.rtime_last_played && game.rtime_last_played > fourteenDaysAgo;
        });
        
        if (recentlyPlayedGames.length > 0) {
          console.log(`[Friend Sync] Using GetOwnedGames fallback for ${friendId}: found ${recentlyPlayedGames.length} recently played games`);
        }
      } catch (error) {
        // Both APIs failed - profile likely fully private
        console.log(`[Friend Sync] Both GetRecentlyPlayedGames and GetOwnedGames failed for ${friendId}`);
      }
    }

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
      
      // FIX: Skip session creation on first sync (when existingGame is null)
      // We need a baseline to compare against - can't create sessions from lifetime playtime
      if (!existingGame) {
        // First sync: Just update baseline, don't create session
        // The next sync will have a baseline to compare against
        const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
        await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
        console.log(`[Friend Sync] ⏭️ Skipping session creation for ${steamGame.appid} (${steamGame.name || 'unknown'}) on first sync: setting baseline to ${currentPlaytimeMinutes}min`);
        continue; // Skip to next game
      }
      
      // Move current playtime to previous_playtime_minutes
      const previousPlaytimeMinutes = existingGame?.playtimeMinutes ?? steamGame.playtime_forever ?? 0;
      const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
      const playtimeDelta = currentPlaytimeMinutes - previousPlaytimeMinutes;

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

      // Track if we updated the baseline (to ensure batch save uses correct value)
      let baselineUpdated = false;

      // LEDGER APPROACH: Write session to game_sessions table if delta >= 5 minutes
      if (playtimeDelta >= 5) {
        // FIX 2: Use lastPlayed if available (regardless of age), otherwise use syncTime
        const sessionEnd = lastPlayed || syncTime;
        const calculatedSessionStart = lastPlayed || syncTime;
        const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
        
        // FIX 3: Check for existing session with same (userId, appId, sessionStart rounded to nearest second)
        // This prevents duplicate sessions even if they're older than 30 minutes
        const existingSession = await dataAccess.getGameSessionByStartTime(friendId, steamGame.appid, sessionStartRounded);
        
        if (existingSession) {
          // Merge with existing session: add delta and update session_end
          // BUT: Only update sessionEnd if the new time is actually AFTER the existing sessionEnd
          // This prevents sessions from appearing "newer" than they actually are
          const shouldUpdateEnd = sessionEnd > existingSession.sessionEnd;
          const mergedSession: GameSession = {
            id: existingSession.id,
            userId: friendId,
            appId: steamGame.appid,
            playtimeDelta: existingSession.playtimeDelta + playtimeDelta,
            sessionStart: existingSession.sessionStart, // Keep original start time
            sessionEnd: shouldUpdateEnd ? sessionEnd : existingSession.sessionEnd, // Only update if actually newer
            type: 'playtime',
          };
          await dataAccess.saveGameSession(mergedSession);
          console.log(`[Friend Sync] Merged session for game ${steamGame.appid}: added ${playtimeDelta}min (total: ${mergedSession.playtimeDelta}min), ${shouldUpdateEnd ? 'updated end time' : 'kept original end time'}`);
          
          // FIX 1: Update baseline AFTER successful session save
          // This "empties" the delta tank so the next sync won't process the same delta again
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          baselineUpdated = true;
          console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
        } else {
          // Check for recent playtime session within 30 minutes (for continuous play sessions)
          // This handles cases where game.lastPlayed changes between syncs, causing different sessionStart values
          const recentSession = await dataAccess.getRecentGameSession(friendId, steamGame.appid, 30, 'playtime');
          
          if (recentSession) {
            // Check if sessions are actually close in time (proximity check)
            // Use same logic as achievement session proximity check
            const THIRTY_MINUTES_MS = 30 * 60 * 1000;
            const timeDiff = Math.min(
              Math.abs(recentSession.sessionStart.getTime() - sessionEnd.getTime()),
              Math.abs(calculatedSessionStart.getTime() - recentSession.sessionEnd.getTime())
            );
            
            if (timeDiff <= THIRTY_MINUTES_MS) {
              // Sessions are close enough - merge with recent session
              const shouldUpdateEnd = sessionEnd > recentSession.sessionEnd;
              const mergedSession: GameSession = {
                id: recentSession.id,
                userId: friendId,
                appId: steamGame.appid,
                playtimeDelta: recentSession.playtimeDelta + playtimeDelta,
                sessionStart: recentSession.sessionStart, // Keep original start time
                sessionEnd: shouldUpdateEnd ? sessionEnd : recentSession.sessionEnd, // Only update if actually newer
                type: 'playtime',
              };
              await dataAccess.saveGameSession(mergedSession);
              console.log(`[Friend Sync] Merged with recent session for game ${steamGame.appid}: added ${playtimeDelta}min (total: ${mergedSession.playtimeDelta}min), timeDiff: ${(timeDiff / 1000 / 60).toFixed(1)}min, ${shouldUpdateEnd ? 'updated end time' : 'kept original end time'}`);
              
              // FIX 1: Update baseline AFTER successful session save
              await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
              baselineUpdated = true;
              console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
            } else {
              // Sessions are not close enough - create new session
              const newSession: GameSession = {
                userId: friendId,
                appId: steamGame.appid,
                playtimeDelta,
                sessionStart: calculatedSessionStart,
                sessionEnd: sessionEnd,
                type: 'playtime',
              };
              await dataAccess.saveGameSession(newSession);
              console.log(`[Friend Sync] Created new session for game ${steamGame.appid}: ${playtimeDelta}min (recent session found but too far: ${(timeDiff / 1000 / 60).toFixed(1)}min)`);
              
              // FIX 1: Update baseline AFTER successful session save
              await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
              baselineUpdated = true;
              console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
            }
          } else {
            // Create new session
            const newSession: GameSession = {
              userId: friendId,
              appId: steamGame.appid,
              playtimeDelta,
              sessionStart: calculatedSessionStart,
              sessionEnd: sessionEnd,
              type: 'playtime',
            };
            await dataAccess.saveGameSession(newSession);
            console.log(`[Friend Sync] Created new session for game ${steamGame.appid}: ${playtimeDelta}min`);
            
            // FIX 1: Update baseline AFTER successful session save
            // This "empties" the delta tank so the next sync won't process the same delta again
            await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
            baselineUpdated = true;
            console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
          }
        }

        // Track games with meaningful playtime increases (>= 5 minutes)
        // These are candidates for achievement syncing
        gamesWithPlaytimeIncreases.push({
          appId: steamGame.appid,
          playtimeDelta,
        });
      } else if (playtimeDelta > 0) {
        // FIX 1: Even if delta < 5, update baseline if playtime changed
        // This ensures the baseline stays in sync even for small changes
        await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
        baselineUpdated = true;
        console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: delta=${playtimeDelta}min (too small for session), previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
      }

      // Update user_games: use updated baseline value if we just updated it, otherwise preserve existing
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
        // Use currentPlaytimeMinutes if we just updated the baseline, otherwise preserve existing
        previousPlaytimeMinutes: baselineUpdated ? currentPlaytimeMinutes : (existingGame?.previousPlaytimeMinutes ?? currentPlaytimeMinutes),
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
