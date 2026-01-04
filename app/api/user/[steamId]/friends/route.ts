import { NextRequest, NextResponse } from "next/server";
import { getSteamClient } from "@/lib/steam/client";
import { getDataAccess } from "@/lib/data/access";
import { getCountryName } from "@/lib/utils/country";
import { ApiErrors } from "@/lib/utils/api-errors";

// Cache duration for friend list (12 hours)
const FRIEND_LIST_CACHE_AGE_MS = 12 * 60 * 60 * 1000;

// In-memory cache for friend lists (steamId -> { friends: string[], cachedAt: Date })
const friendListCache = new Map<string, { friends: string[]; cachedAt: Date }>();

export async function GET(
  request: NextRequest,
  { params }: { params: { steamId: string } }
) {
  try {
    // Get authenticated user
    const cookies = request.cookies;
    const loggedInSteamId = cookies.get("steam_id")?.value;
    const targetSteamId = params.steamId;

    if (!loggedInSteamId) {
      return ApiErrors.notAuthenticated();
    }

    if (!targetSteamId) {
      return ApiErrors.missingParameter("steamId");
    }

    // No authorization check needed - Steam API enforces privacy
    // If profile is private, Steam API will return error/empty list
    // If profile is public, Steam API will return friends list
    // This matches Steam's behavior: public profiles = viewable friends list

    const steamClient = getSteamClient();
    const dataAccess = getDataAccess();
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get("refresh") === "true";

    // Check cache for friend list
    let friendSteamIds: string[] = [];
    const cachedFriendList = friendListCache.get(targetSteamId);
    const now = new Date();

    if (!forceRefresh && cachedFriendList) {
      const cacheAge = now.getTime() - cachedFriendList.cachedAt.getTime();
      if (cacheAge < FRIEND_LIST_CACHE_AGE_MS) {
        friendSteamIds = cachedFriendList.friends;
      }
    }

    // Fetch friend list if not cached or cache expired
    if (friendSteamIds.length === 0) {
      try {
        friendSteamIds = await steamClient.getFriendList(targetSteamId);
        // Update cache
        friendListCache.set(targetSteamId, { friends: friendSteamIds, cachedAt: now });
      } catch (error) {
        console.error("Error fetching friend list:", error);
        // If we have cached data, use it even if fetch failed
        if (cachedFriendList) {
          friendSteamIds = cachedFriendList.friends;
        } else {
          return NextResponse.json({ friends: [] });
        }
      }
    }

    if (friendSteamIds.length === 0) {
      return NextResponse.json({ friends: [] });
    }

    // Fetch friend summaries in batches (Steam API supports up to 100 at a time)
    const batchSize = 100;
    const allFriends: any[] = [];

    for (let i = 0; i < friendSteamIds.length; i += batchSize) {
      const batch = friendSteamIds.slice(i, i + batchSize);
      const steamIdsParam = batch.join(",");
      
      try {
        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${process.env.STEAM_API_KEY}&steamids=${steamIdsParam}`;
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          if (data.response?.players) {
            allFriends.push(...data.response.players);
          }
        }
      } catch (error) {
        console.error(`Error fetching friend summaries for batch ${i}:`, error);
        // Continue with other batches even if one fails
      }
    }

    // Build friend objects with basic info (statistics will be loaded progressively)
    const friendsWithBasicInfo = allFriends.map((friend) => {
      const countryName = friend.loccountrycode
        ? getCountryName(friend.loccountrycode)
        : undefined;

      const joinDate = friend.timecreated
        ? new Date(friend.timecreated * 1000)
        : undefined;

      return {
        steamId: friend.steamid,
        username: friend.personaname,
        avatarUrl: friend.avatarfull,
        profileUrl: friend.profileurl,
        countryCode: friend.loccountrycode,
        countryName,
        joinDate: joinDate?.toISOString(),
        // Statistics will be loaded separately via progressive loading
        statistics: {
          totalGames: 0,
          totalAchievements: 0,
          friendsCount: 0,
        },
        // Flag to indicate stats need to be loaded
        statsLoaded: false,
      };
    });

    return NextResponse.json(
      { friends: friendsWithBasicInfo },
      {
        headers: {
          "Cache-Control": "private, max-age=300", // Browser cache for 5 minutes
        },
      }
    );
  } catch (error) {
    console.error("Error fetching friends:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return ApiErrors.internalError(
      'Failed to fetch friends',
      errorMessage
    );
  }
}
