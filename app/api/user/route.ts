import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { ApiErrors } from '@/lib/utils/api-errors';

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;
    console.log('API /user - steam_id cookie:', steamId);
    console.log('API /user - all cookies:', request.cookies.getAll());

    if (!steamId) {
      return ApiErrors.notAuthenticated();
    }

    const dataAccess = getDataAccess();
    const user = await dataAccess.getUser(steamId);
    console.log('API /user - user found:', user ? 'Yes' : 'No', steamId);

    if (!user) {
      return ApiErrors.userNotFound(steamId);
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
