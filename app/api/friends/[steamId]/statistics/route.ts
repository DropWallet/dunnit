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

    // Get friend's statistics (uses existing 24-hour cache)
    const friendStats = await dataAccess.getUserStatistics(friendSteamId);
    
    // Get friend's games count
    const friendGames = await dataAccess.getUserGames(friendSteamId);
    const gamesCount = friendGames?.length || 0;
    
    // Get friend's achievements count
    const achievementsCount = friendStats?.statistics?.totalAchievements || 0;

    // Get friend's friends count
    let friendsCount = 0;
    try {
      const steamClient = getSteamClient();
      const friendList = await steamClient.getFriendList(friendSteamId);
      friendsCount = friendList.length;
    } catch (error) {
      console.error(`Error fetching friends count for ${friendSteamId}:`, error);
      // If we can't get friends count, just use 0
    }

    return NextResponse.json(
      {
        statistics: {
          totalGames: gamesCount,
          totalAchievements: achievementsCount,
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
