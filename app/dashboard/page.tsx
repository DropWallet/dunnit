"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { getCountryFlag } from "@/lib/utils/country";
import { DotSeparator } from "@/components/dot-separator";
import { GameCard } from "@/components/game-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { Trophy } from "@/components/trophy";
import { calculateRarity } from "@/lib/utils/achievements";
import { GameSortingControls } from "@/components/game-sorting-controls";
import { AchievementSortingControls } from "@/components/achievement-sorting-controls";
import { AchievementBreakdown } from "@/components/achievement-breakdown";
import { FriendsList } from "@/components/friends-list";
import { UserProfileHeader } from "@/components/user-profile-header";
import { SyncLoadingModal } from "@/components/sync-loading-modal";
import type { Game } from "@/lib/data/types";
import {
  sortGames,
  sortAchievements,
  type GameSortOption,
  type AchievementSortOption,
  type GameAchievement,
  type UserAchievement
} from "@/lib/utils/sorting";
import { isFeatureEnabled } from "@/lib/utils/feature-flags";

interface User {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string;
  countryName?: string;
  joinDate?: string;
}

interface Statistics {
  totalGames: number;
  startedGames: number;
  totalAchievements: number;
  unlockedAchievements: number;
  averageCompletionRate: number;
}

interface Friend {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string;
  countryName?: string;
  joinDate?: string;
  communityVisibilityState?: number; // 1 = Private, 3 = Public
  statistics: {
    totalGames: number;
    totalAchievements: number;
    unlockedAchievements: number;
    friendsCount: number;
  };
  statsLoaded?: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [gameAchievements, setGameAchievements] = useState<Map<number, GameAchievement[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingGames, setIsLoadingGames] = useState(true);
  const [displayedGamesCount, setDisplayedGamesCount] = useState(15);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState<GameSortOption>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('dashboard-sort-by') || 'last-played') as GameSortOption;
    }
    return 'last-played';
  });
  const [showUnplayed, setShowUnplayed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('dashboard-show-unplayed');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [allGames, setAllGames] = useState<Game[]>([]);
  const [loadingAchievements, setLoadingAchievements] = useState<Set<number>>(new Set());
  const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);
  
  // Track when user explicitly clicks Achievements tab (captured via onChange handler)
  const [achievementsTabClicked, setAchievementsTabClicked] = useState(false);
  
  // Track initial mount to prevent TabGroup onChange from triggering during initialization
  const isInitialMountRef = useRef(true);
  
  // Sync loading modal state with 300ms delay
  const [showSyncModal, setShowSyncModal] = useState(false);
  const syncModalTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Achievement tab state
  const [achievementSortBy, setAchievementSortBy] = useState<AchievementSortOption>("rarity");
  const [allAchievementsList, setAllAchievementsList] = useState<UserAchievement[]>([]);
  const [displayedAchievementsCount, setDisplayedAchievementsCount] = useState(30);
  const [isLoadingAllAchievements, setIsLoadingAllAchievements] = useState(false);
  const achievementLoadMoreObserverRef = useRef<IntersectionObserver | null>(null);

  // Friends tab state
  const [friends, setFriends] = useState<Friend[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [loadingFriendStats, setLoadingFriendStats] = useState<Set<string>>(new Set());
  const [friendsRefreshKey, setFriendsRefreshKey] = useState(0);
  const friendsStatsLoadingRef = useRef<Set<string>>(new Set());
  // Ref to track loaded achievement appIds to prevent re-fetching
  const loadedAchievementAppIds = useRef<Set<number>>(new Set());
  const friendsFullStatsAttemptedRef = useRef<Set<string>>(new Set());
  
  // Refs for statistics refetch tracking
  const previousLoadingSizeRef = useRef<number>(0);
  const hasRefetchedForThisCycleRef = useRef<boolean>(false);
  
  // Friend statistics queue system with rate limiting
  const friendStatsQueueRef = useRef<Array<{ steamId: string; lightweight: boolean }>>([]);
  const friendStatsProcessingRef = useRef<boolean>(false);
  const friendStatsDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_CONCURRENT_REQUESTS = 3; // Limit concurrent requests to avoid database overload
  const QUEUE_DEBOUNCE_MS = 300; // Debounce queue processing by 300ms to batch requests
  const REQUEST_DELAY_MS = 100; // Delay between individual requests within a batch

  // Tab state - remember last selected tab only on browser back/forward navigation
  const [selectedTabIndex, setSelectedTabIndex] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      // Use Navigation API if available (more reliable)
      // Type assertion needed as Navigation API types aren't fully available
      const nav = (window as any).navigation;
      if (nav && nav.currentEntry) {
        const navEntry = nav.currentEntry;
        if (navEntry.transitionType === 'back_forward') {
          const saved = sessionStorage.getItem('dashboard-selected-tab');
          return saved !== null ? parseInt(saved, 10) : 0;
        }
      }
      
      // Fallback: Check if page was loaded from cache (back/forward navigation)
      // Pages loaded from cache typically have navigation timing type 'back_forward'
      try {
        const perfEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        if (perfEntries.length > 0) {
          const navEntry = perfEntries[0];
          if (navEntry.type === 'back_forward') {
            const saved = sessionStorage.getItem('dashboard-selected-tab');
            return saved !== null ? parseInt(saved, 10) : 0;
          }
        }
      } catch (e) {
        // Fall through to default
      }
      
      // For link navigation, always default to Games tab (index 0)
      return 0;
    }
    return 0;
  });

  // Save tab index to sessionStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('dashboard-selected-tab', selectedTabIndex.toString());
    }
  }, [selectedTabIndex]);

  // Sync loading modal with 300ms delay - hide when data is ready to render
  // Modal should stay visible until games and statistics are loaded (skeleton is ready)
  const isDataReady = allGames.length > 0 && statistics !== null;
  const isCriticalPathLoading = isLoadingGames || isLoadingFriends;
  
  useEffect(() => {
    // Show modal if loading critical path OR data not ready yet
    if (isCriticalPathLoading || !isDataReady) {
      if (syncModalTimeoutRef.current) {
        clearTimeout(syncModalTimeoutRef.current);
      }
      syncModalTimeoutRef.current = setTimeout(() => {
        setShowSyncModal(true);
      }, 300);
    } else {
      if (syncModalTimeoutRef.current) {
        clearTimeout(syncModalTimeoutRef.current);
        syncModalTimeoutRef.current = null;
      }
      setShowSyncModal(false);
    }
    
    return () => {
      if (syncModalTimeoutRef.current) {
        clearTimeout(syncModalTimeoutRef.current);
      }
    };
  }, [isCriticalPathLoading, isDataReady]);

  // PERFORMANCE: Fetch user, statistics, and games in parallel (Phase 1a)
  // Feature flag: PARALLEL_INITIAL_FETCHES
  useEffect(() => {
    if (isFeatureEnabled('PARALLEL_INITIAL_FETCHES')) {
      // NEW: Parallel fetch approach
      console.log('[Perf] Phase 1a: Fetching user, stats, and games in parallel');
      const fetchStartTime = performance.now();

      Promise.all([
        fetch("/api/user").then(res => {
          if (!res.ok) throw new Error('User fetch failed');
          return res.json();
        }),
        fetch("/api/user/statistics").then(res => {
          if (res.ok) return res.json();
          return null;
        }),
      ])
        .then(([userData, statsData]) => {
          const fetchEndTime = performance.now();
          console.log(`[Perf] Phase 1a: Parallel fetches completed in ${(fetchEndTime - fetchStartTime).toFixed(0)}ms`);

          // Set user data
          if (userData?.user) {
            setUser(userData.user);
          }
          setIsLoading(false);

          // Set statistics data
          if (statsData?.statistics) {
            setStatistics(statsData.statistics);
          }
          setIsLoadingStats(false);
        })
        .catch((error) => {
          console.error('[Perf] Phase 1a: Parallel fetch failed:', error);
          // If user fetch fails, redirect to login
          router.push("/");
        });
    } else {
      // OLD: Sequential fetch approach (fallback)
      console.log('[Perf] Phase 1a: Using sequential fetches (feature flag disabled)');

      // Fetch user data
      fetch("/api/user")
        .then((res) => {
          if (!res.ok) {
            router.push("/");
            return;
          }
          return res.json();
        })
        .then((data) => {
          if (data?.user) {
            setUser(data.user);
          }
          setIsLoading(false);
        })
        .catch(() => {
          router.push("/");
        });

      // Fetch statistics
      fetch("/api/user/statistics")
        .then((res) => {
          if (res.ok) {
            return res.json();
          }
          return null;
        })
        .then((data) => {
          if (data?.statistics) {
            setStatistics(data.statistics);
          }
          setIsLoadingStats(false);
        })
        .catch(() => {
          setIsLoadingStats(false);
        });
    }
  }, [router]);

  // Fetch games and achievements
  useEffect(() => {
    async function loadGames() {
      try {
        const gamesRes = await fetch("/api/games");
        if (!gamesRes.ok) {
          setIsLoadingGames(false);
          return;
        }
        
        const gamesData = await gamesRes.json();
        
        // Store all games
        setAllGames(gamesData.games);
        
        // Fetch achievements for displayed games only (first batch of 15)
        // This is needed for GameCard display regardless of sort option
        const initialBatch = gamesData.games.slice(0, 15);
        
        // If sorting by achievement progress, fetch for all games
        const allGamesNeedingAchievements = sortBy === 'achievement-progress' 
          ? gamesData.games 
          : initialBatch;
        
        // Use ref to check what's already loaded (prevents re-fetching)
        const gamesNeedingAchievements = allGamesNeedingAchievements.filter(
          (game: Game) => !loadedAchievementAppIds.current.has(game.appId)
        );
        
        // If no games need achievements, skip fetching
        if (gamesNeedingAchievements.length === 0) {
          setIsLoadingGames(false);
          return;
        }
        
        // Mark games as loading
        const appIdsToLoad = gamesNeedingAchievements.map((g: Game) => g.appId);
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id: number) => newSet.add(id));
          return newSet;
        });
        
        const achievementPromises = gamesNeedingAchievements.map(async (game: Game) => {
          try {
            const achRes = await fetch(`/api/achievements?appId=${game.appId}`);
            if (!achRes.ok) return { appId: game.appId, achievements: [] };
            const achData = await achRes.json();
            // Parse dates from strings if needed
            const parsedAchievements = (achData.achievements || []).map((ach: GameAchievement) => ({
              ...ach,
              unlockedAt: ach.unlockedAt ? (ach.unlockedAt instanceof Date ? ach.unlockedAt : new Date(ach.unlockedAt)) : undefined,
            }));
            return { appId: game.appId, achievements: parsedAchievements };
          } catch {
            return { appId: game.appId, achievements: [] };
          }
        });
        
        const achievementsData = await Promise.all(achievementPromises);
        const achievementsMap = new Map(gameAchievements);
        achievementsData.forEach(({ appId, achievements }) => {
          achievementsMap.set(appId, achievements);
          loadedAchievementAppIds.current.add(appId);
        });
        setGameAchievements(achievementsMap);
        
        // Remove from loading set
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id: number) => newSet.delete(id));
          return newSet;
        });
        
        setIsLoadingGames(false);
      } catch (error) {
        console.error("Error loading games:", error);
        setIsLoadingGames(false);
      }
    }
    
    loadGames();
  }, [sortBy, gameAchievements]);

  // Handle tab changes - capture user intent directly via onChange event
  const handleTabChange = (index: number) => {
    setSelectedTabIndex(index);
    
    // Only set achievementsTabClicked when user explicitly clicks Achievements tab
    // Ignore onChange calls during initial mount (when TabGroup syncs with restored selectedIndex)
    if (index === 1 && !isInitialMountRef.current) {
      setAchievementsTabClicked(true);
    }
  };

  // Mark initial mount as complete after first render
  useEffect(() => {
    // Use setTimeout to ensure this runs after TabGroup's initialization onChange
    const timer = setTimeout(() => {
      isInitialMountRef.current = false;
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Fetch all achievements for Achievements tab - lazy load only when tab is clicked
  useEffect(() => {
    // Only fetch when Achievements tab (index 1) is explicitly clicked
    if (selectedTabIndex !== 1 || !achievementsTabClicked) {
      return;
    }
    
    // Don't refetch if already loaded
    if (allAchievementsList.length > 0) {
      return;
    }
    
    async function loadAllAchievements() {
      setIsLoadingAllAchievements(true);
      try {
        const res = await fetch("/api/achievements/all");
        if (res.ok) {
          const data = await res.json();
          setAllAchievementsList(data.achievements || []);
        } else {
          console.error("Failed to fetch achievements:", res.status);
        }
      } catch (error) {
        console.error("Error loading achievements:", error);
      } finally {
        setIsLoadingAllAchievements(false);
      }
    }
    
    loadAllAchievements();
  }, [selectedTabIndex, achievementsTabClicked, allAchievementsList.length]);

  // Refetch statistics when achievements finish loading
  useEffect(() => {
    const currentLoadingSize = loadingAchievements.size;
    const wasLoading = previousLoadingSizeRef.current > 0;
    const isNowDone = currentLoadingSize === 0;

    // Reset the refetch flag when we start loading a new batch
    if (currentLoadingSize > 0 && previousLoadingSizeRef.current === 0) {
      hasRefetchedForThisCycleRef.current = false;
    }

    // If we were loading and now we're done, refetch statistics
    // We don't check hasAchievements here because achievements might be in the database
    // even if they're not in the local map yet
    if (wasLoading && isNowDone && !hasRefetchedForThisCycleRef.current) {
      hasRefetchedForThisCycleRef.current = true;
      
      // Longer delay to ensure all database writes are complete
      // With hundreds of concurrent achievement syncs, database writes can queue up
      // and take several seconds to fully commit, even after API calls complete
      const timer = setTimeout(() => {
        fetch("/api/user/statistics")
          .then((res) => {
            if (res.ok) {
              return res.json();
            }
            return null;
          })
          .then((data) => {
            if (data?.statistics) {
              setStatistics(data.statistics);
            }
          })
          .catch(console.error);
      }, 5000); // 5 seconds to allow queued database writes to complete
      
      return () => clearTimeout(timer);
    }

    // Update the ref for next comparison
    previousLoadingSizeRef.current = currentLoadingSize;
  }, [loadingAchievements.size]);

  // Fetch friends list
  useEffect(() => {
    // Wait for user to be loaded first
    if (!user?.steamId) return;

    const steamId = user.steamId; // Capture steamId to avoid null check issues in async function

    async function loadFriends() {
      setIsLoadingFriends(true);
      try {
        const res = await fetch(`/api/user/${steamId}/friends`);
        if (res.ok) {
          const data = await res.json();
          const friendsList = data.friends || [];
          setFriends(friendsList);
        } else {
          console.error("Failed to fetch friends:", res.status);
        }
      } catch (error) {
        console.error("Error loading friends:", error);
      } finally {
        setIsLoadingFriends(false);
      }
    }
    
    loadFriends();
  }, [user?.steamId]);

  // Queue-based friend statistics loader with rate limiting and debouncing
  const processFriendStatsQueue = useCallback(async () => {
    if (friendStatsProcessingRef.current || friendStatsQueueRef.current.length === 0) {
      return;
    }

    friendStatsProcessingRef.current = true;

    // Process queue with limited concurrency
    while (friendStatsQueueRef.current.length > 0) {
      const batch: Array<{ steamId: string; lightweight: boolean }> = [];
      
      // Take up to MAX_CONCURRENT_REQUESTS from queue
      while (batch.length < MAX_CONCURRENT_REQUESTS && friendStatsQueueRef.current.length > 0) {
        const item = friendStatsQueueRef.current.shift();
        if (item) {
          // Skip if already loading
          const loadingKey = item.lightweight ? item.steamId : `${item.steamId}-full`;
          if (!friendsStatsLoadingRef.current.has(loadingKey)) {
            batch.push(item);
          }
        }
      }

      if (batch.length === 0) {
        break;
      }

      // Process batch concurrently
      const promises = batch.map(async (item) => {
        const loadingKey = item.lightweight ? item.steamId : `${item.steamId}-full`;
        
        // Mark as loading
        friendsStatsLoadingRef.current.add(loadingKey);
        setLoadingFriendStats((prev) => new Set(prev).add(item.steamId));

        try {
          const url = item.lightweight
            ? `/api/friends/${item.steamId}/statistics?lightweight=true&t=${Date.now()}`
            : `/api/friends/${item.steamId}/statistics?t=${Date.now()}`;
          
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            setFriends((prevFriends) =>
              prevFriends.map((f) =>
                f.steamId === item.steamId
                  ? {
                      ...f,
                      statistics: {
                        totalGames: data.statistics.totalGames || 0,
                        totalAchievements: data.statistics.totalAchievements || 0,
                        unlockedAchievements: data.statistics.unlockedAchievements || 0,
                        friendsCount: data.statistics.friendsCount || 0,
                      },
                      statsLoaded: item.lightweight ? true : f.statsLoaded,
                    }
                  : f
              )
            );

            // If lightweight, mark full stats as attempted so we can load them next
            if (item.lightweight) {
              // Don't mark as attempted yet - let the queue system handle it
            } else {
              friendsFullStatsAttemptedRef.current.add(item.steamId);
            }
          }
        } catch (error) {
          if (item.lightweight) {
            // Mark as loaded even on error to prevent retries
            setFriends((prevFriends) =>
              prevFriends.map((f) =>
                f.steamId === item.steamId ? { ...f, statsLoaded: true } : f
              )
            );
          }
          // For full stats, don't mark as error - keep existing stats
        } finally {
          friendsStatsLoadingRef.current.delete(loadingKey);
          setLoadingFriendStats((prev) => {
            const newSet = new Set(prev);
            newSet.delete(item.steamId);
            return newSet;
          });
        }
      });

      await Promise.all(promises);

      // Delay before next batch to avoid overwhelming the database
      if (friendStatsQueueRef.current.length > 0) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
      }
    }

    friendStatsProcessingRef.current = false;
  }, []);

  // Add requests to queue with debouncing
  const enqueueFriendStats = useCallback((steamId: string, lightweight: boolean) => {
    // Check if already in queue
    const alreadyQueued = friendStatsQueueRef.current.some(
      item => item.steamId === steamId && item.lightweight === lightweight
    );
    
    if (alreadyQueued) {
      return;
    }

    // Check if already loading
    const loadingKey = lightweight ? steamId : `${steamId}-full`;
    if (friendsStatsLoadingRef.current.has(loadingKey)) {
      return;
    }

    // Add to queue
    friendStatsQueueRef.current.push({ steamId, lightweight });

    // Debounce queue processing
    if (friendStatsDebounceTimerRef.current) {
      clearTimeout(friendStatsDebounceTimerRef.current);
    }

    friendStatsDebounceTimerRef.current = setTimeout(() => {
      processFriendStatsQueue();
    }, QUEUE_DEBOUNCE_MS);
  }, [processFriendStatsQueue]);

  // Viewport-based loading: Load statistics only for visible friends
  const handleFriendVisible = useCallback((steamId: string) => {
    const friend = friends.find((f) => f.steamId === steamId);
    if (!friend) return;

    // Step 1: Load lightweight stats (friends count only) if not loaded
    if (!friend.statsLoaded && !friendsStatsLoadingRef.current.has(steamId)) {
      enqueueFriendStats(steamId, true);
      return;
    }

    // Step 2: Load full stats (achievements) if lightweight stats are loaded but full stats not attempted
    if (
      friend.statsLoaded &&
      friend.statistics.friendsCount !== undefined &&
      !friendsFullStatsAttemptedRef.current.has(steamId) &&
      !friendsStatsLoadingRef.current.has(`${steamId}-full`)
    ) {
      enqueueFriendStats(steamId, false);
    }
  }, [friends, enqueueFriendStats]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (friendStatsDebounceTimerRef.current) {
        clearTimeout(friendStatsDebounceTimerRef.current);
      }
    };
  }, []);

  // Sort and filter games
  const sortedAndFilteredGames = useMemo(() => {
    const filtered = showUnplayed 
      ? allGames 
      : allGames.filter((game) => game.playtimeMinutes > 0);
    return sortGames(filtered, sortBy, gameAchievements);
  }, [allGames, sortBy, showUnplayed, gameAchievements]);

  // Limit games based on displayedGamesCount (infinite scroll)
  const gamesToDisplay = useMemo(() => {
    return sortedAndFilteredGames.slice(0, displayedGamesCount);
  }, [sortedAndFilteredGames, displayedGamesCount]);

  // Load achievements for newly displayed games when gamesToDisplay changes
  useEffect(() => {
    if (gamesToDisplay.length > 0) {
      const gamesNeedingAchievements = gamesToDisplay.filter(
        (game) => !gameAchievements.has(game.appId)
      );
      
      if (gamesNeedingAchievements.length > 0) {
        // Mark games as loading
        const appIdsToLoad = gamesNeedingAchievements.map((g) => g.appId);
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id: number) => newSet.add(id));
          return newSet;
        });

        const achievementPromises = gamesNeedingAchievements.map(async (game) => {
          try {
            const achRes = await fetch(`/api/achievements?appId=${game.appId}`);
            if (!achRes.ok) return { appId: game.appId, achievements: [] };
            const achData = await achRes.json();
            // Parse dates from strings if needed
            const parsedAchievements = (achData.achievements || []).map((ach: GameAchievement) => ({
              ...ach,
              unlockedAt: ach.unlockedAt ? (ach.unlockedAt instanceof Date ? ach.unlockedAt : new Date(ach.unlockedAt)) : undefined,
            }));
            return { appId: game.appId, achievements: parsedAchievements };
          } catch {
            return { appId: game.appId, achievements: [] };
          }
        });
        
        Promise.all(achievementPromises).then((achievementsData) => {
          setGameAchievements(prev => {
            const newMap = new Map(prev);
            achievementsData.forEach(({ appId, achievements }) => {
              newMap.set(appId, achievements);
            });
            return newMap;
          });
          
          // Remove from loading set
          setLoadingAchievements(prev => {
            const newSet = new Set(prev);
            appIdsToLoad.forEach((id: number) => newSet.delete(id));
            return newSet;
          });
        });
      }
    }
  }, [gamesToDisplay]); // Removed gameAchievements from deps to prevent flickering

  // Lazy-load achievements for all games when sorting by achievement progress
  useEffect(() => {
    if (sortBy === 'achievement-progress' && allGames.length > 0) {
      const needsLoading = allGames.some((game) => !gameAchievements.has(game.appId));
      
      if (needsLoading) {
        const gamesToLoad = allGames.filter((game) => !gameAchievements.has(game.appId));
        
        // Mark games as loading
        const appIdsToLoad = gamesToLoad.map((g) => g.appId);
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id: number) => newSet.add(id));
          return newSet;
        });
        
        const achievementPromises = gamesToLoad.map(async (game) => {
          try {
            const achRes = await fetch(`/api/achievements?appId=${game.appId}`);
            if (!achRes.ok) return { appId: game.appId, achievements: [] };
            const achData = await achRes.json();
            // Parse dates from strings if needed
            const parsedAchievements = (achData.achievements || []).map((ach: GameAchievement) => ({
              ...ach,
              unlockedAt: ach.unlockedAt ? (ach.unlockedAt instanceof Date ? ach.unlockedAt : new Date(ach.unlockedAt)) : undefined,
            }));
            return { appId: game.appId, achievements: parsedAchievements };
          } catch {
            return { appId: game.appId, achievements: [] };
          }
        });
        
        Promise.all(achievementPromises).then((achievementsData) => {
          const newMap = new Map(gameAchievements);
          achievementsData.forEach(({ appId, achievements }) => {
            newMap.set(appId, achievements);
          });
          setGameAchievements(newMap);
          
          // Remove from loading set
          setLoadingAchievements(prev => {
            const newSet = new Set(prev);
            appIdsToLoad.forEach((id: number) => newSet.delete(id));
            return newSet;
          });
        });
      }
    }
  }, [sortBy, allGames, gameAchievements]);

  // Save sortBy to sessionStorage when it changes
  useEffect(() => {
    sessionStorage.setItem('dashboard-sort-by', sortBy);
  }, [sortBy]);

  // Save showUnplayed to sessionStorage when it changes
  useEffect(() => {
    sessionStorage.setItem('dashboard-show-unplayed', String(showUnplayed));
  }, [showUnplayed]);

  // Sort and filter achievements - only show unlocked achievements
  const sortedAndFilteredAchievements = useMemo(() => {
    // Filter to only unlocked achievements
    const filtered = allAchievementsList.filter((a) => a.unlocked);
    return sortAchievements(filtered, achievementSortBy);
  }, [allAchievementsList, achievementSortBy]);

  // Limit displayed achievements
  const achievementsToDisplay = useMemo(() => {
    return sortedAndFilteredAchievements.slice(0, displayedAchievementsCount);
  }, [sortedAndFilteredAchievements, displayedAchievementsCount]);

  // Calculate rarity breakdown for achievements
  const rarityCounts = useMemo(() => {
    const counts = {
      legendary: 0,
      'very-rare': 0,
      rare: 0,
      uncommon: 0,
      common: 0,
    };
    
    if (allAchievementsList && allAchievementsList.length > 0) {
      allAchievementsList.forEach((ach) => {
        // Only count unlocked achievements
        if (ach.unlocked) {
          const rarity = calculateRarity(ach.achievement?.globalPercentage);
          counts[rarity]++;
        }
      });
    }
    
    return counts;
  }, [allAchievementsList]);

  const unlockedAchievementsCount = allAchievementsList?.filter((a) => a.unlocked).length || 0;

  // Detect current breakpoint to calculate columns per row
  const [columnsPerRow, setColumnsPerRow] = useState(2);
  
  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width >= 1280) {
        setColumnsPerRow(6); // xl
      } else if (width >= 1024) {
        setColumnsPerRow(5); // lg
      } else if (width >= 768) {
        setColumnsPerRow(4); // md
      } else if (width >= 640) {
        setColumnsPerRow(3); // sm
      } else {
        setColumnsPerRow(2); // default
      }
    };
    
    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  // Group achievements into rows based on current breakpoint
  const achievementRows = useMemo(() => {
    const rows: UserAchievement[][] = [];
    for (let i = 0; i < achievementsToDisplay.length; i += columnsPerRow) {
      rows.push(achievementsToDisplay.slice(i, i + columnsPerRow));
    }
    return rows;
  }, [achievementsToDisplay, columnsPerRow]);


  // Callback ref for achievement load more sentinel
  const achievementLoadMoreRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous observer
    if (achievementLoadMoreObserverRef.current) {
      achievementLoadMoreObserverRef.current.disconnect();
      achievementLoadMoreObserverRef.current = null;
    }

    if (node) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && displayedAchievementsCount < sortedAndFilteredAchievements.length) {
            setDisplayedAchievementsCount(prev => Math.min(prev + 30, sortedAndFilteredAchievements.length));
          }
        },
        { 
          rootMargin: '200px',
          threshold: 0.1
        }
      );
      
      observer.observe(node);
      achievementLoadMoreObserverRef.current = observer;
    }
  }, [displayedAchievementsCount, sortedAndFilteredAchievements.length]);

  // Reset displayed games count when sorting or filtering changes
  useEffect(() => {
    setDisplayedGamesCount(15);
  }, [sortBy, showUnplayed]);

  // Infinite scroll: Load more games when user scrolls near bottom
  const loadMoreGames = useCallback(async () => {
    if (isLoadingMore || isLoadingGames) return;
    
    const hasMore = displayedGamesCount < sortedAndFilteredGames.length;
    if (!hasMore) return;

    setIsLoadingMore(true);
    
    // Load next batch (15 more games)
    const nextBatchCount = displayedGamesCount + 15;
    setDisplayedGamesCount(nextBatchCount);
    
    // Fetch achievements for newly displayed games
    const newlyDisplayedGames = sortedAndFilteredGames.slice(displayedGamesCount, nextBatchCount);
    const gamesNeedingAchievements = newlyDisplayedGames.filter(
      (game) => !gameAchievements.has(game.appId)
    );

    if (gamesNeedingAchievements.length > 0) {
      // Mark games as loading
      const appIdsToLoad = gamesNeedingAchievements.map((g) => g.appId);
      setLoadingAchievements(prev => {
        const newSet = new Set(prev);
        appIdsToLoad.forEach((id: number) => newSet.add(id));
        return newSet;
      });

      const achievementPromises = gamesNeedingAchievements.map(async (game) => {
        try {
          const achRes = await fetch(`/api/achievements?appId=${game.appId}`);
          if (!achRes.ok) return { appId: game.appId, achievements: [] };
          const achData = await achRes.json();
          // Parse dates from strings if needed
          const parsedAchievements = (achData.achievements || []).map((ach: GameAchievement) => ({
            ...ach,
            unlockedAt: ach.unlockedAt ? (ach.unlockedAt instanceof Date ? ach.unlockedAt : new Date(ach.unlockedAt)) : undefined,
          }));
          return { appId: game.appId, achievements: parsedAchievements };
        } catch {
          return { appId: game.appId, achievements: [] };
        }
      });

      const achievementsData = await Promise.all(achievementPromises);
      const newMap = new Map(gameAchievements);
      achievementsData.forEach(({ appId, achievements }) => {
        newMap.set(appId, achievements);
      });
      setGameAchievements(newMap);
      
      // Remove from loading set
      setLoadingAchievements(prev => {
        const newSet = new Set(prev);
        appIdsToLoad.forEach((id: number) => newSet.delete(id));
        return newSet;
      });
    }

    setIsLoadingMore(false);
  }, [displayedGamesCount, sortedAndFilteredGames, gameAchievements, isLoadingMore, isLoadingGames]);

  // Intersection Observer for infinite scroll - use callback ref pattern
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous observer
    if (loadMoreObserverRef.current) {
      loadMoreObserverRef.current.disconnect();
      loadMoreObserverRef.current = null;
    }

    if (node) {
      const observer = new IntersectionObserver(
        (entries) => {
          const firstEntry = entries[0];
          if (firstEntry?.isIntersecting) {
            loadMoreGames();
          }
      },
        {
          rootMargin: '200px', // Start loading when 200px away from bottom
        }
      );
      
      observer.observe(node);
      loadMoreObserverRef.current = observer;
    }
  }, [loadMoreGames]);

  // Manual refresh handler
  const handleRefresh = () => {
    console.log('[Dashboard] Refresh button clicked');
    setIsLoadingGames(true);
    setDisplayedGamesCount(15); // Reset to initial batch
    
    // Clear achievement state to force fresh fetch
    setGameAchievements(new Map());
    setLoadingAchievements(new Set());
    loadedAchievementAppIds.current.clear(); // Clear loaded achievement refs
    
    // Reset friend stats so they reload with fresh data
    setFriends((prevFriends) =>
      prevFriends.map((f) => ({
        ...f,
        statsLoaded: false,
        statistics: {
          totalGames: 0,
          totalAchievements: 0,
          unlockedAchievements: 0,
          friendsCount: 0,
        },
      }))
    );
    
    // Clear loading refs and trigger progressive loading to re-run
    friendsStatsLoadingRef.current.clear();
    friendsFullStatsAttemptedRef.current.clear();
    setFriendsRefreshKey(prev => prev + 1);
    
    const refreshGames = async () => {
      try {
        const cacheBuster = `&t=${Date.now()}`;
        const refreshUrl = `/api/games?refresh=true${cacheBuster}`;
        console.log('[Dashboard] Fetching games with refresh:', refreshUrl);
        
        // Fetch games with cache-busting
        const gamesRes = await fetch(refreshUrl, {
          cache: 'no-store', // Bypass browser cache
        });
        console.log('[Dashboard] Games API response status:', gamesRes.status);
        if (!gamesRes.ok) {
          setIsLoadingGames(false);
          return;
        }
        
        const gamesData = await gamesRes.json();
        console.log('[Dashboard] Received games data:', {
          totalGames: gamesData.games?.length || 0,
          sampleGames: gamesData.games?.slice(0, 3).map((g: Game) => ({
            appId: g.appId,
            name: g.name,
            lastPlayed: g.lastPlayed,
            playtimeMinutes: g.playtimeMinutes,
          })),
        });
        setAllGames(gamesData.games);
        
        // Refresh statistics with cache-busting
        const statsRes = await fetch(`/api/user/statistics?force=true${cacheBuster}`, {
          cache: 'no-store',
        });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (statsData?.statistics) {
            setStatistics(statsData.statistics);
          }
        }
        
        // Refresh achievements for recently played games + full sync if needed
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        
        // Get recently played games (within last 14 days)
        // Convert string dates to Date objects if needed
        const recentlyPlayedGames = gamesData.games.filter((game: Game) => {
          if (!game.lastPlayed) return false;
          // Convert string to Date if needed
          const lastPlayedDate = game.lastPlayed instanceof Date 
            ? game.lastPlayed 
            : new Date(game.lastPlayed);
          // Check if date is valid and within 14 days
          return !isNaN(lastPlayedDate.getTime()) && lastPlayedDate > fourteenDaysAgo;
        });
        
        console.log(`[Dashboard] Recently played games (within 14 days): ${recentlyPlayedGames.length} out of ${gamesData.games.length} total games`);
        
        // Check if we need a full sync (user hasn't refreshed in >14 days)
        // Get steamId from user state or fetch user data
        const currentUser = user || (await fetch("/api/user").then(r => r.ok ? r.json() : null).then(d => d?.user || null));
        if (!currentUser?.steamId) {
          console.warn('[Dashboard] Cannot determine steamId for achievement sync');
          setIsLoadingGames(false);
          return;
        }
        
        // Use lastSyncAt from the fetched user data (already includes it from /api/user)
        const userLastSyncAt = currentUser.lastSyncAt ? new Date(currentUser.lastSyncAt) : null;
        const needsFullSync = !userLastSyncAt || userLastSyncAt < fourteenDaysAgo;
        
        // Determine which games to sync
        const gamesToSync = needsFullSync 
          ? gamesData.games // Full sync: all games
          : recentlyPlayedGames; // Partial sync: only recently played
        
        console.log(`[Dashboard] Syncing achievements: ${gamesToSync.length} games (${needsFullSync ? 'full sync' : 'recently played only'})`);
        
        const achievementPromises = gamesToSync.map(async (game: Game) => {
          try {
            const achRes = await fetch(`/api/achievements?appId=${game.appId}&refresh=true${cacheBuster}`, {
              cache: 'no-store',
            });
            if (!achRes.ok) return { appId: game.appId, achievements: [] };
            const achData = await achRes.json();
            // Parse dates from strings if needed
            const parsedAchievements = (achData.achievements || []).map((ach: GameAchievement) => ({
              ...ach,
              unlockedAt: ach.unlockedAt ? (ach.unlockedAt instanceof Date ? ach.unlockedAt : new Date(ach.unlockedAt)) : undefined,
            }));
            return { appId: game.appId, achievements: parsedAchievements };
          } catch {
            return { appId: game.appId, achievements: [] };
          }
        });
        
        const achievementsData = await Promise.all(achievementPromises);
        const achievementsMap = new Map<number, GameAchievement[]>();
        achievementsData.forEach(({ appId, achievements }) => {
          achievementsMap.set(appId, achievements);
        });
        setGameAchievements(achievementsMap);
        
        setIsLoadingGames(false);
      } catch (error) {
        console.error("Error refreshing games:", error);
        setIsLoadingGames(false);
      }
    };
    refreshGames();
  };


  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background pt-16">
      <Navbar />

      {/* Main Content */}
      <div className="p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          {/* User Profile Section */}
          <UserProfileHeader
            user={user}
            statistics={statistics}
            isLoadingStats={isLoadingStats}
          />

          {/* Tabs */}
          <TabGroup 
            className="mt-10"
            selectedIndex={selectedTabIndex}
            onChange={handleTabChange}
          >
            <TabList className="flex gap-1.5">
              <Tab className="px-3 py-1.5 text-sm rounded-full font-medium text-text-subdued data-[hover]:text-text-strong data-[hover]:bg-surface-low data-[selected]:bg-primary data-[selected]:text-text-inverted-strong transition-colors">
                Games
              </Tab>
              <Tab className="px-3 py-1.5 text-sm rounded-full font-medium text-text-subdued data-[hover]:text-text-strong data-[hover]:bg-surface-low data-[selected]:bg-primary data-[selected]:text-text-inverted-strong transition-colors">
                Achievements
              </Tab>
              <Tab className="px-3 py-1.5 text-sm rounded-full font-medium text-text-subdued data-[hover]:text-text-strong data-[hover]:bg-surface-low data-[selected]:bg-primary data-[selected]:text-text-inverted-strong transition-colors">
                Friends
              </Tab>
            </TabList>

            {/* Separator line between tabs and content */}
            <div className="border-b border-border-subdued mt-4"></div>

            <TabPanels>
              {/* Games Tab */}
              <TabPanel>
                {/* Filters, Sort Controls, and Games Grid */}
                <div className="flex flex-col gap-4 mt-4">
            {/* Filters and Sort Controls */}
            <GameSortingControls
              sortBy={sortBy}
              onSortChange={setSortBy}
              showUnplayed={showUnplayed}
              onShowUnplayedChange={setShowUnplayed}
              onRefresh={handleRefresh}
              isLoading={isLoadingGames}
            />

            {/* Games Grid */}
            {isLoadingGames ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-6">
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} className="h-[300px] bg-card rounded-md animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 md:gap-6">
                  {gamesToDisplay.map((game) => {
                    const achievements = gameAchievements.get(game.appId) || [];
                    const unlocked = achievements.filter((a) => a.unlocked);
                    const total = achievements.length;
                    
                    // Extract achievement icon data
                    const achievementIcons = achievements.map((a) => ({
                      iconUrl: a.achievement.iconUrl,
                      iconGrayUrl: a.achievement.iconGrayUrl,
                      unlocked: a.unlocked,
                    }));
                    
                    return (
                      <GameCard
                        key={game.appId}
                        appId={game.appId}
                        title={game.name}
                        hoursPlayed={game.playtimeMinutes / 60}
                        unlockedAchievements={unlocked.length}
                        totalAchievements={total}
                        coverImageUrl={game.coverImageUrl}
                        logoUrl={game.logoUrl}
                        iconUrl={game.iconUrl}
                        achievementIcons={achievementIcons}
                              isLoadingAchievements={loadingAchievements.has(game.appId) && achievements.length === 0}
                      />
                    );
                  })}
                </div>
                {/* Infinite scroll sentinel and loading indicator */}
                {displayedGamesCount < sortedAndFilteredGames.length && (
                  <div ref={loadMoreRef} className="mt-8 flex justify-center items-center py-4">
                    {isLoadingMore && (
                      <div className="text-text-subdued text-sm">Loading more games...</div>
                    )}
                  </div>
                )}
                {displayedGamesCount >= sortedAndFilteredGames.length && sortedAndFilteredGames.length > 0 && (
                  <div className="mt-8 text-center text-text-subdued text-sm">
                    All games loaded
                  </div>
                )}
              </>
            )}
                </div>
              </TabPanel>

              {/* Achievements Tab */}
              <TabPanel>
                <div className="flex flex-col gap-4 mt-4">
                  {/* Filters and Sort Controls */}
                  <AchievementSortingControls
                    sortBy={achievementSortBy}
                    onSortChange={setAchievementSortBy}
                  />

                  {/* Achievements Display */}
                  {isLoadingAllAchievements ? (
                    <div className="flex flex-col gap-4 mt-4">
                      {/* Breakdown skeleton */}
                      <div className="flex flex-col gap-4 px-4 md:px-8">
                        <div className="h-8 w-32 bg-surface-mid rounded animate-pulse" />
                        <div className="flex flex-wrap gap-6">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-6 w-24 bg-surface-mid rounded animate-pulse" />
                          ))}
                        </div>
                      </div>
                      
                      {/* Achievements grid skeleton */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 md:gap-x-6 lg:gap-x-10 gap-y-8 w-full px-4 md:px-8">
                        {Array.from({ length: 12 }).map((_, i) => (
                          <div key={i} className="w-16 h-16 bg-surface-mid rounded-full animate-pulse" />
                        ))}
                      </div>
                    </div>
                  ) : achievementsToDisplay.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg bg-surface-mid border border-border-strong">
                      <p className="text-text-moderate text-lg mb-2">No achievements found</p>
                      <p className="text-text-subdued text-sm text-center">
                        No unlocked achievements to display
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col justify-start items-center self-stretch px-4 md:px-8 py-6 md:py-6 rounded-lg bg-surface-low border border-border-weak">
                      {/* Achievement Breakdown */}
                      <AchievementBreakdown 
                        unlockedCount={unlockedAchievementsCount}
                        rarityCounts={rarityCounts}
                      />

                      <div className="flex flex-col gap-0 w-full">
                        {achievementRows.map((row, rowIndex) => (
                          <div key={rowIndex} className="flex flex-col items-center w-full">
                            <div className="grid pt-8 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 md:gap-x-6 lg:gap-x-10 w-full justify-items-center">
                              {row.map((achievement: any, index: number) => {
                                const rarity = calculateRarity(achievement.achievement?.globalPercentage);
                                const percentage = achievement.achievement?.globalPercentage ?? 0;
                                
                                return (
                                  <Trophy
                                    key={`trophy-${achievement.appId}-${achievement.achievement?.apiName}-${rowIndex}-${index}`}
                                    rarity={rarity}
                                    percentage={percentage}
                                    iconUrl={achievement.unlocked ? achievement.achievement?.iconUrl : achievement.achievement?.iconGrayUrl}
                                    name={achievement.achievement?.name || 'Unknown'}
                                    unlockedAt={achievement.unlockedAt ? new Date(achievement.unlockedAt) : undefined}
                                    unlocked={achievement.unlocked}
                                  />
                                );
                              })}
                            </div>
                            {/* Shelf - flush with trophies above */}
                            <div className="w-full h-2 bg-shelf-gradient border border-border-strong shadow-shelf dark:shadow-shelf-dark"></div>
                          </div>
                        ))}
                      </div>
                      
                      {/* Load more sentinel */}
                      {displayedAchievementsCount < sortedAndFilteredAchievements.length && (
                        <div 
                          ref={achievementLoadMoreRef} 
                          className="h-4 w-full mt-10" 
                          aria-hidden="true"
                          style={{ minHeight: '1px' }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </TabPanel>

              {/* Friends Tab */}
              <TabPanel>
                <FriendsList
                  friends={friends}
                  isLoading={isLoadingFriends}
                  loadingFriendStats={loadingFriendStats}
                  onFriendVisible={handleFriendVisible}
                />
              </TabPanel>
            </TabPanels>
          </TabGroup>
        </div>
      </div>
      <SyncLoadingModal isVisible={showSyncModal} />
    </div>
  );
}
