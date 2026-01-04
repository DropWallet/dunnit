import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { verifyIsFriend } from '@/lib/utils/authorization';
import type { Game } from '@/lib/data/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { steamId: string } }
) {
  try {
    const loggedInSteamId = request.cookies.get('steam_id')?.value;
    const targetSteamId = params.steamId;

    if (!loggedInSteamId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    if (!targetSteamId) {
      return NextResponse.json(
        { error: 'steamId parameter is required' },
        { status: 400 }
      );
    }

    // Verify authorization: user must be viewing themselves or a friend
    const isAuthorized = await verifyIsFriend(loggedInSteamId, targetSteamId);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: You can only view your own games or your friends\' games' },
        { status: 403 }
      );
    }

    // Check if we have cached games
    const dataAccess = getDataAccess();
    const user = await dataAccess.getUser(targetSteamId);
    let games = await dataAccess.getUserGames(targetSteamId);

    // Check if we should refresh: no games, no user, or cache is stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const shouldRefresh = games.length === 0 || 
      !user?.lastSyncAt || 
      user.lastSyncAt < oneHourAgo ||
      request.nextUrl.searchParams.get('refresh') === 'true';
    
    if (shouldRefresh) {
      const steamClient = getSteamClient();
      
      // Fetch both full library and recently played games
      // GetRecentlyPlayedGames is more reliable for "Date Played" sorting but may not be available for friends
      const [fullLibraryResponse, recentlyPlayedResponse] = await Promise.all([
        steamClient.getOwnedGames(targetSteamId, true),
        steamClient.getRecentlyPlayedGames(targetSteamId).catch((error) => {
          // Silently fail - this endpoint may not be available for friends due to privacy settings
          return { response: { games: [] } };
        }),
      ]);

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
      // Merge data from GetRecentlyPlayedGames to supplement lastPlayed information
      // Prioritize GetRecentlyPlayedGames data as it's more reliable for "Date Played" sorting
      // Use default header.jpg URLs to ensure correct images (avoids Store API rate limiting)
      games = (fullLibraryResponse.response.games || []).map((steamGame) => {
        // Check if this game is in the recently played list (more reliable data)
        const recentGame = recentlyPlayedMap.get(steamGame.appid);
        
        // Use recently played data if available, otherwise use full library data
        const lastPlayed = recentGame?.rtime_last_played 
          ? new Date(recentGame.rtime_last_played * 1000)
          : steamGame.rtime_last_played 
            ? new Date(steamGame.rtime_last_played * 1000)
            : undefined;
        
        const playtime2Weeks = recentGame?.playtime_2weeks ?? steamGame.playtime_2weeks ?? 0;
        
        // Always use default header.jpg URL to ensure correct images
        const coverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`;

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

      // Save to cache
      await dataAccess.saveUserGames(targetSteamId, games);
      
      // Update user's last sync time
      await dataAccess.updateUser(targetSteamId, { lastSyncAt: new Date() });
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
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
