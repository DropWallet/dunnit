import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { getSteamClient } from '@/lib/steam/client';
import { ApiErrors } from '@/lib/utils/api-errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable ISR caching

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;

    if (!steamId) {
      return ApiErrors.notAuthenticated();
    }

    const dataAccess = getDataAccess();
    let user = await dataAccess.getUser(steamId);

    if (!user) {
      return ApiErrors.userNotFound(steamId);
    }

    // Refresh privacy state from Steam if stale (> 5 minutes) so modal triggers when profile goes private
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const shouldRefresh = !user.updatedAt || user.updatedAt < fiveMinutesAgo;

    if (shouldRefresh) {
      try {
        const steamClient = getSteamClient();
        const playerSummary = await steamClient.getPlayerSummary(steamId);

        if (playerSummary) {
          const isPrivate = playerSummary.communityvisibilitystate === 1 ||
            playerSummary.communityvisibilitystate === 2;

          await dataAccess.updateUser(steamId, {
            communityVisibilityState: playerSummary.communityvisibilitystate,
            isPrivate,
            avatarUrl: playerSummary.avatarfull ?? user.avatarUrl,
            username: playerSummary.personaname ?? user.username,
          });

          user = await dataAccess.getUser(steamId);
        }
      } catch (error) {
        console.warn('[User] Failed to refresh from Steam:', error);
        // Continue with cached user data
      }
    }

    return NextResponse.json(
      { user },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch user',
      errorMessage
    );
  }
}
