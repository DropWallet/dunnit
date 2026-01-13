import { NextRequest, NextResponse } from 'next/server';
import { getDataAccess } from '@/lib/data/access';
import { getSteamClient } from '@/lib/steam/client';
import { ApiErrors } from '@/lib/utils/api-errors';
import { syncFriendPlaytime } from '@/lib/utils/friend-sync';

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

    // FIX 1: Sync-on-Read: Trigger lightweight playtime sync when viewing a profile
    // This ensures playtime data is updated so sessions can be created
    // Only sync if user's data is stale (older than 1 hour) to avoid excessive API calls
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isStale = !user.lastSyncAt || user.lastSyncAt < oneHourAgo;

    if (isStale) {
      console.log(`[User Profile] User ${targetSteamId} data is stale (lastSyncAt: ${user.lastSyncAt?.toISOString() || 'never'}), triggering background playtime sync`);
      
      // Trigger background playtime sync (fire-and-forget)
      // This will update user_games and create playtime sessions
      const syncPromise = syncFriendPlaytime(targetSteamId);
      
      // Try to use waitUntil if available (Next.js 13+)
      if (typeof (globalThis as any).waitUntil === 'function') {
        (globalThis as any).waitUntil(syncPromise);
      } else {
        // Fire-and-forget - don't await, let it run in background
        syncPromise.catch(error => {
          console.error(`[User Profile] Background playtime sync failed for ${targetSteamId}:`, error);
          // Don't throw - this is non-critical
        });
      }
    } else {
      console.log(`[User Profile] User ${targetSteamId} data is fresh (lastSyncAt: ${user.lastSyncAt?.toISOString()})`);
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
