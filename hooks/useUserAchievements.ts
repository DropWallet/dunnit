import { useState, useEffect, useCallback } from 'react';
import type { UserAchievement } from '@/lib/utils/sorting';

interface UseUserAchievementsResult {
  achievements: UserAchievement[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch all achievements for a user
 * @param steamId - Optional steamId. If not provided, fetches logged-in user's achievements
 * @param enabled - Whether to fetch achievements immediately (default: true). Set to false for lazy loading.
 */
export function useUserAchievements(steamId?: string, enabled: boolean = true): UseUserAchievementsResult {
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [isLoading, setIsLoading] = useState(enabled); // Only show loading if enabled
  const [error, setError] = useState<Error | null>(null);

  const fetchAchievements = useCallback(async () => {
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
      // The API returns UserAchievement[] which has achievement.apiName and achievement.iconGrayUrl
      const parsedAchievements = (data?.achievements || []).map((ach: any) => ({
        ...ach,
        unlockedAt: ach.unlockedAt ? new Date(ach.unlockedAt) : undefined,
        achievement: ach.achievement ? {
          ...ach.achievement,
          apiName: ach.achievement.apiName,
          iconGrayUrl: ach.achievement.iconGrayUrl,
        } : undefined,
      }));
      setAchievements(parsedAchievements);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch achievements');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [steamId]);

  useEffect(() => {
    if (enabled) {
      fetchAchievements();
    }
  }, [enabled, fetchAchievements]);

  return {
    achievements,
    isLoading,
    error,
    refetch: fetchAchievements,
  };
}
