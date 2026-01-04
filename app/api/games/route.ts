import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
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
      // Fetch header images from Store API for better reliability
      games = await Promise.all(
        (response.response.games || []).map(async (steamGame) => {
          // Try to get header image from Store API
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
              // If still no image, try library_hero.jpg as fallback
              if (coverImageUrl === `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`) {
                coverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/library_hero.jpg`;
              }
            }
          } catch (error) {
            // Fallback to library_hero.jpg if Store API fails
            console.warn(`Failed to fetch store details for ${steamGame.appid}, trying library_hero.jpg`);
            coverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/library_hero.jpg`;
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

      // Save to cache
      await dataAccess.saveUserGames(steamId, games);
      
      // Update user's last sync time
      await dataAccess.updateUser(steamId, { lastSyncAt: new Date() });
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
