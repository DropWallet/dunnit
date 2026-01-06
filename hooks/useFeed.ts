"use client";

import { useState, useEffect } from "react";
import { type FeedSession } from "@/lib/utils/feed-sessions";

interface UseFeedResult {
  sessions: FeedSession[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch the social feed
 */
export function useFeed(): UseFeedResult {
  const [sessions, setSessions] = useState<FeedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchFeed = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/feed?limit=20");
      
      if (!res.ok) {
        throw new Error(`Failed to fetch feed: ${res.status}`);
      }

      const data = await res.json();
      
      // Parse dates from strings if needed
      const parsedSessions = (data?.sessions || []).map((session: any) => ({
        ...session,
        sessionStart: new Date(session.sessionStart),
        sessionEnd: new Date(session.sessionEnd),
        achievements: (session.achievements || []).map((ach: any) => ({
          ...ach,
          unlockedAt: new Date(ach.unlockedAt),
        })),
      }));
      
      setSessions(parsedSessions);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to fetch feed");
      setError(error);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, []);

  return {
    sessions,
    isLoading,
    error,
    refetch: fetchFeed,
  };
}
