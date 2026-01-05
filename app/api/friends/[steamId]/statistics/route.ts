import { NextRequest, NextResponse } from "next/server";
import { getDataAccess } from "@/lib/data/access";
import { getSteamClient } from "@/lib/steam/client";
import { ApiErrors } from "@/lib/utils/api-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: { steamId: string } }
) {
  try {
    const friendSteamId = params.steamId;

    if (!friendSteamId) {
      return ApiErrors.missingParameter('steamId');
    }

    const dataAccess = getDataAccess();

    // Get friend's friends count (check cache first, same 1-hour TTL as achievements)
    let friendsCount = 0;
    const cachedFriendsCount = await dataAccess.getUserFriendsCount(friendSteamId);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isStale = !cachedFriendsCount?.syncedAt || cachedFriendsCount.syncedAt < oneHourAgo;

    if (cachedFriendsCount && !isStale) {
      // Use cached value
      friendsCount = cachedFriendsCount.count;
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Friend Count] Using cached count for ${friendSteamId}: ${friendsCount}`);
      }
    } else {
      // Fetch from Steam API
      try {
        const steamClient = getSteamClient();
        const friendList = await steamClient.getFriendList(friendSteamId);
        friendsCount = friendList.length;
        
        // Save to cache
        await dataAccess.saveUserFriendsCount(friendSteamId, friendsCount);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Friend Count] Fetched and cached count for ${friendSteamId}: ${friendsCount}`);
        }
      } catch (error) {
        // If Steam API fails, use cached value if available (even if stale)
        if (cachedFriendsCount) {
          friendsCount = cachedFriendsCount.count;
        } else if (error instanceof Error && !error.message.includes('401')) {
          // Only log unexpected errors (not 401 which is expected for private profiles)
          console.error(`Error fetching friends count for ${friendSteamId}:`, error);
        }
        // If no cache and API fails, friendsCount remains 0
      }
    }

    // Return only friends count - games/achievements not needed for friend cards
    return NextResponse.json(
      {
        statistics: {
          totalGames: 0,
          totalAchievements: 0,
          unlockedAchievements: 0,
          friendsCount,
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=300", // Browser cache for 5 minutes
        },
      }
    );
  } catch (error) {
    console.error("Error fetching friend statistics:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch friend statistics',
      errorMessage
    );
  }
}
