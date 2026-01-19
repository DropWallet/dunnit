import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import type { Game, GameSession } from '@/lib/data/access';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import { detectNewAchievementSessions, writeAchievementSessions } from '@/lib/utils/achievement-sessions';

/**
 * Calculate sessionEnd using playtime-first heuristic engine
 * 
 * Strategy:
 * - If rtime_last_played exists: Use it (deterministic path)
 * - If first-time sync: Use syncTime - 1 hour (prevent "playing now" appearance)
 * - If sync gap > 24h: Use syncTime - playtimeDelta (historical data protection)
 * - Otherwise: Use syncTime - 31 minutes (heuristic nudge to bypass cooldown)
 * 
 * @param rtimeLastPlayed - Steam's rtime_last_played timestamp (Unix seconds) or undefined
 * @param syncTime - Current sync time
 * @param playtimeDelta - Playtime increase in minutes
 * @param existingGame - Existing game record (for sync gap calculation)
 * @param isFirstSync - Whether this is a first-time sync
 * @returns Object with sessionEnd and path used
 */
function calculateSessionEnd(
  rtimeLastPlayed: number | undefined,
  syncTime: Date,
  playtimeDelta: number,
  existingGame: Game | undefined,
  isFirstSync: boolean
): { sessionEnd: Date; path: 'deterministic' | 'heuristic-first' | 'heuristic-historical' | 'heuristic-recent' } {
  // Deterministic path: Steam provided timestamp
  if (rtimeLastPlayed) {
    return {
      sessionEnd: new Date(rtimeLastPlayed * 1000),
      path: 'deterministic',
    };
  }
  
  // Heuristic path: Steam didn't provide timestamp
  // First-time sync: Use 1-hour nudge to prevent "playing now" appearance
  if (isFirstSync) {
    return {
      sessionEnd: new Date(syncTime.getTime() - (60 * 60 * 1000)), // 1 hour
      path: 'heuristic-first',
    };
  }
  
  // Historical data protection: If last sync was > 24h ago, back-date the session
  const lastSyncAt = existingGame?.playtimeLastSyncedAt;
  if (lastSyncAt) {
    const syncGapHours = (syncTime.getTime() - lastSyncAt.getTime()) / (1000 * 60 * 60);
    if (syncGapHours > 24) {
      // Back-date: syncTime - playtimeDelta (no nudge)
      const sessionEnd = new Date(syncTime.getTime() - (playtimeDelta * 60 * 1000));
      return {
        sessionEnd,
        path: 'heuristic-historical',
      };
    }
  }
  
  // Recent sync: Use 31-minute nudge to bypass 30-minute cooldown
  return {
    sessionEnd: new Date(syncTime.getTime() - (31 * 60 * 1000)), // 31 minutes
    path: 'heuristic-recent',
  };
}

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
        const gamesIn14Days = allGames.filter((game: any) => {
          const lastPlayed = game.rtime_last_played || game.rtime_2weeks;
          return lastPlayed && lastPlayed >= fourteenDaysAgo;
        });
        recentlyPlayedGames = gamesIn14Days;
        
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
    
    // Create a set of recently played game appIds for quick lookup
    const recentlyPlayedAppIds = new Set(recentlyPlayedGames.map(g => g.appid));

    for (const steamGame of recentlyPlayedGames) {
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
          // SYNC WINDOW APPROACH: Skip playtime sessions on first-time sync
          // Update baseline but don't create session (no playtimeLastSyncedAt available)
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          
          // Save the game record
          // Use rtime_last_played if available, otherwise leave lastPlayed undefined
          const lastPlayed = steamGame.rtime_last_played 
            ? new Date(steamGame.rtime_last_played * 1000)
            : undefined;
          
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
          continue; // Skip to next game
        } else {
          // Game is NOT recently played - skip session creation (lifetime playtime)
          const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          continue; // Skip to next game
        }
      }
      
      // Move current playtime to previous_playtime_minutes
      const previousPlaytimeMinutes = existingGame?.playtimeMinutes ?? steamGame.playtime_forever ?? 0;
      const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
      const playtimeDelta = currentPlaytimeMinutes - previousPlaytimeMinutes;

      // Track if we updated the baseline (to ensure batch save uses correct value)
      let baselineUpdated = false;

      // SYNC WINDOW APPROACH: Create session if delta >= 3 minutes AND we have a previous sync time
      // Skip playtime sessions on first-time sync (no playtimeLastSyncedAt)
      const playtimeLastSyncedAt = existingGame?.playtimeLastSyncedAt;
      
      if (playtimeDelta >= 3 && playtimeLastSyncedAt) {
        // Use sync window: sessionStart = last sync time, sessionEnd = current sync time
        const syncWindowStart = playtimeLastSyncedAt;
        const syncWindowEnd = syncTime;
        
        // Round to nearest second for deduplication
        const sessionStartRounded = new Date(Math.floor(syncWindowStart.getTime() / 1000) * 1000);
        
        // Check for existing session with same (userId, appId, sessionStart rounded to nearest second)
        const existingSession = await dataAccess.getGameSessionByStartTime(friendId, steamGame.appid, sessionStartRounded);
        
        if (existingSession) {
          // Merge with existing session: add delta and update session_end
          const shouldUpdateEnd = syncWindowEnd > existingSession.sessionEnd;
          const mergedSession: GameSession = {
            id: existingSession.id,
            userId: friendId,
            appId: steamGame.appid,
            playtimeDelta: existingSession.playtimeDelta + playtimeDelta,
            sessionStart: existingSession.sessionStart,
            sessionEnd: shouldUpdateEnd ? syncWindowEnd : existingSession.sessionEnd,
            type: 'playtime',
          };
          await dataAccess.saveGameSession(mergedSession);
          
          await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
          baselineUpdated = true;
        } else {
          // Check for proximity merge (45-minute window with 1-hour gap safeguard)
          const PROXIMITY_WINDOW_MINUTES = 45;
          const GAP_SAFEGUARD_MINUTES = 60;
          const recentSession = await dataAccess.getRecentGameSession(friendId, steamGame.appid, PROXIMITY_WINDOW_MINUTES, 'playtime');
          
          if (recentSession) {
            // Check 1-hour gap safeguard: if gap between session starts > 1 hour, don't merge
            const gapBetweenStarts = Math.abs(syncWindowStart.getTime() - recentSession.sessionStart.getTime());
            const gapMinutes = gapBetweenStarts / (60 * 1000);
            
            // Also check proximity: distance between new start and existing end
            const proximityDiff = Math.abs(syncWindowStart.getTime() - recentSession.sessionEnd.getTime());
            const proximityMinutes = proximityDiff / (60 * 1000);
            
            if (gapMinutes <= GAP_SAFEGUARD_MINUTES && proximityMinutes <= PROXIMITY_WINDOW_MINUTES) {
              // Merge: stretch existing session
              const mergedSession: GameSession = {
                id: recentSession.id,
                userId: friendId,
                appId: steamGame.appid,
                playtimeDelta: recentSession.playtimeDelta + playtimeDelta,
                sessionStart: recentSession.sessionStart,
                sessionEnd: syncWindowEnd > recentSession.sessionEnd ? syncWindowEnd : recentSession.sessionEnd,
                type: 'playtime',
              };
              await dataAccess.saveGameSession(mergedSession);
              
              await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
              baselineUpdated = true;
            } else {
              // Gap too large or proximity too far - create new session
              const newSession: GameSession = {
                userId: friendId,
                appId: steamGame.appid,
                playtimeDelta,
                sessionStart: syncWindowStart,
                sessionEnd: syncWindowEnd,
                type: 'playtime',
              };
              await dataAccess.saveGameSession(newSession);
              
              await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
              baselineUpdated = true;
            }
          } else {
            // No recent session - create new
            const newSession: GameSession = {
              userId: friendId,
              appId: steamGame.appid,
              playtimeDelta,
              sessionStart: syncWindowStart,
              sessionEnd: syncWindowEnd,
              type: 'playtime',
            };
            await dataAccess.saveGameSession(newSession);
            
            await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
            baselineUpdated = true;
          }
        }

        // Track games with meaningful playtime increases (>= 3 minutes)
        // These are candidates for achievement syncing
        gamesWithPlaytimeIncreases.push({
          appId: steamGame.appid,
          playtimeDelta,
        });
      } else if (playtimeDelta >= 3 && !playtimeLastSyncedAt) {
        // First-time sync: Skip playtime session creation, but update baseline
        await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
        baselineUpdated = true;
      } else if (playtimeDelta > 0) {
        // FIX 1: Even if delta < 3, update baseline if playtime changed
        // This ensures the baseline stays in sync even for small changes
        await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
        baselineUpdated = true;
      } else if (playtimeDelta === 0) {
        // Delta=0: No playtime change detected. Update baseline but don't create session.
        // Sessions will be created on next sync when Steam's API updates playtimeDelta.
        // This simplifies the codebase and ensures more accurate timestamps.
        await dataAccess.updateGameBaseline(friendId, steamGame.appid, currentPlaytimeMinutes);
        baselineUpdated = true;
      }

      // Update user_games: use updated baseline value if we just updated it, otherwise preserve existing
      // Always ensure coverImageUrl is set (use existing if available, otherwise default header.jpg)
      const coverImageUrl = existingGame?.coverImageUrl || `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`;
      
      // Use rtime_last_played if available, otherwise preserve existing lastPlayed
      const lastPlayed = steamGame.rtime_last_played
        ? new Date(steamGame.rtime_last_played * 1000)
        : existingGame?.lastPlayed;
      
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


  // Process friends in batches with concurrency limit
  for (let i = 0; i < friendIds.length; i += concurrencyLimit) {
    const batch = friendIds.slice(i, i + concurrencyLimit);
    
    // Use Promise.allSettled to ensure all friends in batch are processed
    // even if some fail
    await Promise.allSettled(
      batch.map(friendId => syncFriendPlaytime(friendId))
    );
  }

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
