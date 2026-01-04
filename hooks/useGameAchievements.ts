import { useState, useEffect } from 'react';

interface Achievement {
  achievement: {
    name: string;
    description: string;
    iconUrl: string;
    globalPercentage?: number;
  };
  unlocked: boolean;
  unlockedAt?: Date;
}

interface UseGameAchievementsResult {
  achievements: Achievement[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch achievements for a specific game
 * @param appId - The game's app ID
 * @param steamId - Optional steamId. If not provided, fetches logged-in user's achievements
 */
export function useGameAchievements(appId: number | null, steamId?: string): UseGameAchievementsResult {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!appId) {
      setAchievements([]);
      setIsLoading(false);
      return;
    }

    const fetchAchievements = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const endpoint = steamId
          ? `/api/achievements?appId=${appId}&steamId=${steamId}`
          : `/api/achievements?appId=${appId}`;
        const res = await fetch(endpoint);

        if (!res.ok) {
          throw new Error(`Failed to fetch achievements: ${res.status}`);
        }

        const data = await res.json();
        // Parse dates from strings if needed
        const parsedAchievements = (data?.achievements || []).map((ach: any) => ({
          ...ach,
          unlockedAt: ach.unlockedAt ? new Date(ach.unlockedAt) : undefined,
        }));
        setAchievements(parsedAchievements);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to fetch achievements');
        setError(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAchievements();
  }, [appId, steamId]);

  return {
    achievements,
    isLoading,
    error,
  };
}
