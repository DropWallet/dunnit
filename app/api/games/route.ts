import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import type { Game } from '@/lib/data/types';

export const dynamic = 'force-dynamic';

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
    const refreshParam = request.nextUrl.searchParams.get('refresh');
    const shouldRefresh = games.length === 0 || 
      !user?.lastSyncAt || 
      user.lastSyncAt < oneHourAgo ||
      refreshParam === 'true';
    
    console.log('[Games API] Refresh check:', {
      steamId,
      hasGames: games.length > 0,
      lastSyncAt: user?.lastSyncAt,
      isStale: user?.lastSyncAt ? user.lastSyncAt < oneHourAgo : true,
      refreshParam,
      shouldRefresh,
    });
    
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
            ? 'no-cache, no-store, must-revalidate, Pragma: no-cache' 
            : 'private, max-age=300', // Browser cache for 5 minutes
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
