"use client";

import { useState, useEffect, useRef } from "react";
import { type FeedSession } from "@/lib/utils/feed-sessions";

interface UseFeedResult {
  sessions: FeedSession[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

const DEFAULT_LIMIT = 20;

/**
 * Hook to fetch the social feed with pagination
 */
export function useFeed(): UseFeedResult {
  const [sessions, setSessions] = useState<FeedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const isFetchingRef = useRef(false); // Prevent concurrent fetches

  const parseSessions = (sessionsData: any[]): FeedSession[] => {
    return (sessionsData || []).map((session: any) => ({
      ...session,
      sessionStart: new Date(session.sessionStart),
      sessionEnd: new Date(session.sessionEnd),
      achievements: (session.achievements || []).map((ach: any) => ({
        ...ach,
        unlockedAt: new Date(ach.unlockedAt),
      })),
    }));
  };

  const fetchFeed = async (currentOffset: number = 0, append: boolean = false) => {
    // Prevent concurrent fetches (unless it's a "load more" which is intentional)
    if (isFetchingRef.current && !append) {
      return;
    }
    
    isFetchingRef.current = true;
    
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setOffset(0);
    }
    setError(null);

    try {
      const cacheBuster = `&t=${Date.now()}`;
      const res = await fetch(`/api/feed?limit=${DEFAULT_LIMIT}&offset=${currentOffset}${cacheBuster}`, {
        cache: 'no-store', // Bypass browser cache
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch feed: ${res.status}`);
      }

      const data = await res.json();
      const parsedSessions = parseSessions(data?.sessions || []);
      
      if (append) {
        setSessions(prev => [...prev, ...parsedSessions]);
      } else {
        setSessions(parsedSessions);
      }
      
      setHasMore(data?.pagination?.hasMore || false);
      setOffset(currentOffset + parsedSessions.length);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to fetch feed");
      setError(error);
      if (!append) {
        setSessions([]);
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      isFetchingRef.current = false; // Reset the flag
    }
  };

  const loadMore = async () => {
    if (!hasMore || isLoadingMore) return;
    await fetchFeed(offset, true);
  };

  useEffect(() => {
    fetchFeed(0, false);
  }, []);

  return {
    sessions,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refetch: () => fetchFeed(0, false),
  };
}
