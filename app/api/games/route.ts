import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import type { Game } from '@/lib/data/types';

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;
    
    if (!steamId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check if we have cached games
    const dataAccess = getDataAccess();
    let games = await dataAccess.getUserGames(steamId);

    // If no cached games or cache is stale (older than 1 hour), fetch from Steam
    const shouldRefresh = games.length === 0;
    
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
            if (gameDetails?.data?.header_image) {
              coverImageUrl = gameDetails.data.header_image;
            }
          } catch (error) {
            // Fallback to default URL if Store API fails
            console.warn(`Failed to fetch store details for ${steamGame.appid}, using default header URL`);
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

    return NextResponse.json({ games });
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
