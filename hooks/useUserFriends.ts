import { useState, useEffect } from "react";

interface Friend {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string;
  countryName?: string;
  joinDate?: string;
  statistics: {
    totalGames: number;
    totalAchievements: number;
    friendsCount: number;
  };
  statsLoaded?: boolean;
}

interface UseUserFriendsResult {
  friends: Friend[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch friends for a specific user
 * @param steamId - The Steam ID of the user whose friends to fetch
 * @param enabled - Whether to fetch friends (default: true)
 * @returns Friends list, loading state, and error
 */
export function useUserFriends(
  steamId: string,
  enabled: boolean = true
): UseUserFriendsResult {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !steamId) {
      setFriends([]);
      setIsLoading(false);
      return;
    }

    async function loadFriends() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/user/${steamId}/friends`);
        
        if (res.ok) {
          const data = await res.json();
          setFriends(data.friends || []);
        } else {
          const errorData = await res.json().catch(() => ({}));
          setError(new Error(errorData.error?.message || `Failed to fetch friends: ${res.status}`));
          setFriends([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch friends"));
        setFriends([]);
      } finally {
        setIsLoading(false);
      }
    }

    loadFriends();
  }, [steamId, enabled]);

  return { friends, isLoading, error };
}
