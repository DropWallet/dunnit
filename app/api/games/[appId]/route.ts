import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { verifyIsFriend } from '@/lib/utils/authorization';

export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  try {
    const loggedInSteamId = request.cookies.get('steam_id')?.value;
    const searchParams = request.nextUrl.searchParams;
    const targetSteamId = searchParams.get('steamId'); // Optional: for viewing friend's game
    
    if (!loggedInSteamId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const appId = parseInt(params.appId);
    if (isNaN(appId)) {
      return NextResponse.json(
        { error: 'Invalid app ID' },
        { status: 400 }
      );
    }

    // Determine which steamId to use
    const steamId = targetSteamId || loggedInSteamId;

    // If viewing friend's game, verify authorization
    if (targetSteamId && targetSteamId !== loggedInSteamId) {
      const isAuthorized = await verifyIsFriend(loggedInSteamId, targetSteamId);
      if (!isAuthorized) {
        return NextResponse.json(
          { error: 'Unauthorized: You can only view your own games or your friends\' games' },
          { status: 403 }
        );
      }
    }

    const dataAccess = getDataAccess();
    
    // Get game from user's library
    const game = await dataAccess.getUserGame(steamId, appId);
    
    if (!game) {
      return NextResponse.json(
        { error: 'Game not found in user library' },
        { status: 404 }
      );
    }

    // Get achievements for this game
    const achievements = await dataAccess.getUserAchievements(steamId, appId);

    // Get game details from Steam Store API
    const steamClient = getSteamClient();
    let gameDetails = null;
    try {
      gameDetails = await steamClient.getGameDetails(appId);
    } catch (error) {
      console.warn(`Failed to fetch game details for ${appId}:`, error);
    }

    // Get library hero image URL
    const heroImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_hero.jpg`;

    return NextResponse.json({
      game,
      achievements,
      gameDetails: gameDetails?.data || null,
      heroImageUrl,
    });
  } catch (error) {
    console.error('Error fetching game data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game data' },
      { status: 500 }
    );
  }
}
