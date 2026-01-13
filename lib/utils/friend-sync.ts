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
    let usedGetOwnedGames = false;
    try {
      const response = await steamClient.getRecentlyPlayedGames(friendId);
      recentlyPlayedGames = response.response?.games || [];
      if (recentlyPlayedGames.length > 0) {
        console.log(`[Friend Sync] GetRecentlyPlayedGames for ${friendId}: found ${recentlyPlayedGames.length} games`);
        console.log(`[Friend Sync] Games with timestamps:`);
        recentlyPlayedGames.forEach((g: any) => {
          const lastPlayed = g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : 'MISSING';
          const playtime2Weeks = g.playtime_2weeks || 0;
          console.log(`  - ${g.appid} (${g.name || 'unknown'}): rtime_last_played=${lastPlayed}, playtime_2weeks=${playtime2Weeks}min`);
        });
      }
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
          usedGetOwnedGames = true;
          console.log(`[Friend Sync] Using GetOwnedGames fallback for ${friendId}: found ${recentlyPlayedGames.length} recently played games (out of ${allGames.length} total)`);
          console.log(`[Friend Sync] Games: ${recentlyPlayedGames.map((g: any) => `${g.appid} (${g.name || 'unknown'}) - last played: ${g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : 'unknown'}`).join(', ')}`);
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
          // Use total playtime as delta (acceptable because it's recent playtime, not lifetime)
          const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
          const playtimeDelta = currentPlaytimeMinutes; // All playtime is "new" on first sync
          
          // Determine last_played timestamp
          let lastPlayed: Date | undefined;
          if (steamGame.rtime_last_played) {
            lastPlayed = new Date(steamGame.rtime_last_played * 1000);
          } else {
            // FIX: When rtime_last_played is missing, calculate lastPlayed by subtracting playtime from syncTime
            // This prevents games from appearing as "just played" when they were actually played earlier
            // Use playtime_2weeks if available (recent playtime), otherwise use total playtime (capped)
            const playtimeForEstimate = steamGame.playtime_2weeks 
              ? Math.min(steamGame.playtime_2weeks, 4 * 60) // Cap at 4 hours
              : Math.min(currentPlaytimeMinutes, 4 * 60); // Cap at 4 hours
            lastPlayed = new Date(syncTime.getTime() - playtimeForEstimate * 60 * 1000);
          }
          
          // Only create session if delta >= 5 minutes
          if (playtimeDelta >= 5) {
            // FIX: When lastPlayed is missing, calculate sessionEnd by subtracting playtime from syncTime
            // This prevents sessions from appearing to have happened "just now" (at sync time)
            // Cap duration at 4 hours (240 minutes) to match feed-sessions.ts logic
            const maxSessionMinutes = 4 * 60;
            const sessionMinutes = Math.min(playtimeDelta, maxSessionMinutes);
            
            let sessionEnd: Date;
            let calculatedSessionStart: Date;
            
            if (lastPlayed) {
              // If we have lastPlayed, use it for both start and end
              sessionEnd = lastPlayed;
              calculatedSessionStart = lastPlayed;
            } else {
              // Calculate end by subtracting playtime from syncTime (so it's in the past)
              // This prevents sessions from appearing to have happened "just now"
              sessionEnd = new Date(syncTime.getTime() - sessionMinutes * 60 * 1000);
              // Calculate start by subtracting playtime from end (to create proper duration)
              calculatedSessionStart = new Date(sessionEnd.getTime() - sessionMinutes * 60 * 1000);
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
              console.log(`[Friend Sync] ✨ Created first-sync session for recently played game ${steamGame.appid} (${steamGame.name || 'unknown'}): ${playtimeDelta}min`);
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

      // Determine last_played timestamp
      let lastPlayed: Date | undefined;
      if (steamGame.rtime_last_played) {
        // Steam provided timestamp - use it
        lastPlayed = new Date(steamGame.rtime_last_played * 1000);
      } else if (existingGame?.lastPlayed) {
        // Preserve existing lastPlayed if Steam didn't provide one
        lastPlayed = existingGame.lastPlayed;
      } else {
        // FIX: When rtime_last_played is missing, calculate lastPlayed by subtracting playtime from syncTime
        // This prevents games from appearing as "just played" when they were actually played earlier
        // Use playtime_2weeks if available (recent playtime), otherwise use playtime delta (capped)
        const playtimeForEstimate = steamGame.playtime_2weeks 
          ? Math.min(steamGame.playtime_2weeks, 4 * 60) // Cap at 4 hours
          : Math.min(Math.max(playtimeDelta, 0), 4 * 60); // Cap at 4 hours, ensure non-negative
        lastPlayed = new Date(syncTime.getTime() - playtimeForEstimate * 60 * 1000);
      }

      // Track if we updated the baseline (to ensure batch save uses correct value)
      let baselineUpdated = false;

      // LEDGER APPROACH: Write session to game_sessions table if delta >= 5 minutes
      if (playtimeDelta >= 5) {
        // FIX: When lastPlayed is missing, calculate sessionEnd by subtracting playtime from syncTime
        // This prevents sessions from appearing to have happened "just now" (at sync time)
        // Cap duration at 4 hours (240 minutes) to match feed-sessions.ts logic
        const maxSessionMinutes = 4 * 60;
        const sessionMinutes = Math.min(playtimeDelta, maxSessionMinutes);
        
        let sessionEnd: Date;
        let calculatedSessionStart: Date;
        
        if (lastPlayed) {
          // If we have lastPlayed, use it for both start and end
          sessionEnd = lastPlayed;
          calculatedSessionStart = lastPlayed;
        } else {
          // Calculate end by subtracting playtime from syncTime (so it's in the past)
          // This prevents sessions from appearing to have happened "just now"
          sessionEnd = new Date(syncTime.getTime() - sessionMinutes * 60 * 1000);
          // Calculate start by subtracting playtime from end (to create proper duration)
          calculatedSessionStart = new Date(sessionEnd.getTime() - sessionMinutes * 60 * 1000);
        }
        
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
    await dataAccess.updateUser(friendId, { lastSyncAt: syncTime });

    // Enhanced logging: Show which games were synced
    const syncedGameNames = gamesToUpsert.map(g => `${g.appId} (${g.name})`).join(', ');
    console.log(`[Friend Sync] Synced ${gamesToUpsert.length} games for ${friendId}: ${syncedGameNames}`);
    
    // Check if Skyrim (489830) was in recently played but not synced
    const skyrimInRecentlyPlayed = recentlyPlayedGames.some((g: any) => g.appid === 489830);
    const skyrimSynced = gamesToUpsert.some(g => g.appId === 489830);
    if (skyrimInRecentlyPlayed && !skyrimSynced) {
      console.log(`[Friend Sync] ⚠️ Skyrim (489830) was in recently played list but not synced - check filtering logic`);
    } else if (!skyrimInRecentlyPlayed) {
      console.log(`[Friend Sync] ℹ️ Skyrim (489830) not in recently played list (played >14 days ago or not in Steam API response)`);
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
