import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { verifyIsFriend } from '@/lib/utils/authorization';

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
        { error: 'Unauthorized: You can only view your own profile or your friends\' profiles' },
        { status: 403 }
      );
    }

    const dataAccess = getDataAccess();
    const user = await dataAccess.getUser(targetSteamId);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user' },
      { status: 500 }
    );
  }
}
