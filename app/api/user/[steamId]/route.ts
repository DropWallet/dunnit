import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { verifyIsFriend } from '@/lib/utils/authorization';
import { ApiErrors } from '@/lib/utils/api-errors';

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

    // Verify authorization: user must be viewing themselves or a friend
    const isAuthorized = await verifyIsFriend(loggedInSteamId, targetSteamId);
    if (!isAuthorized) {
      return ApiErrors.forbidden(
        'You can only view your own profile or your friends\' profiles',
        `Access denied for Steam ID: ${targetSteamId}`
      );
    }

    const dataAccess = getDataAccess();
    const user = await dataAccess.getUser(targetSteamId);

    if (!user) {
      return ApiErrors.userNotFound(targetSteamId);
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch user',
      errorMessage
    );
  }
}
