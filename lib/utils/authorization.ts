import { getSteamClient } from '@/lib/steam/client';

// Cache duration for friend lists (12 hours)
const FRIEND_LIST_CACHE_AGE_MS = 12 * 60 * 60 * 1000;

// In-memory cache for friend lists (steamId -> { friends: string[], cachedAt: Date })
const friendListCache = new Map<string, { friends: string[]; cachedAt: Date }>();

/**
 * Verify if a target user is a friend of the logged-in user
 * @param loggedInSteamId - The steamId of the logged-in user
 * @param targetSteamId - The steamId to check
 * @returns Promise<boolean> - true if target is a friend, false otherwise
 */
export async function verifyIsFriend(
  loggedInSteamId: string,
  targetSteamId: string
): Promise<boolean> {
  // If checking self, always allow
  if (loggedInSteamId === targetSteamId) {
    return true;
  }

  try {
    // Check cache first
    const cachedFriendList = friendListCache.get(loggedInSteamId);
    const now = new Date();

    if (cachedFriendList) {
      const cacheAge = now.getTime() - cachedFriendList.cachedAt.getTime();
      if (cacheAge < FRIEND_LIST_CACHE_AGE_MS) {
        return cachedFriendList.friends.includes(targetSteamId);
      }
    }

    // Fetch friend list if not cached or cache expired
    const steamClient = getSteamClient();
    const friendList = await steamClient.getFriendList(loggedInSteamId);
    
    // Update cache
    friendListCache.set(loggedInSteamId, { friends: friendList, cachedAt: now });
    
    return friendList.includes(targetSteamId);
  } catch (error) {
    console.error('Error verifying friendship:', error);
    // If we have cached data, use it even if fetch failed
    const cachedFriendList = friendListCache.get(loggedInSteamId);
    if (cachedFriendList) {
      return cachedFriendList.friends.includes(targetSteamId);
    }
    // On error, deny access for security
    return false;
  }
}
