import { NextRequest, NextResponse } from "next/server";
import { getDataAccess } from "@/lib/data/access";
import { getSteamClient } from "@/lib/steam/client";
import { ApiErrors } from "@/lib/utils/api-errors";
import { calculateStatistics } from "@/lib/utils/statistics";
import { getLatestAchievementUnlockTime } from "@/lib/utils/achievements";

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
    const searchParams = request.nextUrl.searchParams;
    const lightweight = searchParams.get('lightweight') === 'true';

    // Get friend's friends count (always fetch this)
    let friendsCount = 0;
    try {
      const steamClient = getSteamClient();
      const friendList = await steamClient.getFriendList(friendSteamId);
      friendsCount = friendList.length;
    } catch (error) {
      // Only log unexpected errors (not 401 which is expected for private profiles)
      if (error instanceof Error && !error.message.includes('401')) {
        console.error(`Error fetching friends count for ${friendSteamId}:`, error);
      }
      // If we can't get friends count, just use 0
    }

    // If lightweight mode, only return friends count
    if (lightweight) {
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
    }

    // Get friend's games (only use cached games, don't fetch from Steam)
    let friendGames = await dataAccess.getUserGames(friendSteamId);
    const user = await dataAccess.getUser(friendSteamId);
    
    // If no games cached, only return friends count (don't fetch from Steam)
    if (friendGames.length === 0) {
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
    }
    
    // Games are cached, so we can calculate statistics
    // Check if we should refresh games from Steam API
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const shouldRefreshGames = !user?.lastSyncAt || user.lastSyncAt < oneHourAgo;
    
    if (shouldRefreshGames) {
      try {
        const steamClient = getSteamClient();
        const [fullLibraryResponse, recentlyPlayedResponse] = await Promise.all([
          steamClient.getOwnedGames(friendSteamId, true),
          steamClient.getRecentlyPlayedGames(friendSteamId).catch(() => {
            return { response: { games: [] } };
          }),
        ]);

        const recentlyPlayedMap = new Map<number, { rtime_last_played?: number; playtime_2weeks?: number }>();
        if (recentlyPlayedResponse.response?.games && recentlyPlayedResponse.response.games.length > 0) {
          recentlyPlayedResponse.response.games.forEach((game) => {
            recentlyPlayedMap.set(game.appid, {
              rtime_last_played: game.rtime_last_played,
              playtime_2weeks: game.playtime_2weeks,
            });
          });
        }

        friendGames = (fullLibraryResponse.response.games || []).map((steamGame) => {
          const recentGame = recentlyPlayedMap.get(steamGame.appid);
          const lastPlayed = recentGame?.rtime_last_played 
            ? new Date(recentGame.rtime_last_played * 1000)
            : steamGame.rtime_last_played 
              ? new Date(steamGame.rtime_last_played * 1000)
              : undefined;
          const playtime2Weeks = recentGame?.playtime_2weeks ?? steamGame.playtime_2weeks ?? 0;
          const coverImageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${steamGame.appid}/header.jpg`;

          return {
            appId: steamGame.appid,
            name: steamGame.name,
            playtimeMinutes: steamGame.playtime_forever || 0,
            playtime2WeeksMinutes: playtime2Weeks,
            iconUrl: steamGame.img_icon_url 
              ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_icon_url}.jpg`
              : undefined,
            logoUrl: steamGame.img_logo_url
              ? `https://media.steampowered.com/steamcommunity/public/images/apps/${steamGame.appid}/${steamGame.img_logo_url}.jpg`
              : undefined,
            coverImageUrl,
            lastPlayed,
          };
        });

        // Calculate derived_last_played for games without lastPlayed
        const now = new Date();
        const gamesWithDerivedLastPlayed = await Promise.all(
          friendGames.map(async (game) => {
            if (game.lastPlayed) {
              return game;
            }

            try {
              const achievements = await dataAccess.getUserAchievements(friendSteamId, game.appId);
              const latestUnlock = getLatestAchievementUnlockTime(achievements);
              
              if (latestUnlock) {
                return {
                  ...game,
                  derivedLastPlayed: latestUnlock,
                  derivedLastPlayedCalculatedAt: now,
                };
              }
            } catch (error) {
              // If achievements aren't cached yet, that's okay
            }

            return game;
          })
        );

        // Save games to cache
        await dataAccess.saveUserGames(friendSteamId, gamesWithDerivedLastPlayed);
        await dataAccess.updateUser(friendSteamId, { lastSyncAt: new Date() });
        
        friendGames = gamesWithDerivedLastPlayed;
      } catch (error) {
        console.error(`Error fetching games for friend ${friendSteamId}:`, error);
        // Continue with cached games (or empty array)
      }
    }
    
    const gamesCount = friendGames?.length || 0;
    
    // Get friend's statistics (calculate if not cached or stale)
    let friendStats = await dataAccess.getUserStatistics(friendSteamId);
    let achievementsCount = friendStats?.statistics?.totalAchievements || 0;
    let unlockedAchievementsCount = friendStats?.statistics?.unlockedAchievements || 0;
    
    // Check if we need to recalculate statistics
    // Recalculate if: force refresh, no stats, stats are stale, or data has changed
    const forceRefresh = searchParams.get('force') === 'true';
    const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const shouldRecalculate = forceRefresh ||
      !friendStats || 
      !friendStats.statistics || 
      !friendStats.calculatedAt ||
      (Date.now() - friendStats.calculatedAt.getTime()) > MAX_CACHE_AGE_MS ||
      (user?.lastSyncAt && friendStats.calculatedAt && user.lastSyncAt > friendStats.calculatedAt);
    
    if (shouldRecalculate) {
      // Fetch achievements for all games to calculate statistics (from cache only)
      // Note: Only uses cached achievements (doesn't fetch from Steam for performance)
      if (friendGames.length > 0) {
        const achievementPromises = friendGames.map(async (game) => {
          try {
            const achievements = await dataAccess.getUserAchievements(friendSteamId, game.appId);
            return { appId: game.appId, achievements };
          } catch (error) {
            return { appId: game.appId, achievements: [] };
          }
        });
        
        const achievementResults = await Promise.all(achievementPromises);
        const allAchievements = new Map<number, any[]>();
        achievementResults.forEach(({ appId, achievements }) => {
          if (achievements.length > 0) {
            allAchievements.set(appId, achievements);
          }
        });
        
        // Calculate statistics using the same logic as dashboard
        const calculatedStats = calculateStatistics(friendGames, allAchievements);
        achievementsCount = calculatedStats.totalAchievements;
        unlockedAchievementsCount = calculatedStats.unlockedAchievements;
        
        // Save to cache for future use
        // Only save if user exists (to avoid foreign key constraint error)
        if (user) {
          try {
            await dataAccess.saveUserStatistics(friendSteamId, calculatedStats);
          } catch (error) {
            // If user doesn't exist, log but don't fail - we can still return the stats
            console.warn(`Could not save statistics for ${friendSteamId} (user may not exist):`, error);
          }
        }
        
        // Debug logging (only in development)
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Friend Stats] Recalculated for ${friendSteamId}:`, {
            gamesCount: friendGames.length,
            gamesWithAchievements: allAchievements.size,
            totalGames: calculatedStats.totalGames,
            totalAchievements: calculatedStats.totalAchievements,
            unlockedAchievements: calculatedStats.unlockedAchievements,
            averageCompletionRate: calculatedStats.averageCompletionRate,
            forceRefresh,
          });
        }
      } else {
        // No games, return empty stats
        achievementsCount = 0;
        unlockedAchievementsCount = 0;
        // Only save if user exists
        if (user) {
          try {
            await dataAccess.saveUserStatistics(friendSteamId, {
              totalGames: 0,
              startedGames: 0,
              totalAchievements: 0,
              unlockedAchievements: 0,
              averageCompletionRate: 0,
            });
          } catch (error) {
            console.warn(`Could not save empty statistics for ${friendSteamId} (user may not exist):`, error);
          }
        }
      }
    } else {
      // Use cached statistics (they're fresh and accurate)
      achievementsCount = friendStats.statistics.totalAchievements || 0;
      unlockedAchievementsCount = friendStats.statistics.unlockedAchievements ?? 0;
      
      // Safety check: if unlockedAchievements is missing from cached stats, recalculate
      if (friendStats.statistics.unlockedAchievements === undefined) {
        // Recalculate to ensure we have unlockedAchievements
        if (friendGames.length > 0) {
          const achievementPromises = friendGames.map(async (game) => {
            try {
              const achievements = await dataAccess.getUserAchievements(friendSteamId, game.appId);
              return { appId: game.appId, achievements };
            } catch (error) {
              return { appId: game.appId, achievements: [] };
            }
          });
          
          const achievementResults = await Promise.all(achievementPromises);
          const allAchievements = new Map<number, any[]>();
          achievementResults.forEach(({ appId, achievements }) => {
            if (achievements.length > 0) {
              allAchievements.set(appId, achievements);
            }
          });
          
          const calculatedStats = calculateStatistics(friendGames, allAchievements);
          achievementsCount = calculatedStats.totalAchievements;
          unlockedAchievementsCount = calculatedStats.unlockedAchievements;
          
          // Update cached statistics with unlockedAchievements
          if (user) {
            try {
              await dataAccess.saveUserStatistics(friendSteamId, calculatedStats);
            } catch (error) {
              console.warn(`Could not save updated statistics for ${friendSteamId}:`, error);
            }
          }
        }
      }
      
      // Debug logging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Friend Stats] Using cached stats for ${friendSteamId}:`, {
          totalAchievements: achievementsCount,
          unlockedAchievements: unlockedAchievementsCount,
          calculatedAt: friendStats.calculatedAt,
          forceRefresh,
          shouldRecalculate,
        });
      }
    }

    return NextResponse.json(
      {
        statistics: {
          totalGames: gamesCount,
          totalAchievements: achievementsCount,
          unlockedAchievements: unlockedAchievementsCount,
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
