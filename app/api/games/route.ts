import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import type { Game, GameSession } from '@/lib/data/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable ISR caching

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;
    
    if (!steamId) {
      return ApiErrors.notAuthenticated();
    }

    // Check if we have cached games
    const dataAccess = getDataAccess();
    const user = await dataAccess.getUser(steamId);
    let games = await dataAccess.getUserGames(steamId);

    // Check if we should refresh: no games, no user, or cache is stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Debug: Log the full request URL to see what parameters are being received
    const refreshParam = request.nextUrl.searchParams.get('refresh');
    const shouldRefresh = games.length === 0 || 
      !user?.lastSyncAt || 
      user.lastSyncAt < oneHourAgo ||
      refreshParam === 'true';
    
    if (shouldRefresh) {
      console.log('[Games API] Starting refresh - fetching from Steam API');
      const steamClient = getSteamClient();
      
      // Fetch both full library and recently played games
      // GetRecentlyPlayedGames is more reliable for "Date Played" sorting
      const [fullLibraryResponse, recentlyPlayedResponse] = await Promise.all([
        steamClient.getOwnedGames(steamId, true),
        steamClient.getRecentlyPlayedGames(steamId).catch((error) => {
          console.warn('[Games API] GetRecentlyPlayedGames failed:', error);
          // Silently fail - this endpoint may not be available in some cases
          return { response: { games: [] } };
        }),
      ]);
      
      console.log('[Games API] Steam API responses:', {
        fullLibraryGames: fullLibraryResponse.response?.games?.length || 0,
        recentlyPlayedGames: recentlyPlayedResponse.response?.games?.length || 0,
        recentlyPlayedSample: recentlyPlayedResponse.response?.games?.slice(0, 3).map((g: any) => ({
          appid: g.appid,
          name: g.name,
          rtime_last_played: g.rtime_last_played,
        })),
      });

      // Create a map of recently played games for quick lookup
      const recentlyPlayedMap = new Map<number, { rtime_last_played?: number; playtime_2weeks?: number }>();
      if (recentlyPlayedResponse.response?.games && recentlyPlayedResponse.response.games.length > 0) {
        recentlyPlayedResponse.response.games.forEach((game) => {
          recentlyPlayedMap.set(game.appid, {
            rtime_last_played: game.rtime_last_played,
            playtime_2weeks: game.playtime_2weeks,
          });
        });
        console.log('[Games API] Created recently played map with', recentlyPlayedMap.size, 'games');
      } else {
        console.log('[Games API] No recently played games found');
      }

      // Transform Steam API response to our Game format
      // Use cached coverImageUrl when available, otherwise use default header.jpg
      // Store API images are fetched on-demand when header.jpg fails to load (see /api/games/[appId]/image)
      const gamesBatch = fullLibraryResponse.response.games || [];
      const defaultHeaderPattern = /\/steam\/apps\/\d+\/header\.jpg$/;
      
      // Use existing cached games to get coverImageUrl (avoid N+1 queries)
      // We already have games from getUserGames() at line 19, use that data
      const existingGamesMap = new Map<number, Game>();
      games.forEach(game => {
        existingGamesMap.set(game.appId, game);
      });
      
      // Process all games - use cached images or default header.jpg
      // Merge data from GetRecentlyPlayedGames to supplement lastPlayed information
      // Apply "Watermark Fallback" strategy for games in recently played list
      const syncTime = new Date();
      let gamesWithRecentLastPlayed = 0;
      let gamesWithLibraryLastPlayed = 0;
      let gamesWithWatermarkFallback = 0;
      let gamesWithNoLastPlayed = 0;
      
      games = gamesBatch.map((steamGame) => {
        // Check if this game is in the recently played list (more reliable data)
        const recentGame = recentlyPlayedMap.get(steamGame.appid);
        const existingGame = existingGamesMap.get(steamGame.appid);
        const existingLastPlayed = existingGame?.lastPlayed;
        
        // Priority-based lastPlayed determination:
        // Priority 1: GetRecentlyPlayedGames.rtime_last_played (most reliable for recent games)
        // Priority 2: GetOwnedGames.rtime_last_played (fallback if GetRecentlyPlayedGames doesn't have it)
        // Priority 3: Playtime delta approach (when neither endpoint has timestamp)
        let lastPlayed: Date | undefined;
        
        if (recentGame) {
          // Game is in recently played list - high confidence it was played recently
          if (recentGame.rtime_last_played) {
            // Priority 1: GetRecentlyPlayedGames has timestamp - use it (most reliable)
            lastPlayed = new Date(recentGame.rtime_last_played * 1000);
            gamesWithRecentLastPlayed++;
          } else if (steamGame.rtime_last_played) {
            // Priority 2: GetOwnedGames has timestamp - use it
            lastPlayed = new Date(steamGame.rtime_last_played * 1000);
            gamesWithLibraryLastPlayed++;
          } else {
            // Priority 3: Neither endpoint has timestamp - use playtime delta approach
            const previousPlaytime = existingGame?.previousPlaytimeMinutes ?? 0;
            const currentPlaytime = steamGame.playtime_forever ?? 0;
            const playtimeDelta = currentPlaytime - previousPlaytime;
            
            if (playtimeDelta > 0) {
              // Game has playtime increase - it was definitely played recently
              // Use delta to determine relative timestamp (larger delta = more recent)
              const maxDeltaMinutes = 14 * 24 * 60; // 14 days in minutes
              const deltaRatio = Math.min(playtimeDelta / maxDeltaMinutes, 1); // Clamp to 0-1
              const minutesOffset = (1 - deltaRatio) * maxDeltaMinutes; // Invert: larger delta = smaller offset
              lastPlayed = new Date(syncTime.getTime() - minutesOffset * 60 * 1000);
            } else {
              // No playtime increase - game is in list but playtime hasn't changed since last sync
              // Check if we have an existing lastPlayed that's recent (within 14 days)
              const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
              if (existingLastPlayed && existingLastPlayed > fourteenDaysAgo) {
                // Preserve existing date - it's accurate and recent
                lastPlayed = existingLastPlayed;
              } else if (existingLastPlayed) {
                // Preserve existing date even if older than 14 days - don't create false timestamps
                lastPlayed = existingLastPlayed;
              } else {
                // No existing date - don't set to syncTime as this creates false "recently played" timestamps
                // Leave undefined to avoid false feed sessions
                lastPlayed = undefined;
              }
            }
            gamesWithWatermarkFallback++;
          }
        } else {
          // Game is NOT in recently played list - use GetOwnedGames data
          if (steamGame.rtime_last_played) {
            lastPlayed = new Date(steamGame.rtime_last_played * 1000);
            gamesWithLibraryLastPlayed++;
          } else {
            lastPlayed = undefined;
            gamesWithNoLastPlayed++;
          }
        }
        
        const playtime2Weeks = recentGame?.playtime_2weeks ?? steamGame.playtime_2weeks ?? 0;
        
        // Check if we have a cached non-default image from existing games
        const coverImageUrl = (existingGame?.coverImageUrl && !defaultHeaderPattern.test(existingGame.coverImageUrl))
          ? existingGame.coverImageUrl
          : `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`;

        return {
          appId: steamGame.appid,
          name: steamGame.name,
          playtimeMinutes: steamGame.playtime_forever || 0,
          playtime2WeeksMinutes: playtime2Weeks,
          iconUrl: steamGame.img_icon_url 
            ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_icon_url}.jpg`
            : undefined,
          logoUrl: steamGame.img_logo_url
            ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_logo_url}.jpg`
            : undefined,
          coverImageUrl,
          lastPlayed,
        };
      });
      
      // Enhanced Steam API reliability tracking
      const totalWithRtime = gamesWithRecentLastPlayed + gamesWithLibraryLastPlayed;
      const totalMissingRtime = gamesWithWatermarkFallback + gamesWithNoLastPlayed;
      const rtimeProvidedPercent = games.length > 0 ? ((totalWithRtime / games.length) * 100).toFixed(1) : '0.0';
      const missingPercent = games.length > 0 ? ((totalMissingRtime / games.length) * 100).toFixed(1) : '0.0';
      
      console.log('[Games API] 📊 Steam API Reliability Stats:');
      console.log(`[Games API] 📊   Total games processed: ${games.length}`);
      console.log(`[Games API] 📊   rtime_last_played provided: ${totalWithRtime} (${rtimeProvidedPercent}%)`);
      console.log(`[Games API] 📊     - From GetRecentlyPlayedGames: ${gamesWithRecentLastPlayed}`);
      console.log(`[Games API] 📊     - From GetOwnedGames: ${gamesWithLibraryLastPlayed}`);
      console.log(`[Games API] 📊   rtime_last_played missing: ${totalMissingRtime} (${missingPercent}%)`);
      console.log(`[Games API] 📊     - Using watermark fallback: ${gamesWithWatermarkFallback}`);
      console.log(`[Games API] 📊     - No lastPlayed: ${gamesWithNoLastPlayed}`);
      
      console.log('[Games API] Processed games with lastPlayed:', {
        total: games.length,
        fromRecentlyPlayed: gamesWithRecentLastPlayed,
        watermarkFallback: gamesWithWatermarkFallback,
        fromLibrary: gamesWithLibraryLastPlayed,
        noLastPlayed: gamesWithNoLastPlayed,
        syncTime: syncTime.toISOString(),
        sampleGames: games.slice(0, 5).map(g => ({
          appId: g.appId,
          name: g.name,
          lastPlayed: g.lastPlayed,
        })),
      });
      
      if (gamesWithWatermarkFallback > 0) {
        const watermarkGames = games.filter(g => {
          const recentGame = recentlyPlayedMap.get(g.appId);
          return recentGame && !recentGame.rtime_last_played && g.lastPlayed;
        });
        console.log('[Games API] Games with watermark fallback:', watermarkGames.map(g => ({
          appId: g.appId,
          name: g.name,
          lastPlayed: g.lastPlayed?.toISOString(),
        })));
      }

      // Calculate derived_last_played for games without lastPlayed
      // Only check achievements for games that need it (no lastPlayed) and limit to first 50 to prevent performance issues
      const now = new Date();
      const gamesNeedingDerivedLastPlayed = games.filter(game => !game.lastPlayed).slice(0, 50);
      
      // Process games that need derivedLastPlayed calculation
      const derivedLastPlayedResults = await Promise.all(
        gamesNeedingDerivedLastPlayed.map(async (game) => {
          try {
            const achievements = await dataAccess.getUserAchievements(steamId, game.appId);
            const latestUnlock = getLatestAchievementUnlockTime(achievements);
            
            if (latestUnlock) {
              return {
                appId: game.appId,
                derivedLastPlayed: latestUnlock,
                derivedLastPlayedCalculatedAt: now,
              };
            }
          } catch (error) {
            // If achievements aren't cached yet, that's okay - we'll calculate it later
            // when achievements are synced
          }
          return null;
        })
      );
      
      // Create a map of derivedLastPlayed results for quick lookup
      const derivedLastPlayedMap = new Map<number, { derivedLastPlayed: Date; derivedLastPlayedCalculatedAt: Date }>();
      derivedLastPlayedResults.forEach((result, index) => {
        if (result) {
          derivedLastPlayedMap.set(gamesNeedingDerivedLastPlayed[index].appId, {
            derivedLastPlayed: result.derivedLastPlayed,
            derivedLastPlayedCalculatedAt: result.derivedLastPlayedCalculatedAt,
          });
        }
      });
      
      // Apply derivedLastPlayed to games
      const gamesWithDerivedLastPlayed = games.map((game) => {
        const derived = derivedLastPlayedMap.get(game.appId);
        if (derived) {
          return {
            ...game,
            ...derived,
          };
        }
        return game;
      });

      // Get existing games to preserve previous playtime values
      const existingGamesBeforeSave = await dataAccess.getUserGames(steamId);
      const existingGamesMapForPlaytime = new Map<number, Game>();
      existingGamesBeforeSave.forEach(game => {
        existingGamesMapForPlaytime.set(game.appId, game);
      });
      
      // Track Steam API reliability metrics for session creation
      const sessionCreationStats = {
        totalGamesWithDelta: 0,
        skippedMissingLastPlayed: 0,
        skippedStaleLastPlayed: 0,
        gamesWithMissingLastPlayed: [] as Array<{ appId: number; name: string; playtimeDelta: number }>,
        gamesWithStaleLastPlayed: [] as Array<{ appId: number; name: string; playtimeDelta: number }>,
      };

      // Prepare games for saving with playtime tracking
      const gamesToSave = gamesWithDerivedLastPlayed.map((game) => {
        const existingGame = existingGamesMapForPlaytime.get(game.appId);
        
        // Preserve previousPlaytimeMinutes logic:
        // - If no existing game: previousPlaytimeMinutes = undefined (first sync)
        // - If existing game but no previousPlaytimeMinutes: set to old playtimeMinutes (first playtime tracking)
        // - If existing game with previousPlaytimeMinutes: preserve it (don't reset on every sync)
        // - Only update previousPlaytimeMinutes when playtime actually increases
        let previousPlaytimeMinutes = existingGame?.previousPlaytimeMinutes;
        
        if (existingGame) {
          // If we have an existing game but no previousPlaytimeMinutes, initialize it
          if (previousPlaytimeMinutes === undefined) {
            previousPlaytimeMinutes = existingGame.playtimeMinutes;
          }
          // If playtime increased, update previousPlaytimeMinutes to the old value
          // This way, next sync will detect the increase
          if (game.playtimeMinutes > existingGame.playtimeMinutes) {
            previousPlaytimeMinutes = existingGame.playtimeMinutes;
          }
          // If playtime stayed the same or decreased, keep the existing previousPlaytimeMinutes
        }
        
        return {
          ...game,
          previousPlaytimeMinutes,
          playtimeLastSyncedAt: new Date(),
        };
      });

      // Save to cache (including derived_last_played and playtime tracking)
      console.log('[Games API] Saving', gamesToSave.length, 'games to database');
      const sampleGamesToSave = gamesToSave.slice(0, 3).map(g => ({
        appId: g.appId,
        name: g.name,
        lastPlayed: g.lastPlayed,
        playtimeMinutes: g.playtimeMinutes,
        previousPlaytimeMinutes: g.previousPlaytimeMinutes,
      }));
      console.log('[Games API] Sample games being saved:', sampleGamesToSave);
      
      await dataAccess.saveUserGames(steamId, gamesToSave);
      console.log('[Games API] Games saved successfully');
      
      // LEDGER APPROACH: Write playtime sessions to game_sessions table
      // This ensures sessions persist even after deltas are reset
      let sessionsCreated = 0;
      let sessionsMerged = 0;
      let gamesWithZeroDelta = 0;
      let gamesWithSmallDelta = 0;
      
      for (const game of gamesToSave) {
        const existingGame = existingGamesMapForPlaytime.get(game.appId);
        
        // REFINED FIX: On first sync, only skip if game is NOT in recently played list
        // If game IS in recently played list, it was played within 14 days, so create a session
        // This handles edge case: user signs up, plays game, refreshes feed before second sync
        if (!existingGame) {
          // Check if this game is in the recently played list (played within 14 days)
          const recentGame = recentlyPlayedMap.get(game.appId);
          const isRecentlyPlayed = !!recentGame;
          
          if (isRecentlyPlayed && game.lastPlayed) {
            // Game is recently played - create session even on first sync
            // Use total playtime as delta (acceptable because it's recent playtime, not lifetime)
            const playtimeDelta = game.playtimeMinutes; // All playtime is "new" on first sync
            
            // Only create session if delta >= 3 minutes
            if (playtimeDelta >= 3) {
              // Use lastPlayed as sessionEnd, calculate start by subtracting duration
              // This ensures proper session duration instead of zero-duration sessions
              const sessionEnd = game.lastPlayed;
              const maxSessionMinutes = 4 * 60;
              const sessionMinutes = Math.min(playtimeDelta, maxSessionMinutes);
              let calculatedSessionStart = new Date(game.lastPlayed.getTime() - sessionMinutes * 60 * 1000);
              
              // Safety Guard: Ensure sessionStart is ALWAYS before sessionEnd
              // This prevents database constraint violations from Steam's "jittery" data
              if (calculatedSessionStart >= sessionEnd) {
                // Fallback for edge cases or Steam weirdness
                // Ensure at least a 1-second difference so DB constraints don't trip
                calculatedSessionStart = new Date(sessionEnd.getTime() - 1000);
              }
              
              const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
              
              // Check for existing session first
              const existingSession = await dataAccess.getGameSessionByStartTime(steamId, game.appId, sessionStartRounded);
              
              if (!existingSession) {
                // Check for recent playtime session within 30 minutes (for continuous play sessions)
                const recentSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'playtime');
                
                if (!recentSession) {
                  // Before creating new session, check for existing achievement session within 30 minutes
                  const existingAchievementSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'achievement');
                  
                  if (!existingAchievementSession) {
                    // Create new session for recently played game on first sync
                    const newSession: GameSession = {
                      userId: steamId,
                      appId: game.appId,
                      playtimeDelta,
                      sessionStart: calculatedSessionStart,
                      sessionEnd: sessionEnd,
                      type: 'playtime',
                    };
                    await dataAccess.saveGameSession(newSession);
                    sessionsCreated++;
                    console.log(`[Games API] ✨ Created first-sync session for recently played game ${game.appId} (${game.name}): ${playtimeDelta}min`);
                    
                    // Update baseline after creating session
                    await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                    console.log(`[Games API] ✅ Updated baseline for game ${game.appId} (${game.name}): previousPlaytimeMinutes = ${game.playtimeMinutes}min (first sync, recently played)`);
                    continue; // Skip to next game
                  } else {
                    // Achievement session exists - skip playtime session
                    console.log(`[Games API] ⏭️ Skipping first-sync playtime session for ${game.appId} (${game.name}): achievement session exists`);
                    await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                    continue;
                  }
                } else {
                  // Recent session exists - merge logic would go here, but for first sync this is unlikely
                  console.log(`[Games API] ⚠️ Found recent session for first-sync game ${game.appId} (${game.name}) - unexpected, skipping`);
                  await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                  continue;
                }
              } else {
                // Session already exists
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                continue;
              }
            } else {
              // Delta too small
              await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              console.log(`[Games API] ⏭️ Skipping first-sync session for ${game.appId} (${game.name}): delta too small (${playtimeDelta}min < 3min)`);
              continue;
            }
          } else {
            // Game is NOT recently played - skip session creation (lifetime playtime)
            await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            console.log(`[Games API] ⏭️ Skipping session creation for ${game.appId} (${game.name}) on first sync (not recently played): setting baseline to ${game.playtimeMinutes}min`);
            continue; // Skip to next game
          }
        }
        
        // Calculate playtime delta
        // Use previousPlaytimeMinutes (from last sync) not playtimeMinutes (current DB value)
        // This ensures we detect deltas even if playtime was already synced in a previous refresh
        const previousPlaytime = existingGame?.previousPlaytimeMinutes ?? existingGame?.playtimeMinutes ?? 0;
        const currentPlaytime = game.playtimeMinutes;
        const playtimeDelta = currentPlaytime - previousPlaytime;
        
        // Enhanced logging: Show baseline values for verification
        if (playtimeDelta !== 0 || existingGame) {
          console.log(`[Games API] 📊 Baseline check for ${game.appId} (${game.name}): previous=${previousPlaytime}min, current=${currentPlaytime}min, delta=${playtimeDelta}min${playtimeDelta === 0 ? ' ✅ (FIX 1 working - no phantom session)' : ''}`);
        }
        
        // SIMPLIFIED: Only create sessions for games with meaningful playtime increases (>= 3 minutes)
        // Only create session if we have a valid lastPlayed timestamp from Steam
        if (playtimeDelta >= 3) {
          sessionCreationStats.totalGamesWithDelta++;
          // SIMPLIFIED: Require lastPlayed to exist and be different from existing
          // If Steam hasn't updated the timestamp yet, skip this sync and wait
          if (!game.lastPlayed) {
            sessionCreationStats.skippedMissingLastPlayed++;
            sessionCreationStats.gamesWithMissingLastPlayed.push({
              appId: game.appId,
              name: game.name,
              playtimeDelta,
            });
            console.log(`[Games API] ⏭️ Skipping ${game.appId} (${game.name}): playtime increased (${playtimeDelta}min) but lastPlayed missing - waiting for Steam to update`);
            // Still update baseline to track the playtime increase
            await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            continue; // Skip to next game
          }
          
          // Check if lastPlayed actually changed (Steam updated the timestamp)
          const existingGame = existingGamesMapForPlaytime.get(game.appId);
          const isTimestampStale = existingGame?.lastPlayed && 
            game.lastPlayed.getTime() === existingGame.lastPlayed.getTime();
          
          if (isTimestampStale) {
            sessionCreationStats.skippedStaleLastPlayed++;
            sessionCreationStats.gamesWithStaleLastPlayed.push({
              appId: game.appId,
              name: game.name,
              playtimeDelta,
            });
            console.log(`[Games API] ⏭️ Skipping ${game.appId} (${game.name}): playtime increased (${playtimeDelta}min) but lastPlayed unchanged - Steam is lagging, waiting for next sync`);
            // Still update baseline to track the playtime increase
            await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            continue; // Skip to next game
          }
          
          // We have new playtime AND new timestamp - create session
          // Use lastPlayed as sessionEnd (Steam's source of truth)
          const sessionEnd = game.lastPlayed;
          const maxSessionMinutes = 4 * 60;
          const sessionMinutes = Math.min(playtimeDelta, maxSessionMinutes);
          let calculatedSessionStart = new Date(sessionEnd.getTime() - sessionMinutes * 60 * 1000);
          
          // Safety Guard: Ensure sessionStart is ALWAYS before sessionEnd
          // This prevents database constraint violations from Steam's "jittery" data
          if (calculatedSessionStart >= sessionEnd) {
            // Fallback for edge cases or Steam weirdness
            // Ensure at least a 1-second difference so DB constraints don't trip
            calculatedSessionStart = new Date(sessionEnd.getTime() - 1000);
          }
          
          const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
          
          // Debug: Log session creation details
          console.log(`[Games API] 🔍 Session check for ${game.appId} (${game.name}): delta=${playtimeDelta}min, lastPlayed=${sessionEnd.toISOString()}, sessionStartRounded=${sessionStartRounded.toISOString()}`);
          
          // Check for existing session with same (userId, appId, sessionStart rounded to nearest second)
          // This prevents duplicate sessions even if they're older than 30 minutes
          const existingSession = await dataAccess.getGameSessionByStartTime(steamId, game.appId, sessionStartRounded);
          
          if (existingSession) {
            console.log(`[Games API] 🔗 Found existing session with same start time: id=${existingSession.id}, existingEnd=${existingSession.sessionEnd.toISOString()}, newEnd=${sessionEnd.toISOString()}, existingEndIsNewer=${existingSession.sessionEnd > sessionEnd}`);
          } else {
            console.log(`[Games API] ✅ No existing session found with same start time - will check for recent session`);
          }
          
          if (existingSession) {
            // Merge with existing session: add delta and update session_end
            // BUT: Only update sessionEnd if the new time is actually AFTER the existing sessionEnd
            // This prevents sessions from appearing "newer" than they actually are
            const shouldUpdateEnd = sessionEnd > existingSession.sessionEnd;
            const mergedSession: GameSession = {
              id: existingSession.id,
              userId: steamId,
              appId: game.appId,
              playtimeDelta: existingSession.playtimeDelta + playtimeDelta,
              sessionStart: existingSession.sessionStart, // Keep original start time
              sessionEnd: shouldUpdateEnd ? sessionEnd : existingSession.sessionEnd, // Only update if actually newer
              type: 'playtime',
            };
            await dataAccess.saveGameSession(mergedSession);
            sessionsMerged++;
            console.log(`[Games API] 🔗 Merged session for game ${game.appId} (${game.name}): added ${playtimeDelta}min (total: ${mergedSession.playtimeDelta}min), ${shouldUpdateEnd ? 'updated end time' : 'kept original end time'}`);
            
            // FIX 1: Update baseline AFTER successful session save
            // This "empties" the delta tank so the next sync won't process the same delta again
            await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            console.log(`[Games API] ✅ FIX 1: Updated baseline for game ${game.appId} (${game.name}): previousPlaytimeMinutes = ${game.playtimeMinutes}min (was ${previousPlaytime}min)`);
          } else {
            // Check for recent playtime session within 30 minutes (for continuous play sessions)
            // This handles cases where game.lastPlayed changes between syncs, causing different sessionStart values
            const recentSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'playtime');
            
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
                  userId: steamId,
                  appId: game.appId,
                  playtimeDelta: recentSession.playtimeDelta + playtimeDelta,
                  sessionStart: recentSession.sessionStart, // Keep original start time
                  sessionEnd: shouldUpdateEnd ? sessionEnd : recentSession.sessionEnd, // Only update if actually newer
                  type: 'playtime',
                };
                await dataAccess.saveGameSession(mergedSession);
                sessionsMerged++;
                console.log(`[Games API] 🔗 Merged with recent session for game ${game.appId} (${game.name}): added ${playtimeDelta}min (total: ${mergedSession.playtimeDelta}min), timeDiff: ${(timeDiff / 1000 / 60).toFixed(1)}min, ${shouldUpdateEnd ? 'updated end time' : 'kept original end time'}`);
                
                // FIX 1: Update baseline AFTER successful session save
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                console.log(`[Games API] ✅ FIX 1: Updated baseline for game ${game.appId} (${game.name}): previousPlaytimeMinutes = ${game.playtimeMinutes}min (was ${previousPlaytime}min)`);
                continue; // Skip to next game
              }
            }
            
            // Before creating new session, check for existing achievement session within 30 minutes
            // Achievement sessions take precedence - if one exists for this play session, skip playtime session
            const existingAchievementSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'achievement');
            
            if (existingAchievementSession) {
              // Check if the achievement session is close in time to this playtime session
              // Use proximity check: distance between start of one and end of the other (both ways)
              const THIRTY_MINUTES_MS = 30 * 60 * 1000;
              const timeDiff = Math.min(
                Math.abs(existingAchievementSession.sessionStart.getTime() - sessionEnd.getTime()),
                Math.abs(calculatedSessionStart.getTime() - existingAchievementSession.sessionEnd.getTime())
              );
              
              if (timeDiff <= THIRTY_MINUTES_MS) {
                // Achievement session exists for this play session - skip playtime session
                console.log(`[Games API] ⏭️ Skipping playtime session for game ${game.appId} (${game.name}): achievement session exists (achievement end: ${existingAchievementSession.sessionEnd.toISOString()}, playtime would be: ${sessionEnd.toISOString()}, timeDiff: ${(timeDiff / 1000 / 60).toFixed(1)}min)`);
                
                // Still update baseline to prevent phantom sessions
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                console.log(`[Games API] ✅ Updated baseline for game ${game.appId} (${game.name}): previousPlaytimeMinutes = ${game.playtimeMinutes}min (was ${previousPlaytime}min)`);
                continue; // Skip to next game
              }
            }
            
            // Create new session
            const newSession: GameSession = {
              userId: steamId,
              appId: game.appId,
              playtimeDelta,
              sessionStart: calculatedSessionStart,
              sessionEnd: sessionEnd, // Use calculated session end time
              type: 'playtime',
            };
            await dataAccess.saveGameSession(newSession);
            sessionsCreated++;
            const durationMinutes = (newSession.sessionEnd.getTime() - newSession.sessionStart.getTime()) / 60000;
            console.log(`[Games API] ✨ Created new session for game ${game.appId} (${game.name}): ${playtimeDelta}min, start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min`);
            
            // FIX 1: Update baseline AFTER successful session save
            // This "empties" the delta tank so the next sync won't process the same delta again
            await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            console.log(`[Games API] ✅ FIX 1: Updated baseline for game ${game.appId} (${game.name}): previousPlaytimeMinutes = ${game.playtimeMinutes}min (was ${previousPlaytime}min)`);
          }
        } else if (playtimeDelta > 0) {
          // FIX 1: Even if delta < 3, update baseline if playtime changed
          // This ensures the baseline stays in sync even for small changes
          gamesWithSmallDelta++;
          await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
          console.log(`[Games API] ✅ FIX 1: Updated baseline for game ${game.appId} (${game.name}): delta=${playtimeDelta}min (too small for session), previousPlaytimeMinutes = ${game.playtimeMinutes}min (was ${previousPlaytime}min)`);
        } else if (playtimeDelta === 0) {
          // FALLBACK: Only use when delta=0 AND recent activity detected AND no recent session exists
          // This fixes cases where games were synced after playtime was already at current value
          const playtime2Weeks = game.playtime2WeeksMinutes ?? 0;
          const now = new Date();
          const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
          const hasRecentActivity = playtime2Weeks > 0 || (game.lastPlayed && game.lastPlayed >= fourteenDaysAgo);
          
          if (hasRecentActivity && playtime2Weeks >= 3) {
            // FIX 1: Check for recent session FIRST (within 30 minutes) - prevents duplicates
            // Same check as normal playtimeDelta path
            const recentSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'playtime');
            
            if (recentSession) {
              // Recent session exists - don't create duplicate
              console.log(`[Games API] ⏭️ Skipping session creation for ${game.appId} (${game.name}): recent session exists (delta=0 case, playtime_2weeks=${playtime2Weeks}min)`);
              // Still update baseline to keep it in sync
              await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              gamesWithZeroDelta++;
              continue; // Skip to next game
            }
            
            // No recent session - check for existing session to calculate duration difference
            const existingSessions = await dataAccess.getGameSessions([steamId], 100, 0, 14);
            const existingSession = existingSessions.find(
              s => s.appId === game.appId && s.type === 'playtime'
            );
            
            // FIX 2: Calculate actual new playtime (difference, not total)
            const previousPlaytime = existingSession?.playtimeDelta ?? 0;
            const newPlaytime = playtime2Weeks - previousPlaytime;
            
            // Only create if there's actual new playtime (>= 3 minutes)
            if (newPlaytime >= 3) {
              // SIMPLIFIED: Require lastPlayed to exist for this fallback too
              if (!game.lastPlayed) {
                sessionCreationStats.skippedMissingLastPlayed++;
                sessionCreationStats.gamesWithMissingLastPlayed.push({
                  appId: game.appId,
                  name: game.name,
                  playtimeDelta: 0,
                });
                console.log(`[Games API] ⏭️ Skipping ${game.appId} (${game.name}): delta=0, playtime_2weeks=${playtime2Weeks}min but lastPlayed missing - waiting for Steam`);
                // Still update baseline
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                continue;
              }
              
              const maxSessionMinutes = 4 * 60;
              const sessionMinutes = Math.min(Math.max(newPlaytime, 3), maxSessionMinutes);
              
              // SIMPLIFIED: Always use lastPlayed (Steam's source of truth)
              // No syncTime fallbacks - if lastPlayed is stale, we accept the delay
              const sessionEnd = game.lastPlayed;
              
              // VALIDATION: Check if lastPlayed is suspiciously recent when delta=0
              // If lastPlayed is within the last 2 hours but playtimeDelta=0, it might be a Steam API glitch
              // Check if there's already a very recent session (within 2 hours) - if so, skip to prevent duplicates
              const now = new Date();
              const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
              if (game.lastPlayed > twoHoursAgo && playtimeDelta === 0) {
                const veryRecentSession = await dataAccess.getRecentGameSession(steamId, game.appId, 120, 'playtime'); // 120 minutes = 2 hours
                if (veryRecentSession) {
                  console.log(`[Games API] ⚠️ Suspicious lastPlayed for ${game.appId} (${game.name}): lastPlayed=${game.lastPlayed.toISOString()} is very recent but playtimeDelta=0 and recent session exists (id=${veryRecentSession.id}) - Steam API may be incorrect, skipping session`);
                  await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
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
              const existingSessionByStartTime = await dataAccess.getGameSessionByStartTime(steamId, game.appId, sessionStartRounded);
              
              if (!existingSessionByStartTime) {
                const newSession: GameSession = {
                  userId: steamId,
                  appId: game.appId,
                  playtimeDelta: newPlaytime, // FIX 3: Store only new playtime (difference), not total playtime_2weeks
                  sessionStart: calculatedSessionStart,
                  sessionEnd: sessionEnd,
                  type: 'playtime',
                };
                await dataAccess.saveGameSession(newSession);
                const durationMinutes = (newSession.sessionEnd.getTime() - newSession.sessionStart.getTime()) / 60000;
                if (existingSession) {
                  console.log(`[Games API] ✨ Created new session for game ${game.appId} (${game.name}): delta=0 but playtime_2weeks increased (${newPlaytime}min new playtime, total=${playtime2Weeks}min, previous=${previousPlaytime}min), start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min`);
                } else {
                  console.log(`[Games API] ✨ Created session for game ${game.appId} (${game.name}): delta=0 but recent activity (playtime_2weeks=${playtime2Weeks}min, last_played=${game.lastPlayed ? game.lastPlayed.toISOString() : 'NULL'}), start=${newSession.sessionStart.toISOString()}, end=${newSession.sessionEnd.toISOString()}, duration=${durationMinutes.toFixed(1)}min`);
                }
                sessionsCreated++;
                
                // Update baseline after successful session save
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              } else {
                console.log(`[Games API] ⏭️ Skipping session creation for ${game.appId}: session already exists with same start time (delta=0 case)`);
                // Still update baseline
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              }
            } else {
              console.log(`[Games API] ⏭️ Skipping session creation for ${game.appId}: no new playtime detected (playtime_2weeks=${playtime2Weeks}min, previous=${previousPlaytime}min, new=${newPlaytime}min < 3min)`);
              // Still update baseline
              await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            }
          }
          
          // Always update baseline even when delta = 0 (to keep it in sync)
          gamesWithZeroDelta++;
        }
      }
      
      // Summary log
      if (sessionsCreated > 0 || sessionsMerged > 0) {
        console.log(`[Games API] 📊 Session writing complete: ${sessionsCreated} created, ${sessionsMerged} merged`);
      }
      if (gamesWithZeroDelta > 0) {
        console.log(`[Games API] ✅ FIX 1 verification: ${gamesWithZeroDelta} game(s) with delta=0min (baseline working correctly - no phantom sessions)`);
      }
      if (gamesWithSmallDelta > 0) {
        console.log(`[Games API] ✅ FIX 1 verification: ${gamesWithSmallDelta} game(s) with small delta (<3min) - baseline updated to prevent future phantoms`);
      }
      
      // Log session creation reliability stats
      if (sessionCreationStats.totalGamesWithDelta > 0) {
        const skippedTotal = sessionCreationStats.skippedMissingLastPlayed + sessionCreationStats.skippedStaleLastPlayed;
        const skippedPercent = ((skippedTotal / sessionCreationStats.totalGamesWithDelta) * 100).toFixed(1);
        console.log(`[Games API] 📊 Session Creation Reliability Stats:`);
        console.log(`[Games API] 📊   Games with playtimeDelta >= 3min: ${sessionCreationStats.totalGamesWithDelta}`);
        console.log(`[Games API] 📊   Skipped (missing lastPlayed): ${sessionCreationStats.skippedMissingLastPlayed}`);
        console.log(`[Games API] 📊   Skipped (stale lastPlayed): ${sessionCreationStats.skippedStaleLastPlayed}`);
        console.log(`[Games API] 📊   Total skipped: ${skippedTotal} (${skippedPercent}%)`);
        
        if (sessionCreationStats.gamesWithMissingLastPlayed.length > 0) {
          console.log(`[Games API] 📊   Games missing lastPlayed: ${sessionCreationStats.gamesWithMissingLastPlayed.map(g => `${g.name} (${g.appId}, +${g.playtimeDelta}min)`).join(', ')}`);
        }
        
        if (sessionCreationStats.gamesWithStaleLastPlayed.length > 0) {
          console.log(`[Games API] 📊   Games with stale lastPlayed: ${sessionCreationStats.gamesWithStaleLastPlayed.map(g => `${g.name} (${g.appId}, +${g.playtimeDelta}min)`).join(', ')}`);
        }
      }
      
      // Update user's last sync time
      await dataAccess.updateUser(steamId, { lastSyncAt: new Date() });
      console.log('[Games API] User lastSyncAt updated');
      
      // Use the games with derived_last_played
      games = gamesWithDerivedLastPlayed;
    } else {
      // Even when loading from cache, normalize coverImageUrl and calculate derived_last_played
      // This fixes any stale cached data with wrong image URLs (e.g., library_hero.jpg)
      const now = new Date();
      
      // Normalize coverImageUrl for all games (no async needed)
      const normalizedGames = games.map((game) => {
        const normalizedCoverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${game.appId}/header.jpg`;
        const needsImageUpdate = game.coverImageUrl !== normalizedCoverImageUrl;
        
        return {
          game: {
            ...game,
            coverImageUrl: normalizedCoverImageUrl,
          },
          needsImageUpdate,
        };
      });
      
      // Only check achievements for games that need derivedLastPlayed (no lastPlayed AND no derivedLastPlayed)
      // Limit to first 50 to prevent performance issues
      const gamesNeedingDerivedLastPlayed = normalizedGames
        .filter(({ game }) => !game.lastPlayed && !game.derivedLastPlayed)
        .slice(0, 50);
      
      // Process games that need derivedLastPlayed calculation
      const derivedLastPlayedResults = await Promise.all(
        gamesNeedingDerivedLastPlayed.map(async ({ game }) => {
          try {
            const achievements = await dataAccess.getUserAchievements(steamId, game.appId);
            const latestUnlock = getLatestAchievementUnlockTime(achievements);
            
            if (latestUnlock) {
              return {
                appId: game.appId,
                derivedLastPlayed: latestUnlock,
                derivedLastPlayedCalculatedAt: now,
              };
            }
          } catch (error) {
            // If achievements aren't cached yet, that's okay
          }
          return null;
        })
      );
      
      // Create a map of derivedLastPlayed results for quick lookup
      const derivedLastPlayedMap = new Map<number, { derivedLastPlayed: Date; derivedLastPlayedCalculatedAt: Date }>();
      derivedLastPlayedResults.forEach((result, index) => {
        if (result) {
          derivedLastPlayedMap.set(gamesNeedingDerivedLastPlayed[index].game.appId, {
            derivedLastPlayed: result.derivedLastPlayed,
            derivedLastPlayedCalculatedAt: result.derivedLastPlayedCalculatedAt,
          });
        }
      });
      
      // Apply derivedLastPlayed and save updates
      const gamesWithDerivedLastPlayed = normalizedGames.map(({ game, needsImageUpdate }) => {
        const derived = derivedLastPlayedMap.get(game.appId);
        const gameWithUpdates = derived
          ? { ...game, ...derived }
          : game;
        
        // Save updates asynchronously (don't wait)
        if (derived || needsImageUpdate) {
          dataAccess.saveUserGames(steamId, [gameWithUpdates]).catch((error) => {
            console.warn(`Failed to save updates for game ${game.appId}:`, error);
          });
        }
        
        return gameWithUpdates;
      });
      
      games = gamesWithDerivedLastPlayed;
    }

    const isRefresh = request.nextUrl.searchParams.get('refresh') === 'true';

    return NextResponse.json(
      { games },
      {
        headers: {
          'Cache-Control': isRefresh 
            ? 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0' 
            : 'private, max-age=300', // Browser cache for 5 minutes
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching games:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch games',
      errorMessage
    );
  }
}
