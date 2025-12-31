import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';

export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;
    
    if (!steamId) {
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
