import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';
import type { Game } from '@/lib/data/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { steamId: string } }
) {
  try {
    const loggedInSteamId = request.cookies.get('steam_id')?.value;
    const targetSteamId = params.steamId;

    if (!loggedInSteamId) {
      return ApiErrors.notAuthenticated();
    }

    if (!targetSteamId) {
      return ApiErrors.missingParameter('steamId');
    }

    // No authorization check needed - Steam API enforces privacy
    // If profile is private, Steam API will return error/empty data
    // If profile is public, Steam API will return games
    // This matches Steam's behavior: public profiles = viewable games

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch games',
      errorMessage
    );
  }
}
