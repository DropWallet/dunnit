import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';

export async function GET(request: NextRequest) {
  try {
    const steamId = request.cookies.get('steam_id')?.value;
    console.log('API /user - steam_id cookie:', steamId);
    console.log('API /user - all cookies:', request.cookies.getAll());

    if (!steamId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const dataAccess = getDataAccess();
    const user = await dataAccess.getUser(steamId);
    console.log('API /user - user found:', user ? 'Yes' : 'No', steamId);

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
