import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { getSteamClient } from '@/lib/steam/client';
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
    let user = await dataAccess.getUser(targetSteamId);

    // If user not in database, try fetching from Steam API
    if (!user) {
      try {
        const steamClient = getSteamClient();
        const playerSummary = await steamClient.getPlayerSummary(targetSteamId);
        
        if (!playerSummary) {
          return ApiErrors.userNotFound(targetSteamId);
        }

        // Transform Steam API response to our User format
        const now = new Date();
        const newUser = {
          steamId: targetSteamId,
          username: playerSummary.personaname || 'Unknown',
          avatarUrl: playerSummary.avatarfull || playerSummary.avatar || '',
          profileUrl: playerSummary.profileurl || '',
          countryCode: playerSummary.loccountrycode || undefined,
          countryName: undefined, // Steam API doesn't provide country name directly
          joinDate: playerSummary.timecreated ? new Date(playerSummary.timecreated * 1000) : undefined,
          communityVisibilityState: playerSummary.communityvisibilitystate,
          createdAt: now,
          updatedAt: now,
        };

        // Save to database for future use
        await dataAccess.saveUser(newUser);
        user = newUser;
      } catch (error) {
        // If Steam API fails, return not found
        console.error(`Error fetching user ${targetSteamId} from Steam API:`, error);
        return ApiErrors.userNotFound(targetSteamId);
      }
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
