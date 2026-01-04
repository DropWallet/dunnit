import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
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

    // No authorization check needed - Steam API enforces privacy
    // If profile is private, Steam API will return error/empty data
    // If profile is public, Steam API will return data
    // This matches Steam's behavior: public profiles = viewable data

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
