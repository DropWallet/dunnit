import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
import { getLatestAchievementUnlockTime } from '@/lib/utils/achievements';
import type { Game } from '@/lib/data/types';

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
    const shouldRefresh = games.length === 0 || 
      !user?.lastSyncAt || 
      user.lastSyncAt < oneHourAgo ||
      request.nextUrl.searchParams.get('refresh') === 'true';
    
    if (shouldRefresh) {
      const steamClient = getSteamClient();
      const response = await steamClient.getOwnedGames(steamId, true);

      // Transform Steam API response to our Game format
      // Fetch header images from Store API for better reliability (some games don't have header.jpg on CDN)
      // Use cached coverImageUrl when available to avoid unnecessary Store API calls
      const gamesBatch = response.response.games || [];
      
      // First, check which games need Store API calls (don't have cached coverImageUrl or have default header.jpg)
      const defaultHeaderPattern = /\/steam\/apps\/\d+\/header\.jpg$/;
      const gamesNeedingStoreAPI: typeof gamesBatch = [];
      const cachedImageMap = new Map<number, string>(); // appId -> coverImageUrl
      
      // Check cache for all games first
      for (const steamGame of gamesBatch) {
        const cachedGame = await dataAccess.getUserGame(steamId, steamGame.appid);
        if (cachedGame?.coverImageUrl && !defaultHeaderPattern.test(cachedGame.coverImageUrl)) {
          // We have a cached non-default image, use it
          cachedImageMap.set(steamGame.appid, cachedGame.coverImageUrl);
        } else {
          // Need to fetch from Store API (or use default header.jpg)
          gamesNeedingStoreAPI.push(steamGame);
        }
      }
      
      // Process games with cached images first (no API calls needed)
      games = gamesBatch
        .filter((steamGame) => cachedImageMap.has(steamGame.appid))
        .map((steamGame) => ({
          appId: steamGame.appid,
          name: steamGame.name,
          playtimeMinutes: steamGame.playtime_forever || 0,
          playtime2WeeksMinutes: steamGame.playtime_2weeks || 0,
          iconUrl: steamGame.img_icon_url 
            ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_icon_url}.jpg`
            : undefined,
          logoUrl: steamGame.img_logo_url
            ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_logo_url}.jpg`
            : undefined,
          coverImageUrl: cachedImageMap.get(steamGame.appid)!,
          lastPlayed: steamGame.rtime_last_played 
            ? new Date(steamGame.rtime_last_played * 1000)
            : undefined,
        }));
      
      // Process games needing Store API calls in smaller batches with longer delays
      const batchSize = 5; // Reduced from 10 to 5 for better rate limiting
      const batchDelay = 300; // Increased from 100ms to 300ms for better rate limiting
      
      for (let i = 0; i < gamesNeedingStoreAPI.length; i += batchSize) {
        const batch = gamesNeedingStoreAPI.slice(i, i + batchSize);
        const batchGames = await Promise.all(
          batch.map(async (steamGame) => {
            // Default to header.jpg, but try Store API for better image coverage
            let coverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`;
            
            try {
              const gameDetails = await steamClient.getGameDetails(steamGame.appid);
              // Check if Store API call was successful and has data
              if (gameDetails?.success && gameDetails?.data?.header_image) {
                coverImageUrl = gameDetails.data.header_image;
              } else if (gameDetails?.success && gameDetails?.data) {
                // Try alternative image sources if header_image doesn't exist
                // Some games might have capsule images or other image fields
                if (gameDetails.data.capsule_image) {
                  coverImageUrl = gameDetails.data.capsule_image;
                } else if (gameDetails.data.background) {
                  coverImageUrl = gameDetails.data.background;
                }
              }
            } catch (error) {
              // Silently fail - use default header.jpg URL
              // Store API rate limiting or errors are expected, so we don't log every failure
            }

            return {
              appId: steamGame.appid,
              name: steamGame.name,
              playtimeMinutes: steamGame.playtime_forever || 0,
              playtime2WeeksMinutes: steamGame.playtime_2weeks || 0,
              iconUrl: steamGame.img_icon_url 
                ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_icon_url}.jpg`
                : undefined,
              logoUrl: steamGame.img_logo_url
                ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_logo_url}.jpg`
                : undefined,
              coverImageUrl,
              lastPlayed: steamGame.rtime_last_played 
                ? new Date(steamGame.rtime_last_played * 1000) // Convert Unix timestamp to Date
                : undefined,
            };
          })
        );
        
        games.push(...batchGames);
        
        // Add delay between batches to avoid rate limiting (except for the last batch)
        if (i + batchSize < gamesNeedingStoreAPI.length) {
          await new Promise(resolve => setTimeout(resolve, batchDelay));
        }
      }

      // Calculate derived_last_played for games without lastPlayed
      // This uses cached achievements to provide immediate sorting without fetching achievements
      const now = new Date();
      const gamesWithDerivedLastPlayed = await Promise.all(
        games.map(async (game) => {
          // If game already has lastPlayed, no need to calculate derived
          if (game.lastPlayed) {
            return game;
          }

          // Check if we have cached achievements for this game
          try {
            const achievements = await dataAccess.getUserAchievements(steamId, game.appId);
            const latestUnlock = getLatestAchievementUnlockTime(achievements);
            
            if (latestUnlock) {
              return {
                ...game,
                derivedLastPlayed: latestUnlock,
                derivedLastPlayedCalculatedAt: now,
              };
            }
          } catch (error) {
            // If achievements aren't cached yet, that's okay - we'll calculate it later
            // when achievements are synced
          }

          return game;
        })
      );

      // Save to cache (including derived_last_played)
      await dataAccess.saveUserGames(steamId, gamesWithDerivedLastPlayed);
      
      // Update user's last sync time
      await dataAccess.updateUser(steamId, { lastSyncAt: new Date() });
      
      // Use the games with derived_last_played
      games = gamesWithDerivedLastPlayed;
    } else {
      // Even when loading from cache, normalize coverImageUrl and calculate derived_last_played
      // This fixes any stale cached data with wrong image URLs (e.g., library_hero.jpg)
      const now = new Date();
      const gamesWithDerivedLastPlayed = await Promise.all(
        games.map(async (game) => {
          // Normalize coverImageUrl to always use header.jpg (fixes stale cache with wrong URLs)
          const normalizedCoverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${game.appId}/header.jpg`;
          const needsImageUpdate = game.coverImageUrl !== normalizedCoverImageUrl;
          
          // Always normalize in the response (even if we don't save yet)
          const normalizedGame = {
            ...game,
            coverImageUrl: normalizedCoverImageUrl,
          };
          
          // If game already has lastPlayed or derivedLastPlayed, just normalize image
          if (game.lastPlayed || game.derivedLastPlayed) {
            // Save the normalized image if it was wrong
            if (needsImageUpdate) {
              dataAccess.saveUserGames(steamId, [normalizedGame]).catch((error) => {
                console.warn(`Failed to save fixed coverImageUrl for game ${game.appId}:`, error);
              });
            }
            return normalizedGame;
          }

          // Check if we have cached achievements for this game
          try {
            const achievements = await dataAccess.getUserAchievements(steamId, game.appId);
            const latestUnlock = getLatestAchievementUnlockTime(achievements);
            
            if (latestUnlock) {
              const gameWithUpdates = {
                ...normalizedGame,
                derivedLastPlayed: latestUnlock,
                derivedLastPlayedCalculatedAt: now,
              };
              
              // Save the updated game to cache (async, don't wait)
              dataAccess.saveUserGames(steamId, [gameWithUpdates]).catch((error) => {
                console.warn(`Failed to save updates for game ${game.appId}:`, error);
              });
              
              return gameWithUpdates;
            }
          } catch (error) {
            // If achievements aren't cached yet, that's okay
          }

          // Save the normalized image if it was wrong
          if (needsImageUpdate) {
            dataAccess.saveUserGames(steamId, [normalizedGame]).catch((error) => {
              console.warn(`Failed to save fixed coverImageUrl for game ${game.appId}:`, error);
            });
          }

          return normalizedGame;
        })
      );
      
      games = gamesWithDerivedLastPlayed;
    }

    return NextResponse.json(
      { games },
      {
        headers: {
          'Cache-Control': 'private, max-age=300', // Browser cache for 5 minutes
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
