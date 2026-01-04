import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

interface Game {
  appId: number;
  name: string;
  playtimeMinutes: number;
  playtime2WeeksMinutes?: number;
  iconUrl?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  lastPlayed?: Date;
}

interface UseUserGamesResult {
  games: Game[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch user games
 * @param steamId - Optional steamId. If not provided, fetches logged-in user's games
 */
export function useUserGames(steamId?: string): UseUserGamesResult {
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const searchParams = useSearchParams();

  const fetchGames = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let endpoint = steamId ? `/api/user/${steamId}/games` : '/api/games';
      
      // Check if refresh parameter is in URL
      let refresh: string | null = null;
      try {
        refresh = searchParams?.get('refresh');
      } catch (e) {
        // Fallback to window.location if useSearchParams fails (e.g., no Suspense boundary)
        if (typeof window !== 'undefined') {
          const urlParams = new URLSearchParams(window.location.search);
          refresh = urlParams.get('refresh');
        }
      }
      
      if (refresh === 'true') {
        endpoint += endpoint.includes('?') ? '&refresh=true' : '?refresh=true';
      }
      
      const res = await fetch(endpoint);

      if (!res.ok) {
        throw new Error(`Failed to fetch games: ${res.status}`);
      }

      const data = await res.json();
      
      // Parse dates from strings if needed
      const parsedGames = (data?.games || []).map((game: Game) => ({
        ...game,
        lastPlayed: game.lastPlayed ? new Date(game.lastPlayed) : undefined,
      }));
      
      setGames(parsedGames);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch games');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [steamId, searchParams]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  return {
    games,
    isLoading,
    error,
    refetch: fetchGames,
  };
}
