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
import { FriendsList } from "@/components/friends-list";
import { UserProfileHeader } from "@/components/user-profile-header";
import type { Game } from "@/lib/data/types";
import { 
  sortGames, 
  sortAchievements,
  type GameSortOption,
  type AchievementSortOption,
  type GameAchievement,
  type UserAchievement
} from "@/lib/utils/sorting";

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
  statistics: {
    totalGames: number;
    totalAchievements: number;
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
  const [allGames, setAllGames] = useState<any[]>([]);
  const [loadingAchievements, setLoadingAchievements] = useState<Set<number>>(new Set());
  const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);
  
  // Achievement tab state
  const [achievementSortBy, setAchievementSortBy] = useState<AchievementSortOption>("rarity");
  const [allAchievementsList, setAllAchievementsList] = useState<UserAchievement[]>([]);
  const [displayedAchievementsCount, setDisplayedAchievementsCount] = useState(30);
  const [isLoadingAllAchievements, setIsLoadingAllAchievements] = useState(false);
  const achievementLoadMoreObserverRef = useRef<IntersectionObserver | null>(null);

  // Friends tab state
  const [friends, setFriends] = useState<Friend[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [friendsSortBy, setFriendsSortBy] = useState<string>("achievements");
  const [loadingFriendStats, setLoadingFriendStats] = useState<Set<string>>(new Set());
  const friendsStatsLoadingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
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

    // Fetch games and achievements
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
        const gamesNeedingAchievements = sortBy === 'achievement-progress' 
          ? gamesData.games 
          : initialBatch;
        
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
        const achievementsMap = new Map<number, GameAchievement[]>();
        achievementsData.forEach(({ appId, achievements }) => {
          achievementsMap.set(appId, achievements);
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
  }, [router, sortBy]);

  // Fetch all achievements for Achievements tab
  useEffect(() => {
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
  }, []);

  // Fetch friends list
  useEffect(() => {
    async function loadFriends() {
      setIsLoadingFriends(true);
      try {
        const res = await fetch("/api/friends");
        if (res.ok) {
          const data = await res.json();
          setFriends(data.friends || []);
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
  }, []);

  // Progressive loading: Load statistics for friends in batches
  useEffect(() => {
    if (friends.length === 0) return;

    // Find friends that need statistics loaded
    const friendsNeedingStats = friends.filter(
      (friend) => 
        !friend.statsLoaded &&
        !friendsStatsLoadingRef.current.has(friend.steamId)
    );

    if (friendsNeedingStats.length === 0) return;

    // Load stats in batches of 5
    const batchSize = 5;
    const batches: Friend[][] = [];
    for (let i = 0; i < friendsNeedingStats.length; i += batchSize) {
      batches.push(friendsNeedingStats.slice(i, i + batchSize));
    }

    // Process batches with a delay between them
    const timeouts: NodeJS.Timeout[] = [];
    batches.forEach((batch, batchIndex) => {
      const timeout = setTimeout(() => {
        batch.forEach(async (friend) => {
          // Skip if already loading
          if (friendsStatsLoadingRef.current.has(friend.steamId)) return;
          
          // Mark as loading in ref and state
          friendsStatsLoadingRef.current.add(friend.steamId);
          setLoadingFriendStats((prev) => new Set(prev).add(friend.steamId));

          try {
            const res = await fetch(`/api/friends/${friend.steamId}/statistics?t=${Date.now()}`);
            if (res.ok) {
              const data = await res.json();
              // Update friend with statistics
              setFriends((prevFriends) =>
                prevFriends.map((f) =>
                  f.steamId === friend.steamId
                    ? {
                        ...f,
                        statistics: data.statistics,
                        statsLoaded: true,
                      }
                    : f
                )
              );
            }
          } catch (error) {
            console.error(`Error loading stats for friend ${friend.steamId}:`, error);
            // Mark as loaded even on error to prevent retries
            setFriends((prevFriends) =>
              prevFriends.map((f) =>
                f.steamId === friend.steamId
                  ? { ...f, statsLoaded: true }
                  : f
              )
            );
          } finally {
            friendsStatsLoadingRef.current.delete(friend.steamId);
            setLoadingFriendStats((prev) => {
              const newSet = new Set(prev);
              newSet.delete(friend.steamId);
              return newSet;
            });
          }
        });
      }, batchIndex * 500); // 500ms delay between batches
      timeouts.push(timeout);
    });

    // Cleanup timeouts on unmount or when friends change
    return () => {
      timeouts.forEach((timeout) => clearTimeout(timeout));
    };
  }, [friends.length]); // Only depend on length to avoid re-running when stats update

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
  }, [gamesToDisplay, gameAchievements]);

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
    setIsLoadingGames(true);
    setDisplayedGamesCount(15); // Reset to initial batch
    const refreshGames = async () => {
      try {
        const gamesRes = await fetch("/api/games?refresh=true");
        if (!gamesRes.ok) {
          setIsLoadingGames(false);
          return;
        }
        
        const gamesData = await gamesRes.json();
        setAllGames(gamesData.games);
        
        // Refresh achievements for displayed games only
        const gamesToDisplay = gamesData.games.slice(0, displayedGamesCount);
        const achievementPromises = gamesToDisplay.map(async (game: Game) => {
          try {
            const achRes = await fetch(`/api/achievements?appId=${game.appId}&refresh=true`);
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
    <div className="min-h-screen bg-background">
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
          <TabGroup className="mt-10">
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
                    <div className="flex justify-center items-center py-12">
                      <p className="text-text-subdued">Loading achievements...</p>
                    </div>
                  ) : achievementsToDisplay.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg bg-surface-mid border border-border-strong">
                      <p className="text-text-moderate text-lg mb-2">No achievements found</p>
                      <p className="text-text-subdued text-sm text-center">
                        No unlocked achievements to display
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col justify-start items-center self-stretch px-4 md:px-8 py-8 md:py-4 rounded-lg bg-surface-low border border-border-weak">
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
                  sortBy={friendsSortBy}
                  onSortChange={setFriendsSortBy}
                  loadingFriendStats={loadingFriendStats}
                />
              </TabPanel>
            </TabPanels>
          </TabGroup>
        </div>
      </div>
    </div>
  );
}
