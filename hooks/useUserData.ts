import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string;
  countryName?: string;
  joinDate?: string;
}

interface UseUserDataResult {
  user: User | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch user data
 * @param steamId - Optional steamId. If not provided, fetches logged-in user's data
 * @param redirectOnError - Whether to redirect to home on error (default: true for logged-in user)
 */
export function useUserData(steamId?: string, redirectOnError: boolean = !steamId): UseUserDataResult {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const endpoint = steamId ? `/api/user/${steamId}` : '/api/user';
        const res = await fetch(endpoint);

        if (!res.ok) {
          if (res.status === 401 || res.status === 404) {
            if (redirectOnError) {
              router.push('/');
              return;
            }
            throw new Error('User not found');
          }
          throw new Error(`Failed to fetch user: ${res.status}`);
        }

        const data = await res.json();
        setUser(data?.user || null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to fetch user');
        setError(error);
        if (redirectOnError) {
          router.push('/');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, [steamId, router, redirectOnError]);

  return { user, isLoading, error };
}
