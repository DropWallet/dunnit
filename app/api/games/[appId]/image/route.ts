import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';

/**
 * On-demand endpoint to fetch game cover image from Steam Store API
 * Called when header.jpg fails to load on the client
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;
    
    if (!steamId) {
      return ApiErrors.notAuthenticated();
    }

    const appId = parseInt(params.appId);
    if (isNaN(appId)) {
      return ApiErrors.invalidParameter('appId', 'Invalid app ID');
    }

    const steamClient = getSteamClient();
    const dataAccess = getDataAccess();
    
    // Try to fetch from Store API
    let coverImageUrl: string | null = null;
    let capsuleImageUrl: string | null = null;
    
    try {
      const gameDetails = await steamClient.getGameDetails(appId);
      
      // Check if Store API call was successful and has data
      if (gameDetails?.success && gameDetails?.data) {
        // Separate capsule_image (for feed cards - portrait) from coverImageUrl (for game cards - landscape)
        // Game cards need header_image (landscape), feed cards need capsule_image (portrait)
        if (gameDetails.data.capsule_image) {
          capsuleImageUrl = gameDetails.data.capsule_image;
        }
        
        // coverImageUrl should always be header_image (landscape) for game cards
        if (gameDetails.data.header_image) {
          coverImageUrl = gameDetails.data.header_image;
        } else if (gameDetails.data.background) {
          coverImageUrl = gameDetails.data.background;
        } else if (gameDetails.data.capsule_image) {
          // Only use capsule_image as coverImageUrl if no header_image is available
          coverImageUrl = gameDetails.data.capsule_image;
        }
      }
    } catch (error) {
      // Only log unexpected errors (not HeadersOverflowError which is expected)
      if (error instanceof Error && !error.message.includes('HeadersOverflowError')) {
        console.error(`Error fetching Store API image for game ${appId}:`, error);
      }
      // Return null if Store API fails
      return NextResponse.json({ coverImageUrl: null, capsuleImageUrl: null });
    }

    // If we got an image from Store API, update the cache
    if (coverImageUrl) {
      try {
        const game = await dataAccess.getUserGame(steamId, appId);
        if (game) {
          // Update the game's coverImageUrl in cache
          await dataAccess.saveUserGames(steamId, [{
            ...game,
            coverImageUrl,
          }]);
        }
      } catch (error) {
        // Log but don't fail - cache update is best effort
        console.warn(`Failed to update cache for game ${appId}:`, error);
      }
    }

    return NextResponse.json({ 
      coverImageUrl,
      capsuleImageUrl: capsuleImageUrl || coverImageUrl // Return capsule if available, otherwise cover
    });
  } catch (error) {
    console.error('Error fetching game image:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch game image',
      errorMessage
    );
  }
}
