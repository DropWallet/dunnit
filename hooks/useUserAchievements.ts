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

interface UseUserAchievementsResult {
  achievements: Achievement[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch all achievements for a user
 * @param steamId - Optional steamId. If not provided, fetches logged-in user's achievements
 */
export function useUserAchievements(steamId?: string): UseUserAchievementsResult {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAchievements = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = steamId 
        ? `/api/user/${steamId}/achievements/all` 
        : '/api/achievements/all';
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

  useEffect(() => {
    fetchAchievements();
  }, [steamId]);

  return {
    achievements,
    isLoading,
    error,
    refetch: fetchAchievements,
  };
}
