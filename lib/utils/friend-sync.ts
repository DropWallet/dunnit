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
    // OPTIMIZATION #4: Removed XML API call - it's slow and rate-limited
    // XML was only used as fallback for descriptions, but player achievements API
    // provides descriptions for unlocked achievements, and schema provides them for locked ones
    const [playerAchievementsResponse, gameSchemaResponse, globalPercentages] = await Promise.all([
      steamClient.getPlayerAchievements(friendId, appId).catch(() => null),
      steamClient.getGameSchema(appId).catch(() => null),
      steamClient.getGlobalAchievementPercentages(appId).catch(() => new Map<string, number>()),
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
 * Only syncs games where playtime increased by >= 3 minutes
 */
async function syncFriendAchievements(
  friendId: string,
  gamesWithPlaytimeIncreases: Array<{ appId: number; playtimeDelta: number }>,
  concurrencyLimit: number = 3
): Promise<void> {
  if (gamesWithPlaytimeIncreases.length === 0) {
    return;
  }

  const steamClient = getSteamClient();
  const dataAccess = getDataAccess();

  // Process games in batches with concurrency limit
  for (let i = 0; i < gamesWithPlaytimeIncreases.length; i += concurrencyLimit) {
    const batch = gamesWithPlaytimeIncreases.slice(i, i + concurrencyLimit);
    
    await Promise.allSettled(
      batch.map(({ appId }) => syncGameAchievements(friendId, appId, dataAccess, steamClient))
    );
  }
}

/**
 * Sync playtime data for a single friend using GetRecentlyPlayedGames
 * This is a lightweight sync that only updates recently played games
 * Phase 2: Also syncs achievements for games with playtime increases
 */
/**
 * Ensure user record exists in database, creating it if necessary
 * This is needed because updateUser requires the user to exist
 * Returns true if user exists (or was created), false if creation failed
 */
async function ensureUserExists(
  friendId: string,
  steamClient: ReturnType<typeof getSteamClient>,
  dataAccess: ReturnType<typeof getDataAccess>
): Promise<boolean> {
  // Check if user already exists
  const existingUser = await dataAccess.getUser(friendId);
  if (existingUser) {
    return true;
  }

  // User doesn't exist - try to create from Steam API
  try {
    const playerSummary = await steamClient.getPlayerSummary(friendId);
    
    if (!playerSummary) {
      console.log(`[Friend Sync] Could not fetch player summary for ${friendId} (profile may be private or invalid)`);
      // PRIVACY FIX: Mark as private if we can't get player summary (likely 401)
      try {
        await dataAccess.updateUser(friendId, { isPrivate: true });
        console.log(`[Friend Sync] 🔒 Marked ${friendId} as private (no player summary)`);
      } catch (updateError) {
        // User might not exist yet, that's OK
      }
      return false;
    }
    
    // PRIVACY FIX: Check communityVisibilityState and mark as private if needed
    const isPrivate = playerSummary.communityvisibilitystate === 1 || playerSummary.communityvisibilitystate === 2;

    // Transform Steam API response to our User format
    const now = new Date();
    const newUser = {
      steamId: friendId,
      username: playerSummary.personaname || 'Unknown',
      avatarUrl: playerSummary.avatarfull || playerSummary.avatar || '',
      profileUrl: playerSummary.profileurl || '',
      countryCode: playerSummary.loccountrycode || undefined,
      countryName: undefined, // Steam API doesn't provide country name directly
      joinDate: playerSummary.timecreated ? new Date(playerSummary.timecreated * 1000) : undefined,
      communityVisibilityState: playerSummary.communityvisibilitystate,
      isPrivate: isPrivate, // PRIVACY FIX: Set privacy flag based on communityVisibilityState
      createdAt: now,
      updatedAt: now,
    };

    // Save to database (upsert handles race conditions if multiple syncs create simultaneously)
    await dataAccess.saveUser(newUser);
    console.log(`[Friend Sync] Created user record for ${friendId} (${newUser.username})`);
    return true;
  } catch (error) {
    // If Steam API fails, log but don't fail the sync
    // Games and sessions can still be created without user record
    console.error(`[Friend Sync] Failed to create user record for ${friendId}:`, error);
    return false;
  }
}

export async function syncFriendPlaytime(friendId: string): Promise<void> {
  try {
    // DEBUG: Log sync trigger for Spelunky user
    const isSpelunkyUser = friendId === '76561198014408203';
    if (isSpelunkyUser) {
      const stackTrace = new Error().stack;
      const caller = stackTrace?.split('\n')[2]?.trim() || 'unknown';
      console.log(`[Friend Sync] 🔍 DEBUG: syncFriendPlaytime called for Spelunky user ${friendId}`);
      console.log(`[Friend Sync] 🔍   - Caller: ${caller}`);
    }
    
    const steamClient = getSteamClient();
    const dataAccess = getDataAccess();

    // FIX #4: Ensure user exists before attempting to update
    // This prevents silent failures when updateUser is called on non-existent users
    await ensureUserExists(friendId, steamClient, dataAccess);

    // Try GetRecentlyPlayedGames first (more accurate for recent games)
    let recentlyPlayedGames: any[] = [];
    let usedGetOwnedGames = false;
    try {
      const response = await steamClient.getRecentlyPlayedGames(friendId);
      recentlyPlayedGames = response.response?.games || [];
    } catch (error) {
      // PRIVACY FIX: Check if error is 401 (private profile)
      const isPrivateError = error instanceof Error && error.message.includes('401');
      if (isPrivateError) {
        // Mark user as private immediately
        try {
          await dataAccess.updateUser(friendId, { isPrivate: true });
          console.log(`[Friend Sync] 🔒 Marked ${friendId} as private (401 from GetRecentlyPlayedGames)`);
        } catch (updateError) {
          console.error(`[Friend Sync] Failed to mark user as private:`, updateError);
        }
        // Don't fall back to GetOwnedGames if profile is private - respect privacy
        return;
      }
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
          usedGetOwnedGames = true;
        }
      } catch (error) {
        // PRIVACY FIX: Check if error is 401 (private profile)
        const isPrivateError = error instanceof Error && error.message.includes('401');
        if (isPrivateError) {
          // Mark user as private immediately
          try {
            await dataAccess.updateUser(friendId, { isPrivate: true });
            console.log(`[Friend Sync] 🔒 Marked ${friendId} as private (401 from GetOwnedGames)`);
          } catch (updateError) {
            console.error(`[Friend Sync] Failed to mark user as private:`, updateError);
          }
        }
        // Both APIs failed - profile likely fully private
        console.log(`[Friend Sync] Both GetRecentlyPlayedGames and GetOwnedGames failed for ${friendId}`);
      }
    }

    // PRIVACY FIX: Mark user as public if we successfully fetched games
    // (even if no games were found, the API call succeeded so profile is public)
    try {
      await dataAccess.updateUser(friendId, { isPrivate: false, lastSyncAt: new Date() });
    } catch (updateError) {
      // User might not exist yet, that's OK
    }
    
    if (recentlyPlayedGames.length === 0) {
      // No recently played games - just update lastSyncAt timestamp
      // User should exist from ensureUserExists call above, but handle gracefully if not
      try {
        await dataAccess.updateUser(friendId, { lastSyncAt: new Date() });
      } catch (error) {
        // If update fails (user still doesn't exist), try creating user again
        const userExists = await ensureUserExists(friendId, steamClient, dataAccess);
        if (userExists) {
          await dataAccess.updateUser(friendId, { lastSyncAt: new Date() });
        } else {
          console.log(`[Friend Sync] Could not update lastSyncAt for ${friendId} (user record creation failed)`);
        }
      }
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
    
    // Track Steam API reliability metrics
    const apiReliabilityStats = {
      totalGames: 0,
      withRtimeLastPlayed: 0,
      missingRtimeLastPlayed: 0,
      usingDbFallback: 0,
      staleLastPlayed: 0,
      skippedMissingLastPlayed: 0,
      skippedStaleLastPlayed: 0,
      gamesWithMissingRtime: [] as Array<{ appId: number; name: string }>,
      gamesWithStaleLastPlayed: [] as Array<{ appId: number; name: string; playtimeDelta: number }>,
    };

    // Create a set of recently played game appIds for quick lookup
    const recentlyPlayedAppIds = new Set(recentlyPlayedGames.map(g => g.appid));

    for (const steamGame of recentlyPlayedGames) {
      apiReliabilityStats.totalGames++;
      const existingGame = existingGamesMap.get(steamGame.appid);
      
      // REFINED FIX: On first sync, only skip if game is NOT in recently played list
      // If game IS in recently played list, it was played within 14 days, so create a session
      // This handles edge case: friend signs up, plays game, you refresh feed before they sync
      if (!existingGame) {
        // Check if this game is in the recently played list (played within 14 days)
        const isRecentlyPlayed = recentlyPlayedAppIds.has(steamGame.appid);
        
        if (isRecentlyPlayed) {
          // Game is recently played - create session even on first sync
          // Use playtime_2weeks (recent playtime) for session delta, not total lifetime playtime
          // This accurately reflects recent activity within the 14-day window
          const playtime2Weeks = steamGame.playtime_2weeks ?? 0;
          const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
          
          // Use playtime_2weeks for delta, but fallback to playtime_forever (capped) if 2weeks is 0 or missing
          // Cap at 4 hours to match feed-sessions.ts logic
          const maxSessionMinutes = 4 * 60;
          const playtimeDelta = playtime2Weeks > 0 
            ? Math.min(playtime2Weeks, maxSessionMinutes)
            : Math.min(currentPlaytimeMinutes, maxSessionMinutes);
          
          // SIMPLIFIED: Only use Steam's rtime_last_played timestamp
          // If Steam doesn't provide it, we skip session creation and wait for Steam to update
          let lastPlayed: Date | undefined;
          if (steamGame.rtime_last_played) {
            lastPlayed = new Date(steamGame.rtime_last_played * 1000);
          }
          
          // Only create session if delta >= 3 minutes AND lastPlayed exists
          if (playtimeDelta >= 3) {
            // SIMPLIFIED: Require lastPlayed to exist
            if (!lastPlayed) {
              console.log(`[Friend Sync] ⏭️ Skipping first-sync session for ${steamGame.appid} (${steamGame.name || 'unknown'}): playtime=${playtimeDelta}min but lastPlayed missing - waiting for Steam`);
              // Still update baseline
              await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
              continue; // Skip to next game
            }
            
            // We have playtime and timestamp - create session
            const sessionMinutes = playtimeDelta;
            const sessionEnd = lastPlayed;
            let calculatedSessionStart = new Date(lastPlayed.getTime() - sessionMinutes * 60 * 1000);
            
            // Safety Guard: Ensure sessionStart is ALWAYS before sessionEnd
            // This prevents database constraint violations from Steam's "jittery" data
            if (calculatedSessionStart >= sessionEnd) {
              // Fallback for edge cases or Steam weirdness
              // Ensure at least a 1-second difference so DB constraints don't trip
              calculatedSessionStart = new Date(sessionEnd.getTime() - 1000);
            }
            
            const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
            
            // Check for existing session first
            const existingSession = await dataAccess.getGameSessionByStartTime(friendId, steamGame.appid, sessionStartRounded);
            
            if (!existingSession) {
              // Create new session for recently played game on first sync
              const newSession: GameSession = {
                userId: friendId,
                appId: steamGame.appid,
                playtimeDelta,
                sessionStart: calculatedSessionStart,
                sessionEnd: sessionEnd,
                type: 'playtime',
              };
              await dataAccess.saveGameSession(newSession);
              const durationMinutes = (newSession.sessionEnd.getTime() - newSession.sessionStart.getTime()) / 60000;
              console.log(`[Friend Sync] ✨ Created first-sync session for recently played game ${steamGame.appid} (${steamGame.name || 'unknown'}): ${playtimeDelta}min, start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min`);
            }
          }
          
          // Update baseline after creating session (or if delta too small)
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          
          // FIX: Save the game with lastPlayed so it appears in "Recently played"
          // Always use default header.jpg URL to ensure correct images (matches user games API)
          const coverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`;
          
          const game: Game = {
            appId: steamGame.appid,
            name: steamGame.name || 'Unknown Game',
            playtimeMinutes: currentPlaytimeMinutes,
            playtime2WeeksMinutes: steamGame.playtime_2weeks,
            iconUrl: steamGame.img_icon_url 
              ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_icon_url}.jpg`
              : undefined,
            logoUrl: steamGame.img_logo_url
              ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_logo_url}.jpg`
              : undefined,
            coverImageUrl,
            lastPlayed,
            previousPlaytimeMinutes: currentPlaytimeMinutes,
            playtimeLastSyncedAt: syncTime,
          };
          
          gamesToUpsert.push(game);
          console.log(`[Friend Sync] ✅ Updated baseline for ${steamGame.appid} (${steamGame.name || 'unknown'}): previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (first sync, recently played)`);
          continue; // Skip to next game
        } else {
          // Game is NOT recently played - skip session creation (lifetime playtime)
          const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          console.log(`[Friend Sync] ⏭️ Skipping session creation for ${steamGame.appid} (${steamGame.name || 'unknown'}) on first sync (not recently played): setting baseline to ${currentPlaytimeMinutes}min`);
          continue; // Skip to next game
        }
      }
      
      // Move current playtime to previous_playtime_minutes
      const previousPlaytimeMinutes = existingGame?.playtimeMinutes ?? steamGame.playtime_forever ?? 0;
      const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
      const playtimeDelta = currentPlaytimeMinutes - previousPlaytimeMinutes;

      // SIMPLIFIED: Only use Steam's rtime_last_played timestamp
      // If Steam doesn't provide it, we skip session creation and wait for Steam to update
      let lastPlayed: Date | undefined;
      if (steamGame.rtime_last_played) {
        // Steam provided timestamp - use it (this is our source of truth)
        lastPlayed = new Date(steamGame.rtime_last_played * 1000);
        apiReliabilityStats.withRtimeLastPlayed++;
      } else {
        apiReliabilityStats.missingRtimeLastPlayed++;
        apiReliabilityStats.gamesWithMissingRtime.push({
          appId: steamGame.appid,
          name: steamGame.name || 'unknown',
        });
        if (existingGame?.lastPlayed) {
          // Preserve existing lastPlayed if Steam didn't provide one (for game record, not session creation)
          lastPlayed = existingGame.lastPlayed;
          apiReliabilityStats.usingDbFallback++;
        }
      }
      // If lastPlayed is missing, we don't create a session - wait for Steam to update

      // Track if we updated the baseline (to ensure batch save uses correct value)
      let baselineUpdated = false;

      // SIMPLIFIED: Write session to game_sessions table if delta >= 3 minutes
      // Only create session if we have a valid lastPlayed timestamp from Steam
      if (playtimeDelta >= 3) {
        // DEBUG: Log session creation details for Spelunky (239350) to understand duplicate sessions
        const isSpelunky = steamGame.appid === 239350;
        if (isSpelunky) {
          console.log(`[Friend Sync] 🔍 DEBUG Spelunky session creation for ${friendId}:`);
          console.log(`[Friend Sync] 🔍   - previousPlaytimeMinutes: ${previousPlaytimeMinutes}min`);
          console.log(`[Friend Sync] 🔍   - currentPlaytimeMinutes: ${currentPlaytimeMinutes}min`);
          console.log(`[Friend Sync] 🔍   - playtimeDelta: ${playtimeDelta}min`);
          console.log(`[Friend Sync] 🔍   - lastPlayed: ${lastPlayed ? lastPlayed.toISOString() : 'MISSING'}`);
          console.log(`[Friend Sync] 🔍   - existingGame.lastPlayed: ${existingGame?.lastPlayed ? existingGame.lastPlayed.toISOString() : 'MISSING'}`);
        }
        
        // SIMPLIFIED: Require lastPlayed to exist and be different from existing
        // If Steam hasn't updated the timestamp yet, skip this sync and wait
        if (!lastPlayed) {
          apiReliabilityStats.skippedMissingLastPlayed++;
          console.log(`[Friend Sync] ⏭️ Skipping ${steamGame.appid} (${steamGame.name || 'unknown'}): playtime increased (${playtimeDelta}min) but lastPlayed missing - waiting for Steam to update`);
          // Still update baseline to track the playtime increase
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          baselineUpdated = true;
          continue; // Skip to next game
        }
        
        // Check if lastPlayed actually changed (Steam updated the timestamp)
        const isTimestampStale = existingGame?.lastPlayed && 
          lastPlayed.getTime() === existingGame.lastPlayed.getTime();
        
        if (isTimestampStale) {
          apiReliabilityStats.staleLastPlayed++;
          apiReliabilityStats.skippedStaleLastPlayed++;
          apiReliabilityStats.gamesWithStaleLastPlayed.push({
            appId: steamGame.appid,
            name: steamGame.name || 'unknown',
            playtimeDelta,
          });
          console.log(`[Friend Sync] ⏭️ Skipping ${steamGame.appid} (${steamGame.name || 'unknown'}): playtime increased (${playtimeDelta}min) but lastPlayed unchanged - Steam is lagging, waiting for next sync`);
          // Still update baseline to track the playtime increase
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          baselineUpdated = true;
          continue; // Skip to next game
        }
        
        // We have new playtime AND new timestamp - create session
        // Cap duration at 4 hours (240 minutes) to match feed-sessions.ts logic
        const maxSessionMinutes = 4 * 60;
        const sessionMinutes = Math.min(playtimeDelta, maxSessionMinutes);
        
        // Use lastPlayed as sessionEnd (Steam's source of truth)
        const sessionEnd = lastPlayed;
        let calculatedSessionStart = new Date(lastPlayed.getTime() - sessionMinutes * 60 * 1000);
        
        // Safety Guard: Ensure sessionStart is ALWAYS before sessionEnd
        // This prevents database constraint violations from Steam's "jittery" data
        if (calculatedSessionStart >= sessionEnd) {
          // Fallback for edge cases or Steam weirdness
          // Ensure at least a 1-second difference so DB constraints don't trip
          calculatedSessionStart = new Date(sessionEnd.getTime() - 1000);
        }
        
        if (isSpelunky) {
          console.log(`[Friend Sync] 🔍   - calculated sessionEnd: ${sessionEnd.toISOString()}`);
          console.log(`[Friend Sync] 🔍   - calculated sessionStart: ${calculatedSessionStart.toISOString()}`);
        }
        
        const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
        
        // FIX 3: Check for existing session with same (userId, appId, sessionStart rounded to nearest second)
        // This prevents duplicate sessions even if they're older than 30 minutes
        const existingSession = await dataAccess.getGameSessionByStartTime(friendId, steamGame.appid, sessionStartRounded);
        
        if (isSpelunky) {
          console.log(`[Friend Sync] 🔍   - existingSession by startTime: ${existingSession ? `FOUND (id: ${existingSession.id}, delta: ${existingSession.playtimeDelta}min, end: ${existingSession.sessionEnd.toISOString()})` : 'NONE'}`);
        }
        
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
          if (isSpelunky) {
            console.log(`[Friend Sync] 🔍   - About to update baseline: currentPlaytimeMinutes=${currentPlaytimeMinutes}min, previousPlaytimeMinutes=${previousPlaytimeMinutes}min`);
          }
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          baselineUpdated = true;
          console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
          if (isSpelunky) {
            console.log(`[Friend Sync] 🔍   - Baseline updated successfully: baselineUpdated=${baselineUpdated}`);
          }
        } else {
          // Check for recent playtime session within 30 minutes (for continuous play sessions)
          // This handles cases where game.lastPlayed changes between syncs, causing different sessionStart values
          // ALSO check for sessions ending within 2 hours of the session we're creating (to catch same-day sessions)
          const recentSession = await dataAccess.getRecentGameSession(friendId, steamGame.appid, 30, 'playtime');
          
          // If no recent session found, also check for sessions ending within 2 hours of the session we're creating
          // This catches cases where syncs happen hours apart but sessions are from the same play session
          let nearbySession = recentSession;
          if (!nearbySession) {
            const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
            const nearbyCutoff = new Date(sessionEnd.getTime() - TWO_HOURS_MS);
            const allRecentSessions = await dataAccess.getGameSessions([friendId], 10, 0, 1); // Last 1 day
            nearbySession = allRecentSessions
              .filter(s => s.appId === steamGame.appid && s.type === 'playtime')
              .find(s => {
                const timeDiff = Math.abs(s.sessionEnd.getTime() - sessionEnd.getTime());
                return timeDiff <= TWO_HOURS_MS;
              }) || null;
          }
          
          if (isSpelunky) {
            console.log(`[Friend Sync] 🔍   - recentSession (30min from now): ${recentSession ? `FOUND (id: ${recentSession.id}, delta: ${recentSession.playtimeDelta}min, end: ${recentSession.sessionEnd.toISOString()})` : 'NONE'}`);
            if (!recentSession && nearbySession) {
              console.log(`[Friend Sync] 🔍   - nearbySession (2hr from session end): FOUND (id: ${nearbySession.id}, delta: ${nearbySession.playtimeDelta}min, end: ${nearbySession.sessionEnd.toISOString()})`);
            }
          }
          
          const sessionToCheck = nearbySession;
          
          if (sessionToCheck) {
            // Check if sessions are actually close in time (proximity check)
            // Use same logic as achievement session proximity check
            const THIRTY_MINUTES_MS = 30 * 60 * 1000;
            const timeDiff = Math.min(
              Math.abs(sessionToCheck.sessionStart.getTime() - sessionEnd.getTime()),
              Math.abs(calculatedSessionStart.getTime() - sessionToCheck.sessionEnd.getTime())
            );
            
            if (timeDiff <= THIRTY_MINUTES_MS) {
              // Sessions are close enough - merge with recent session
              const shouldUpdateEnd = sessionEnd > sessionToCheck.sessionEnd;
              const mergedSession: GameSession = {
                id: sessionToCheck.id,
                userId: friendId,
                appId: steamGame.appid,
                playtimeDelta: sessionToCheck.playtimeDelta + playtimeDelta,
                sessionStart: sessionToCheck.sessionStart, // Keep original start time
                sessionEnd: shouldUpdateEnd ? sessionEnd : sessionToCheck.sessionEnd, // Only update if actually newer
                type: 'playtime',
              };
              await dataAccess.saveGameSession(mergedSession);
              console.log(`[Friend Sync] Merged with ${recentSession ? 'recent' : 'nearby'} session for game ${steamGame.appid}: added ${playtimeDelta}min (total: ${mergedSession.playtimeDelta}min), timeDiff: ${(timeDiff / 1000 / 60).toFixed(1)}min, ${shouldUpdateEnd ? 'updated end time' : 'kept original end time'}`);
              
              // FIX 1: Update baseline AFTER successful session save
              if (isSpelunky) {
                console.log(`[Friend Sync] 🔍   - About to update baseline (recent merge): currentPlaytimeMinutes=${currentPlaytimeMinutes}min, previousPlaytimeMinutes=${previousPlaytimeMinutes}min`);
              }
              await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
              baselineUpdated = true;
              console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
              if (isSpelunky) {
                console.log(`[Friend Sync] 🔍   - Baseline updated successfully (recent merge): baselineUpdated=${baselineUpdated}`);
              }
            } else {
              if (isSpelunky) {
                console.log(`[Friend Sync] 🔍   - Nearby session found but too far apart: ${(timeDiff / 1000 / 60).toFixed(1)}min (threshold: 30min)`);
              }
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
              const durationMinutes = (newSession.sessionEnd.getTime() - newSession.sessionStart.getTime()) / 60000;
              console.log(`[Friend Sync] Created new session for game ${steamGame.appid}: ${playtimeDelta}min (${recentSession ? 'recent' : 'nearby'} session found but too far: ${(timeDiff / 1000 / 60).toFixed(1)}min), start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min`);
              if (isSpelunky) {
                console.log(`[Friend Sync] 🔍   - CREATED NEW SESSION (not merged): id=${newSession.id}, start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, delta=${newSession.playtimeDelta}min`);
                console.log(`[Friend Sync] 🔍   - About to update baseline (new session, ${recentSession ? 'recent' : 'nearby'} too far): currentPlaytimeMinutes=${currentPlaytimeMinutes}min, previousPlaytimeMinutes=${previousPlaytimeMinutes}min`);
              }
              
              // FIX 1: Update baseline AFTER successful session save
              await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
              baselineUpdated = true;
              console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
              if (isSpelunky) {
                console.log(`[Friend Sync] 🔍   - Baseline updated successfully (new session): baselineUpdated=${baselineUpdated}`);
              }
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
            const durationMinutes = (newSession.sessionEnd.getTime() - newSession.sessionStart.getTime()) / 60000;
            console.log(`[Friend Sync] Created new session for game ${steamGame.appid}: ${playtimeDelta}min, start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min`);
            if (isSpelunky) {
              console.log(`[Friend Sync] 🔍   - CREATED NEW SESSION (no recent session): id=${newSession.id}, start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, delta=${newSession.playtimeDelta}min`);
              console.log(`[Friend Sync] 🔍   - About to update baseline (new session, no recent): currentPlaytimeMinutes=${currentPlaytimeMinutes}min, previousPlaytimeMinutes=${previousPlaytimeMinutes}min`);
            }
            
            // FIX 1: Update baseline AFTER successful session save
            // This "empties" the delta tank so the next sync won't process the same delta again
            await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
            baselineUpdated = true;
            console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
            if (isSpelunky) {
              console.log(`[Friend Sync] 🔍   - Baseline updated successfully (new session): baselineUpdated=${baselineUpdated}`);
            }
          }
        }

        // Track games with meaningful playtime increases (>= 3 minutes)
        // These are candidates for achievement syncing
        gamesWithPlaytimeIncreases.push({
          appId: steamGame.appid,
          playtimeDelta,
        });
      } else if (playtimeDelta > 0) {
        // FIX 1: Even if delta < 3, update baseline if playtime changed
        // This ensures the baseline stays in sync even for small changes
        await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
        baselineUpdated = true;
        console.log(`[Friend Sync] ✅ Updated baseline for game ${steamGame.appid}: delta=${playtimeDelta}min (too small for session), previousPlaytimeMinutes = ${currentPlaytimeMinutes}min (was ${previousPlaytimeMinutes}min)`);
      } else if (playtimeDelta === 0) {
        // FALLBACK: Only use when delta=0 AND recent activity detected AND no recent session exists
        // This fixes cases where games were synced after playtime was already at current value
        // SIMPLIFIED: Still require lastPlayed to exist (no syncTime fallbacks)
        const playtime2Weeks = steamGame.playtime_2weeks ?? 0;
        const fourteenDaysAgo = new Date(syncTime.getTime() - 14 * 24 * 60 * 60 * 1000);
        const hasRecentActivity = playtime2Weeks > 0 || (lastPlayed && lastPlayed >= fourteenDaysAgo);
        
        if (hasRecentActivity && playtime2Weeks >= 3) {
          // SIMPLIFIED: Require lastPlayed to exist for this fallback too
          if (!lastPlayed) {
            apiReliabilityStats.skippedMissingLastPlayed++;
            console.log(`[Friend Sync] ⏭️ Skipping ${steamGame.appid} (${steamGame.name || 'unknown'}): delta=0, playtime_2weeks=${playtime2Weeks}min but lastPlayed missing - waiting for Steam`);
            // Still update baseline
            await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
            baselineUpdated = true;
            continue;
          }
          
          // FIX 1: Check for recent session FIRST (within 30 minutes) - prevents duplicates
          // Same check as normal playtimeDelta path
          const recentSession = await dataAccess.getRecentGameSession(friendId, steamGame.appid, 30, 'playtime');
          
          if (recentSession) {
            // Recent session exists - don't create duplicate
            console.log(`[Friend Sync] ⏭️ Skipping session creation for game ${steamGame.appid} (${steamGame.name || 'unknown'}): recent session exists (delta=0 case, playtime_2weeks=${playtime2Weeks}min)`);
            // Still update baseline to keep it in sync
            await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
            baselineUpdated = true;
            continue; // Skip to next game
          }
          
          // No recent session - check for existing session to calculate duration difference
          const existingSessions = await dataAccess.getGameSessions([friendId], 100, 0, 14);
          const existingSession = existingSessions.find(
            s => s.appId === steamGame.appid && s.type === 'playtime'
          );
          
          // FIX 2: Calculate actual new playtime (difference, not total)
          const previousPlaytime = existingSession?.playtimeDelta ?? 0;
          const newPlaytime = playtime2Weeks - previousPlaytime;
          
          // Only create if there's actual new playtime (>= 3 minutes)
          if (newPlaytime >= 3) {
            const maxSessionMinutes = 4 * 60;
            const sessionMinutes = Math.min(Math.max(newPlaytime, 3), maxSessionMinutes);
            
            // SIMPLIFIED: Always use lastPlayed (Steam's source of truth)
            // No syncTime fallbacks - if lastPlayed is stale, we accept the delay
            const sessionEnd = lastPlayed;
            
            // VALIDATION: Check if lastPlayed is suspiciously recent when delta=0
            // If lastPlayed is within the last 2 hours but playtimeDelta=0, it might be a Steam API glitch
            // Check if there's already a very recent session (within 2 hours) - if so, skip to prevent duplicates
            const twoHoursAgo = new Date(syncTime.getTime() - 2 * 60 * 60 * 1000);
            if (lastPlayed > twoHoursAgo && playtimeDelta === 0) {
              const veryRecentSession = await dataAccess.getRecentGameSession(friendId, steamGame.appid, 120, 'playtime'); // 120 minutes = 2 hours
              if (veryRecentSession) {
                console.log(`[Friend Sync] ⚠️ Suspicious lastPlayed for ${steamGame.appid} (${steamGame.name || 'unknown'}): lastPlayed=${lastPlayed.toISOString()} is very recent but playtimeDelta=0 and recent session exists (id=${veryRecentSession.id}) - Steam API may be incorrect, skipping session`);
                await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
                baselineUpdated = true;
                continue;
              }
            }
            
            // Calculate session start by subtracting duration from session end
            const sessionDurationMs = sessionMinutes * 60 * 1000;
            let calculatedSessionStart = new Date(sessionEnd.getTime() - sessionDurationMs);
            
            // Safety Guard: Ensure sessionStart is ALWAYS before sessionEnd
            // This prevents database constraint violations from Steam's "jittery" data
            if (calculatedSessionStart >= sessionEnd) {
              // Fallback for edge cases or Steam weirdness
              // Ensure at least a 1-second difference so DB constraints don't trip
              calculatedSessionStart = new Date(sessionEnd.getTime() - 1000);
            }
            
            const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
            
            // Double-check for existing session with same start time (safety check)
            const existingSessionByStartTime = await dataAccess.getGameSessionByStartTime(friendId, steamGame.appid, sessionStartRounded);
            
            if (!existingSessionByStartTime) {
              const newSession: GameSession = {
                userId: friendId,
                appId: steamGame.appid,
                playtimeDelta: newPlaytime, // FIX 3: Store only new playtime (difference), not total playtime_2weeks
                sessionStart: calculatedSessionStart,
                sessionEnd: sessionEnd,
                type: 'playtime',
              };
              await dataAccess.saveGameSession(newSession);
              const durationMinutes = (newSession.sessionEnd.getTime() - newSession.sessionStart.getTime()) / 60000;
              
              // DEBUG: Log where lastPlayed came from
              const lastPlayedSource = steamGame.rtime_last_played 
                ? `Steam API (${new Date(steamGame.rtime_last_played * 1000).toISOString()})` 
                : existingGame?.lastPlayed 
                  ? `Database (${existingGame.lastPlayed.toISOString()})` 
                  : 'UNKNOWN';
              
              if (existingSession) {
                console.log(`[Friend Sync] ✨ Created new session for game ${steamGame.appid} (${steamGame.name || 'unknown'}): delta=0 but playtime_2weeks increased (${newPlaytime}min new playtime, total=${playtime2Weeks}min, previous=${previousPlaytime}min), start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min, lastPlayed source: ${lastPlayedSource}`);
              } else {
                console.log(`[Friend Sync] ✨ Created session for game ${steamGame.appid} (${steamGame.name || 'unknown'}): delta=0 but recent activity (playtime_2weeks=${playtime2Weeks}min, last_played=${lastPlayed ? lastPlayed.toISOString() : 'NULL'}, lastPlayed source: ${lastPlayedSource}), start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min`);
              }
            } else {
              console.log(`[Friend Sync] ⏭️ Skipping session creation for ${steamGame.appid}: session already exists with same start time (delta=0 case)`);
            }
          } else {
            console.log(`[Friend Sync] ⏭️ Skipping session creation for ${steamGame.appid}: no new playtime detected (playtime_2weeks=${playtime2Weeks}min, previous=${previousPlaytime}min, new=${newPlaytime}min < 3min)`);
          }
        }
        
        // Always update baseline even when delta = 0 (to keep it in sync)
        await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
        baselineUpdated = true;
      }

      // Update user_games: use updated baseline value if we just updated it, otherwise preserve existing
      // Always ensure coverImageUrl is set (use existing if available, otherwise default header.jpg)
      const coverImageUrl = existingGame?.coverImageUrl || `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`;
      
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
        coverImageUrl,
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
    // User should exist from ensureUserExists call above, but handle gracefully if not
    try {
      await dataAccess.updateUser(friendId, { lastSyncAt: syncTime });
    } catch (error) {
      // If update fails (user still doesn't exist), try creating user again
      const userExists = await ensureUserExists(friendId, steamClient, dataAccess);
      if (userExists) {
        await dataAccess.updateUser(friendId, { lastSyncAt: syncTime });
      } else {
        console.log(`[Friend Sync] Could not update lastSyncAt for ${friendId} (user record creation failed)`);
      }
    }

    // Check if Skyrim (489830) was in recently played but not synced
    const skyrimInRecentlyPlayed = recentlyPlayedGames.some((g: any) => g.appid === 489830);
    const skyrimSynced = gamesToUpsert.some(g => g.appId === 489830);
    if (skyrimInRecentlyPlayed && !skyrimSynced) {
      console.log(`[Friend Sync] ⚠️ Skyrim (489830) was in recently played list but not synced - check filtering logic`);
    } else if (!skyrimInRecentlyPlayed) {
      console.log(`[Friend Sync] ℹ️ Skyrim (489830) not in recently played list (played >14 days ago or not in Steam API response)`);
    }

    // Log Steam API reliability statistics
    if (apiReliabilityStats.totalGames > 0) {
      const rtimeProvidedPercent = ((apiReliabilityStats.withRtimeLastPlayed / apiReliabilityStats.totalGames) * 100).toFixed(1);
      const missingPercent = ((apiReliabilityStats.missingRtimeLastPlayed / apiReliabilityStats.totalGames) * 100).toFixed(1);
      const stalePercent = apiReliabilityStats.totalGames > 0 
        ? ((apiReliabilityStats.staleLastPlayed / apiReliabilityStats.totalGames) * 100).toFixed(1)
        : '0.0';
      
      console.log(`[Friend Sync] 📊 Steam API Reliability Stats for ${friendId}:`);
      console.log(`[Friend Sync] 📊   Total games processed: ${apiReliabilityStats.totalGames}`);
      console.log(`[Friend Sync] 📊   rtime_last_played provided: ${apiReliabilityStats.withRtimeLastPlayed} (${rtimeProvidedPercent}%)`);
      console.log(`[Friend Sync] 📊   rtime_last_played missing: ${apiReliabilityStats.missingRtimeLastPlayed} (${missingPercent}%)`);
      console.log(`[Friend Sync] 📊   Using DB fallback: ${apiReliabilityStats.usingDbFallback}`);
      console.log(`[Friend Sync] 📊   Stale lastPlayed (unchanged): ${apiReliabilityStats.staleLastPlayed} (${stalePercent}%)`);
      console.log(`[Friend Sync] 📊   Skipped (missing lastPlayed): ${apiReliabilityStats.skippedMissingLastPlayed}`);
      console.log(`[Friend Sync] 📊   Skipped (stale lastPlayed): ${apiReliabilityStats.skippedStaleLastPlayed}`);
      
      if (apiReliabilityStats.gamesWithMissingRtime.length > 0) {
        console.log(`[Friend Sync] 📊   Games missing rtime_last_played: ${apiReliabilityStats.gamesWithMissingRtime.map(g => `${g.name} (${g.appId})`).join(', ')}`);
      }
      
      if (apiReliabilityStats.gamesWithStaleLastPlayed.length > 0) {
        console.log(`[Friend Sync] 📊   Games with stale lastPlayed: ${apiReliabilityStats.gamesWithStaleLastPlayed.map(g => `${g.name} (${g.appId}, +${g.playtimeDelta}min)`).join(', ')}`);
      }
    }

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
