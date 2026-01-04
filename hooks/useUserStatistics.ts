import { useState, useEffect } from 'react';

interface Statistics {
  totalGames: number;
  startedGames: number;
  totalAchievements: number;
  unlockedAchievements: number;
  averageCompletionRate: number;
}

interface UseUserStatisticsResult {
  statistics: Statistics | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch user statistics
 * @param steamId - Optional steamId. If not provided, fetches logged-in user's statistics
 */
export function useUserStatistics(steamId?: string): UseUserStatisticsResult {
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatistics = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = steamId ? `/api/user/${steamId}/statistics` : '/api/user/statistics';
      const res = await fetch(endpoint);

      if (!res.ok) {
        throw new Error(`Failed to fetch statistics: ${res.status}`);
      }

      const data = await res.json();
      setStatistics(data?.statistics || null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch statistics');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatistics();
  }, [steamId]);

  return {
    statistics,
    isLoading,
    error,
    refetch: fetchStatistics,
  };
}
