import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import type { Game, GameSession } from '@/lib/data/types';

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

      const steamGames = fullLibraryResponse.response.games || [];
      if (steamGames.length === 0 && games.length > 0) {
        console.log(`[Games] Steam returned empty, using ${games.length} cached games`);
        return NextResponse.json({ games }, { headers: { 'Cache-Control': 'no-store' } });
      }

      // Create a map of recently played games for quick lookup
      const recentlyPlayedMap = new Map<number, { rtime_last_played?: number; playtime_2weeks?: number }>();
      if (recentlyPlayedResponse.response?.games && recentlyPlayedResponse.response.games.length > 0) {
        recentlyPlayedResponse.response.games.forEach((game) => {
          recentlyPlayedMap.set(game.appid, {
            rtime_last_played: game.rtime_last_played,
            playtime_2weeks: game.playtime_2weeks,
          });
        });
      }

      // Transform Steam API response to our Game format
      // Use cached coverImageUrl when available, otherwise use default header.jpg
      // Store API images are fetched on-demand when header.jpg fails to load (see /api/games/[appId]/image)
      const defaultHeaderPattern = /\/steam\/apps\/\d+\/header\.jpg$/;
      
      // Use existing cached games to get coverImageUrl (avoid N+1 queries)
      // We already have games from getUserGames() at line 19, use that data
      const existingGamesMap = new Map<number, Game>();
      games.forEach(game => {
        existingGamesMap.set(game.appId, game);
      });
      
      // Process all games - use cached images or default header.jpg
      // Simplified: Use rtime_last_played if available, otherwise preserve existing
      const syncTime = new Date();
      
      games = steamGames.map((steamGame) => {
        // Check if this game is in the recently played list
        const recentGame = recentlyPlayedMap.get(steamGame.appid);
        const existingGame = existingGamesMap.get(steamGame.appid);
        
        // Simplified lastPlayed determination:
        // Priority 1: GetRecentlyPlayedGames.rtime_last_played
        // Priority 2: GetOwnedGames.rtime_last_played
        // Priority 3: Preserve existing lastPlayed (if available)
        // Otherwise: undefined (will be calculated from achievements if needed)
        let lastPlayed: Date | undefined;
        
        if (recentGame?.rtime_last_played) {
          lastPlayed = new Date(recentGame.rtime_last_played * 1000);
        } else if (steamGame.rtime_last_played) {
          lastPlayed = new Date(steamGame.rtime_last_played * 1000);
        } else if (existingGame?.lastPlayed) {
          // Preserve existing lastPlayed if Steam didn't provide one
          lastPlayed = existingGame.lastPlayed;
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
      await dataAccess.saveUserGames(steamId, gamesToSave);
      
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
          
          if (isRecentlyPlayed) {
            // Game is recently played - create session even on first sync
            // Use playtime_2weeks for delta (recent playtime), fallback to total if missing
            const playtime2Weeks = game.playtime2WeeksMinutes ?? 0;
            const maxSessionMinutes = 4 * 60;
            const playtimeDelta = playtime2Weeks > 0 
              ? Math.min(playtime2Weeks, maxSessionMinutes)
              : Math.min(game.playtimeMinutes, maxSessionMinutes);
            
            // Only create session if delta >= 3 minutes
            if (playtimeDelta >= 3) {
              // Use playtime-first heuristic (first-time sync uses 1-hour nudge)
              const recentGame = recentlyPlayedMap.get(game.appId);
              const { sessionEnd, path } = calculateSessionEnd(
                recentGame?.rtime_last_played || undefined,
                syncTime,
                playtimeDelta,
                undefined, // No existing game on first sync
                true // isFirstSync
              );
              
              const sessionMinutes = playtimeDelta;
              let calculatedSessionStart = new Date(sessionEnd.getTime() - sessionMinutes * 60 * 1000);
              
              // Safety Guard
              if (calculatedSessionStart >= sessionEnd) {
                calculatedSessionStart = new Date(sessionEnd.getTime() - 1000);
              }
              
              const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
              const existingSession = await dataAccess.getGameSessionByStartTime(steamId, game.appId, sessionStartRounded);
              
              if (!existingSession) {
                // Check for proximity merge (45-minute window with 1-hour gap safeguard)
                const PROXIMITY_WINDOW_MINUTES = 45;
                const GAP_SAFEGUARD_MINUTES = 60;
                const recentSession = await dataAccess.getRecentGameSession(steamId, game.appId, PROXIMITY_WINDOW_MINUTES, 'playtime');
                
                if (recentSession) {
                  const gapBetweenStarts = Math.abs(calculatedSessionStart.getTime() - recentSession.sessionStart.getTime());
                  const gapMinutes = gapBetweenStarts / (60 * 1000);
                  
                  if (gapMinutes <= GAP_SAFEGUARD_MINUTES) {
                    // Merge
                    const mergedSession: GameSession = {
                      id: recentSession.id,
                      userId: steamId,
                      appId: game.appId,
                      playtimeDelta: recentSession.playtimeDelta + playtimeDelta,
                      sessionStart: recentSession.sessionStart,
                      sessionEnd: sessionEnd > recentSession.sessionEnd ? sessionEnd : recentSession.sessionEnd,
                      type: 'playtime',
                    };
                    await dataAccess.saveGameSession(mergedSession);
                  } else {
                    // Gap too large - create new
                    const newSession: GameSession = {
                      userId: steamId,
                      appId: game.appId,
                      playtimeDelta,
                      sessionStart: calculatedSessionStart,
                      sessionEnd,
                      type: 'playtime',
                    };
                    await dataAccess.saveGameSession(newSession);
                  }
                } else {
                  // Check for achievement session before creating
                  const existingAchievementSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'achievement');
                  
                  if (!existingAchievementSession) {
                    const newSession: GameSession = {
                      userId: steamId,
                      appId: game.appId,
                      playtimeDelta,
                      sessionStart: calculatedSessionStart,
                      sessionEnd,
                      type: 'playtime',
                    };
                    await dataAccess.saveGameSession(newSession);
                    sessionsCreated++;
                  }
                }
              }
              
              await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              continue;
            } else {
              await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              continue;
            }
          } else {
            // Game is NOT recently played - skip session creation (lifetime playtime)
            await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            continue;
          }
        }
        
        // Calculate playtime delta
        // Use previousPlaytimeMinutes (from last sync) not playtimeMinutes (current DB value)
        // This ensures we detect deltas even if playtime was already synced in a previous refresh
        const previousPlaytime = existingGame?.previousPlaytimeMinutes ?? existingGame?.playtimeMinutes ?? 0;
        const currentPlaytime = game.playtimeMinutes;
        const playtimeDelta = currentPlaytime - previousPlaytime;
        
        // Enhanced logging: Show baseline values for verification
        
        // Playtime-first heuristic: Create session if delta >= 3 minutes
        // No longer blocking on rtime_last_played - use heuristic when missing
        if (playtimeDelta >= 3) {
          // Get rtime_last_played from Steam API response
          const recentGame = recentlyPlayedMap.get(game.appId);
          const rtimeLastPlayed = recentGame?.rtime_last_played || undefined;
          
          // Use playtime-first heuristic engine
          const { sessionEnd, path } = calculateSessionEnd(
            rtimeLastPlayed,
            syncTime,
            playtimeDelta,
            existingGame,
            false // not first sync
          );
          
          const maxSessionMinutes = 4 * 60;
          const sessionMinutes = Math.min(playtimeDelta, maxSessionMinutes);
          let calculatedSessionStart = new Date(sessionEnd.getTime() - sessionMinutes * 60 * 1000);
          
          // Safety Guard
          if (calculatedSessionStart >= sessionEnd) {
            calculatedSessionStart = new Date(sessionEnd.getTime() - 1000);
          }
          
          const sessionStartRounded = new Date(Math.floor(calculatedSessionStart.getTime() / 1000) * 1000);
          
          // Check for existing session with same (userId, appId, sessionStart rounded to nearest second)
          const existingSession = await dataAccess.getGameSessionByStartTime(steamId, game.appId, sessionStartRounded);
          
          if (existingSession) {
            // Merge with existing session
            const shouldUpdateEnd = sessionEnd > existingSession.sessionEnd;
            const mergedSession: GameSession = {
              id: existingSession.id,
              userId: steamId,
              appId: game.appId,
              playtimeDelta: existingSession.playtimeDelta + playtimeDelta,
              sessionStart: existingSession.sessionStart,
              sessionEnd: shouldUpdateEnd ? sessionEnd : existingSession.sessionEnd,
              type: 'playtime',
            };
            await dataAccess.saveGameSession(mergedSession);
            sessionsMerged++;
            
            await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
          } else {
            // Check for proximity merge (45-minute window with 1-hour gap safeguard)
            const PROXIMITY_WINDOW_MINUTES = 45;
            const GAP_SAFEGUARD_MINUTES = 60;
            const recentSession = await dataAccess.getRecentGameSession(steamId, game.appId, PROXIMITY_WINDOW_MINUTES, 'playtime');
            
            if (recentSession) {
              // Check 1-hour gap safeguard: if gap between session starts > 1 hour, don't merge
              const gapBetweenStarts = Math.abs(calculatedSessionStart.getTime() - recentSession.sessionStart.getTime());
              const gapMinutes = gapBetweenStarts / (60 * 1000);
              
              // Also check proximity: distance between new start and existing end
              const proximityDiff = Math.abs(calculatedSessionStart.getTime() - recentSession.sessionEnd.getTime());
              const proximityMinutes = proximityDiff / (60 * 1000);
              
              if (gapMinutes <= GAP_SAFEGUARD_MINUTES && proximityMinutes <= PROXIMITY_WINDOW_MINUTES) {
                // Merge: stretch existing session
                const mergedSession: GameSession = {
                  id: recentSession.id,
                  userId: steamId,
                  appId: game.appId,
                  playtimeDelta: recentSession.playtimeDelta + playtimeDelta,
                  sessionStart: recentSession.sessionStart,
                  sessionEnd: sessionEnd > recentSession.sessionEnd ? sessionEnd : recentSession.sessionEnd,
                  type: 'playtime',
                };
                await dataAccess.saveGameSession(mergedSession);
                sessionsMerged++;
                
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              } else {
                // Gap too large or proximity too far - check for achievement session before creating
                const existingAchievementSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'achievement');
                
                if (existingAchievementSession) {
                  const THIRTY_MINUTES_MS = 30 * 60 * 1000;
                  const timeDiff = Math.min(
                    Math.abs(existingAchievementSession.sessionStart.getTime() - sessionEnd.getTime()),
                    Math.abs(calculatedSessionStart.getTime() - existingAchievementSession.sessionEnd.getTime())
                  );
                  
                  if (timeDiff <= THIRTY_MINUTES_MS) {
                    await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                    continue;
                  }
                }
                
                // Create new session
                const newSession: GameSession = {
                  userId: steamId,
                  appId: game.appId,
                  playtimeDelta,
                  sessionStart: calculatedSessionStart,
                  sessionEnd,
                  type: 'playtime',
                };
                await dataAccess.saveGameSession(newSession);
                sessionsCreated++;
                
                await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
              }
            } else {
              // Check for achievement session before creating
              const existingAchievementSession = await dataAccess.getRecentGameSession(steamId, game.appId, 30, 'achievement');
              
              if (existingAchievementSession) {
                const THIRTY_MINUTES_MS = 30 * 60 * 1000;
                const timeDiff = Math.min(
                  Math.abs(existingAchievementSession.sessionStart.getTime() - sessionEnd.getTime()),
                  Math.abs(calculatedSessionStart.getTime() - existingAchievementSession.sessionEnd.getTime())
                );
                
                if (timeDiff <= THIRTY_MINUTES_MS) {
                  await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
                  continue;
                }
              }
              
              // Create new session
              const newSession: GameSession = {
                userId: steamId,
                appId: game.appId,
                playtimeDelta,
                sessionStart: calculatedSessionStart,
                sessionEnd,
                type: 'playtime',
              };
              await dataAccess.saveGameSession(newSession);
              sessionsCreated++;
              
              await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
            }
          }
        } else if (playtimeDelta > 0) {
          // FIX 1: Even if delta < 3, update baseline if playtime changed
          // This ensures the baseline stays in sync even for small changes
          gamesWithSmallDelta++;
          await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
        } else if (playtimeDelta === 0) {
          // Delta=0: No playtime change detected. Update baseline but don't create session.
          // Sessions will be created on next sync when Steam's API updates playtimeDelta.
          // This simplifies the codebase and ensures more accurate timestamps.
          await dataAccess.updateGameBaseline(steamId, game.appId, game.playtimeMinutes);
          gamesWithZeroDelta++;
        }
      }
      
      // Update user's last sync time
      await dataAccess.updateUser(steamId, { lastSyncAt: new Date() });
      
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
