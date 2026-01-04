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
  const [gameAchievements, setGameAchievements] = useState<Map<number, any[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingGames, setIsLoadingGames] = useState(true);
  const [displayedGamesCount, setDisplayedGamesCount] = useState(15);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('dashboard-sort-by') || 'last-played';
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
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  // Achievement tab state
  const [achievementSortBy, setAchievementSortBy] = useState<string>("rarity");
  const [allAchievementsList, setAllAchievementsList] = useState<any[]>([]);
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
        const appIdsToLoad = gamesNeedingAchievements.map((g: any) => Number(g.appId));
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id: number) => newSet.add(id));
          return newSet;
        });
        
        const achievementPromises = gamesNeedingAchievements.map(async (game: any) => {
          try {
            const appIdNum = Number(game.appId);
            const achRes = await fetch(`/api/achievements?appId=${appIdNum}`);
            if (!achRes.ok) return { appId: appIdNum, achievements: [] };
            const achData = await achRes.json();
            return { appId: appIdNum, achievements: achData.achievements || [] };
          } catch {
            return { appId: Number(game.appId), achievements: [] };
          }
        });
        
        const achievementsData = await Promise.all(achievementPromises);
        const achievementsMap = new Map<number, any[]>();
        achievementsData.forEach(({ appId, achievements }) => {
          const appIdNum = Number(appId);
          achievementsMap.set(appIdNum, achievements);
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
    let filtered = [...allGames];
    
    // Filter unplayed games if needed
    if (!showUnplayed) {
      filtered = filtered.filter((game) => game.playtimeMinutes > 0);
    }
    
    // Sort games
    const sorted = [...filtered].sort((a: any, b: any) => {
      switch (sortBy) {
        case "last-played": {
          // Sort by lastPlayed (most recent first), then playtime2WeeksMinutes, then playtimeMinutes
          const aLastPlayed = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
          const bLastPlayed = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
          if (aLastPlayed !== bLastPlayed) return bLastPlayed - aLastPlayed;
          
          const aRecent = a.playtime2WeeksMinutes || 0;
          const bRecent = b.playtime2WeeksMinutes || 0;
          if (aRecent !== bRecent) return bRecent - aRecent;
          
          return (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0);
        }
        case "most-played": {
          return (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0);
        }
        case "least-played": {
          return (a.playtimeMinutes || 0) - (b.playtimeMinutes || 0);
        }
        case "recent-playtime": {
          const aRecent = a.playtime2WeeksMinutes || 0;
          const bRecent = b.playtime2WeeksMinutes || 0;
          if (aRecent !== bRecent) return bRecent - aRecent;
          return (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0);
        }
        case "name-asc": {
          return a.name.localeCompare(b.name);
        }
        case "name-desc": {
          return b.name.localeCompare(a.name);
        }
        case "achievement-progress": {
          const aAchievements = gameAchievements.get(Number(a.appId)) || [];
          const bAchievements = gameAchievements.get(Number(b.appId)) || [];
          const aUnlocked = aAchievements.filter((ach: any) => ach.unlocked).length;
          const bUnlocked = bAchievements.filter((ach: any) => ach.unlocked).length;
          const aTotal = aAchievements.length;
          const bTotal = bAchievements.length;
          const aProgress = aTotal > 0 ? (aUnlocked / aTotal) * 100 : 0;
          const bProgress = bTotal > 0 ? (bUnlocked / bTotal) * 100 : 0;
          if (aProgress !== bProgress) return bProgress - aProgress;
          // Fallback to total achievements
          return bTotal - aTotal;
        }
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [allGames, sortBy, showUnplayed, gameAchievements]);

  // Limit games based on displayedGamesCount (infinite scroll)
  const gamesToDisplay = useMemo(() => {
    return sortedAndFilteredGames.slice(0, displayedGamesCount);
  }, [sortedAndFilteredGames, displayedGamesCount]);

  // Load achievements for newly displayed games when gamesToDisplay changes
  useEffect(() => {
    if (gamesToDisplay.length > 0) {
      const gamesNeedingAchievements = gamesToDisplay.filter(
        (game: any) => !gameAchievements.has(Number(game.appId))
      );
      
      if (gamesNeedingAchievements.length > 0) {
        // Mark games as loading
        const appIdsToLoad = gamesNeedingAchievements.map((g: any) => Number(g.appId));
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id: number) => newSet.add(id));
          return newSet;
        });

        const achievementPromises = gamesNeedingAchievements.map(async (game: any) => {
          try {
            const appIdNum = Number(game.appId);
            const achRes = await fetch(`/api/achievements?appId=${appIdNum}`);
            if (!achRes.ok) return { appId: appIdNum, achievements: [] };
            const achData = await achRes.json();
            return { appId: appIdNum, achievements: achData.achievements || [] };
          } catch {
            return { appId: Number(game.appId), achievements: [] };
          }
        });
        
        Promise.all(achievementPromises).then((achievementsData) => {
          const newMap = new Map(gameAchievements);
          achievementsData.forEach(({ appId, achievements }) => {
            newMap.set(Number(appId), achievements);
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
      const needsLoading = allGames.some((game: any) => !gameAchievements.has(Number(game.appId)));
      
      if (needsLoading) {
        const gamesToLoad = allGames.filter((game: any) => !gameAchievements.has(Number(game.appId)));
        
        // Mark games as loading
        const appIdsToLoad = gamesToLoad.map((g: any) => Number(g.appId));
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id: number) => newSet.add(id));
          return newSet;
        });
        
        const achievementPromises = gamesToLoad.map(async (game: any) => {
          try {
            const appIdNum = Number(game.appId);
            const achRes = await fetch(`/api/achievements?appId=${appIdNum}`);
            if (!achRes.ok) return { appId: appIdNum, achievements: [] };
            const achData = await achRes.json();
            return { appId: appIdNum, achievements: achData.achievements || [] };
          } catch {
            return { appId: Number(game.appId), achievements: [] };
          }
        });
        
        Promise.all(achievementPromises).then((achievementsData) => {
          const newMap = new Map(gameAchievements);
          achievementsData.forEach(({ appId, achievements }) => {
            newMap.set(Number(appId), achievements);
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
    const filtered = allAchievementsList.filter((a: any) => a.unlocked);
    
    const sorted = [...filtered].sort((a: any, b: any) => {
      switch (achievementSortBy) {
        case "rarity": {
          const aPercent = a.achievement?.globalPercentage ?? 100;
          const bPercent = b.achievement?.globalPercentage ?? 100;
          if (aPercent !== bPercent) return aPercent - bPercent;
          return a.achievement?.name.localeCompare(b.achievement?.name) ?? 0;
        }
        case "unlock-date": {
          const aDate = a.unlockedAt ? new Date(a.unlockedAt).getTime() : 0;
          const bDate = b.unlockedAt ? new Date(b.unlockedAt).getTime() : 0;
          if (aDate !== bDate) return bDate - aDate;
          return a.achievement?.name.localeCompare(b.achievement?.name) ?? 0;
        }
        case "name": {
          return a.achievement?.name.localeCompare(b.achievement?.name) ?? 0;
        }
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [allAchievementsList, achievementSortBy]);

  // Limit displayed achievements
  const achievementsToDisplay = useMemo(() => {
    return sortedAndFilteredAchievements.slice(0, displayedAchievementsCount);
  }, [sortedAndFilteredAchievements, displayedAchievementsCount]);

  // Sort friends
  const sortedFriends = useMemo(() => {
    const sorted = [...friends].sort((a: Friend, b: Friend) => {
      switch (friendsSortBy) {
        case "achievements": {
          return (b.statistics.totalAchievements || 0) - (a.statistics.totalAchievements || 0);
        }
        case "name": {
          return a.username.localeCompare(b.username);
        }
        case "date-added": {
          // Since we don't have friendSince from Steam API, sort by joinDate as fallback
          const aDate = a.joinDate ? new Date(a.joinDate).getTime() : 0;
          const bDate = b.joinDate ? new Date(b.joinDate).getTime() : 0;
          return bDate - aDate;
        }
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [friends, friendsSortBy]);

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
    const rows: any[][] = [];
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
      (game: any) => !gameAchievements.has(Number(game.appId))
    );

    if (gamesNeedingAchievements.length > 0) {
      // Mark games as loading
      const appIdsToLoad = gamesNeedingAchievements.map(g => Number(g.appId));
      setLoadingAchievements(prev => {
        const newSet = new Set(prev);
        appIdsToLoad.forEach((id: number) => newSet.add(id));
        return newSet;
      });

      const achievementPromises = gamesNeedingAchievements.map(async (game: any) => {
        try {
          const appIdNum = Number(game.appId);
          const achRes = await fetch(`/api/achievements?appId=${appIdNum}`);
          if (!achRes.ok) return { appId: appIdNum, achievements: [] };
          const achData = await achRes.json();
          return { appId: appIdNum, achievements: achData.achievements || [] };
        } catch {
          return { appId: Number(game.appId), achievements: [] };
        }
      });

      const achievementsData = await Promise.all(achievementPromises);
      const newMap = new Map(gameAchievements);
      achievementsData.forEach(({ appId, achievements }) => {
        newMap.set(Number(appId), achievements);
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

  // Intersection Observer for infinite scroll
  useEffect(() => {
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

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
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
        const achievementPromises = gamesToDisplay.map(async (game: any) => {
          try {
            const appIdNum = Number(game.appId);
            const achRes = await fetch(`/api/achievements?appId=${appIdNum}&refresh=true`);
            if (!achRes.ok) return { appId: appIdNum, achievements: [] };
            const achData = await achRes.json();
            return { appId: appIdNum, achievements: achData.achievements || [] };
          } catch {
            return { appId: Number(game.appId), achievements: [] };
          }
        });
        
        const achievementsData = await Promise.all(achievementPromises);
        const achievementsMap = new Map<number, any[]>();
        achievementsData.forEach(({ appId, achievements }) => {
          achievementsMap.set(Number(appId), achievements);
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
          <div className="flex flex-col justify-start items-start gap-5 lg:flex-row lg:items-center lg:gap-10">
            {/* Avatar */}
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="flex-shrink-0 w-40 h-40 rounded object-cover border border-border-strong"
            />
            
            {/* User Info and Statistics */}
            <div className="flex flex-col justify-start items-start gap-5 w-full md:w-auto">
              {/* User Info */}
              <div className="flex flex-col justify-start items-start gap-1.5">
                <p className="text-3xl font-semibold text-center text-text-strong">
                  {user.username}
                </p>
                <div className="flex justify-center items-center gap-2">
                  {user.countryCode && (
                    <>
                      <span className="text-xs">{getCountryFlag(user.countryCode)}</span>
                      <p className="text-xs text-center text-text-subdued">
                        {user.countryName}
                      </p>
                      {user.joinDate && (
                        <>
                          <DotSeparator />
                          <p className="text-xs text-center text-text-subdued">
                            Joined {new Date(user.joinDate).toLocaleDateString('en-US', {
                              month: 'long',
                              year: 'numeric'
                            })}
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Statistics Section */}
              {isLoadingStats ? (
                <div className="flex justify-start items-center gap-3 p-2 rounded-lg bg-surface-mid border border-border-strong w-full">
                  <p className="text-text-moderate">Loading statistics...</p>
                </div>
              ) : statistics ? (
                <div className="grid grid-cols-2 gap-0.5 p-1 rounded-lg bg-surface-mid border border-border-strong w-full md:w-full md:flex md:justify-start md:items-center">
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                      {statistics.unlockedAchievements.toLocaleString()}
                    </p>
                    <p className="text-xs text-center text-text-subdued">Achievements</p>
                  </div>
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                      {statistics.averageCompletionRate}%
                    </p>
                    <p className="text-xs text-center text-text-subdued">
                      Avg completion rate
                    </p>
                  </div>
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                      {statistics.totalGames.toLocaleString()}
                    </p>
                    <p className="text-xs text-center text-text-subdued">Games</p>
                  </div>
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                      {statistics.startedGames.toLocaleString()}
                    </p>
                    <p className="text-xs text-center text-text-subdued">Started games</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

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
            <div className="flex flex-col sm:flex-row flex-col-reverse justify-between items-start sm:items-center gap-4">
              {/* Sort Dropdown */}
              <div className="flex items-center gap-2">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[200px] border-border-strong bg-surface-low text-text-strong">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent className="bg-surface-low border-border-strong">
                    <SelectItem value="last-played" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Date played
                    </SelectItem>
                    <SelectItem value="most-played" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Most played
                    </SelectItem>
                    <SelectItem value="least-played" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Least played
                    </SelectItem>
                    <SelectItem value="recent-playtime" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Recent playtime
                    </SelectItem>
                    <SelectItem value="name-asc" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Name (A-Z)
                    </SelectItem>
                    <SelectItem value="name-desc" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Name (Z-A)
                    </SelectItem>
                    <SelectItem value="achievement-progress" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Achievement progress
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Refresh Button and Show Unplayed Toggle */}
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleRefresh}
                        variant="outline"
                        size="sm"
                        className="w-9"
                        disabled={isLoadingGames}
                      >
                        <RefreshCw className="h-4 w-4" />
                        <span className="sr-only">Refresh games</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Refresh games</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Switch
                  id="show-unplayed"
                  checked={showUnplayed}
                  onCheckedChange={(checked) => setShowUnplayed(checked === true)}
                />
                <Label
                  htmlFor="show-unplayed"
                  className="text-sm text-text-strong cursor-pointer"
                >
                  Show unplayed games
                </Label>
              </div>
            </div>

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
                    const appIdNum = Number(game.appId);
                    const achievements = gameAchievements.get(appIdNum) || [];
                    const unlocked = achievements.filter((a: any) => a.unlocked);
                    const total = achievements.length;
                    
                    // Extract achievement icon data
                    const achievementIcons = achievements.map((a: any) => ({
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
                        isLoadingAchievements={loadingAchievements.has(appIdNum) && achievements.length === 0}
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
                  <div className="flex flex-col sm:flex-row flex-col-reverse justify-between items-start sm:items-center gap-4">
                    {/* Sort Dropdown */}
                    <div className="flex items-center gap-2">
                      <Select value={achievementSortBy} onValueChange={setAchievementSortBy}>
                        <SelectTrigger className="w-[200px] border-border-strong bg-surface-low text-text-strong">
                          <SelectValue placeholder="Sort by" />
                        </SelectTrigger>
                        <SelectContent className="bg-surface-low border-border-strong">
                          <SelectItem value="rarity" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                            Rarity
                          </SelectItem>
                          <SelectItem value="unlock-date" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                            Unlock date
                          </SelectItem>
                          <SelectItem value="name" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                            Name
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

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
                <div className="flex flex-col gap-4 mt-4">
                  {/* Sort Controls */}
                  <div className="flex flex-col sm:flex-row flex-col-reverse justify-between items-start sm:items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Select value={friendsSortBy} onValueChange={setFriendsSortBy}>
                        <SelectTrigger className="w-[200px] border-border-strong bg-surface-low text-text-strong">
                          <SelectValue placeholder="Sort by" />
                        </SelectTrigger>
                        <SelectContent className="bg-surface-low border-border-strong">
                          <SelectItem value="achievements" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                            Achievements (amount)
                          </SelectItem>
                          <SelectItem value="name" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                            Name (A-Z)
                          </SelectItem>
                          <SelectItem value="date-added" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                            Date added
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Friends List */}
                  {isLoadingFriends ? (
                    <div className="flex justify-center items-center py-12">
                      <p className="text-text-subdued">Loading friends...</p>
                    </div>
                  ) : sortedFriends.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg bg-surface-mid border border-border-strong">
                      <p className="text-text-moderate text-lg mb-2">No friends found</p>
                      <p className="text-text-subdued text-sm text-center">
                        You don't have any Steam friends yet
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {sortedFriends.map((friend: Friend) => {
                        const isLoadingStats = loadingFriendStats.has(friend.steamId);
                        const hasStats = friend.statsLoaded || (friend.statistics.totalGames > 0 || friend.statistics.totalAchievements > 0);

                        return (
                          <div
                            key={friend.steamId}
                            onClick={() => router.push(`/user/${friend.steamId}`)}
                            className="flex flex-col md:flex-col lg:flex-row justify-start items-start md:items-start lg:items-center gap-4 pl-3 pr-8 pt-3 pb-3 md:pb-3 rounded-lg bg-surface-low border border-border-weak cursor-pointer hover:bg-surface-mid transition-colors"
                          >
                            {/* Avatar and Name - SM: stacked, MD: horizontal, LG: horizontal */}
                            <div className="flex justify-start items-center self-stretch md:self-stretch lg:self-auto flex-grow relative gap-3">
                              <img
                                src={friend.avatarUrl}
                                alt={friend.username}
                                className="flex-grow-0 flex-shrink-0 w-14 h-14 rounded object-cover border border-border-strong"
                              />
                              <p className="flex-grow text-base font-bold text-left text-text-strong">
                                {friend.username}
                              </p>
                            </div>

                            {/* Stats and Country Wrapper - MD: flex-col, LG: flex-row */}
                            <div className="flex flex-col md:flex-col lg:flex-row self-stretch md:self-stretch lg:self-auto gap-3 md:gap-4 lg:gap-8">
                              {/* Stats - SM: stacked, MD: horizontal, LG: horizontal */}
                              <div className="flex flex-col md:flex-row lg:flex-row justify-start items-start md:items-start lg:items-center flex-grow-0 flex-shrink-0 gap-3 md:gap-8 lg:gap-8">
                              <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 relative gap-2">
                                <svg
                                  width="24"
                                  height="24"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="flex-grow-0 flex-shrink-0 w-6 h-6 relative"
                                  preserveAspectRatio="xMidYMid meet"
                                >
                                  <path
                                    d="M7 21V19H11V15.9C10.1833 15.7167 9.45433 15.371 8.813 14.863C8.17167 14.355 7.70067 13.7173 7.4 12.95C6.15 12.8 5.10433 12.2543 4.263 11.313C3.42167 10.3717 3.00067 9.26733 3 8V5H7V3H17V5H21V8C21 9.26667 20.579 10.371 19.737 11.313C18.895 12.255 17.8493 12.8007 16.6 12.95C16.3 13.7167 15.8293 14.3543 15.188 14.863C14.5467 15.3717 13.8173 15.7173 13 15.9V19H17V21H7ZM7 10.8V7H5V8C5 8.63333 5.18333 9.20433 5.55 9.713C5.91667 10.2217 6.4 10.584 7 10.8ZM12 14C12.8333 14 13.5417 13.7083 14.125 13.125C14.7083 12.5417 15 11.8333 15 11V5H9V11C9 11.8333 9.29167 12.5417 9.875 13.125C10.4583 13.7083 11.1667 14 12 14ZM17 10.8C17.6 10.5833 18.0833 10.2207 18.45 9.712C18.8167 9.20333 19 8.63267 19 8V7H17V10.8Z"
                                    fill="currentColor"
                                    className="text-text-weak"
                                  />
                                </svg>
                                <p className="flex-grow-0 flex-shrink-0 text-base font-bold text-center text-text-weak">
                                  {isLoadingStats ? (
                                    <span className="text-text-subdued">Loading...</span>
                                  ) : hasStats ? (
                                    `${friend.statistics.totalAchievements.toLocaleString()} Achievements`
                                  ) : (
                                    <span className="text-text-subdued">—</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 relative gap-2">
                                <svg
                                  width="24"
                                  height="24"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="flex-grow-0 flex-shrink-0 w-6 h-6 relative"
                                  preserveAspectRatio="xMidYMid meet"
                                >
                                  <path
                                    d="M12 3C12.2652 3 12.5196 3.10536 12.7071 3.29289C12.8946 3.48043 13 3.73478 13 4V5H14.5C16.4891 5 18.3968 5.79018 19.8033 7.1967C21.2098 8.60322 22 10.5109 22 12.5C22 14.4891 21.2098 16.3968 19.8033 17.8033C18.3968 19.2098 16.4891 20 14.5 20H9.5C7.51088 20 5.60322 19.2098 4.1967 17.8033C2.79018 16.3968 2 14.4891 2 12.5C2 10.5109 2.79018 8.60322 4.1967 7.1967C5.60322 5.79018 7.51088 5 9.5 5H11V4C11 3.73478 11.1054 3.48043 11.2929 3.29289C11.4804 3.10536 11.7348 3 12 3ZM14.5 7H9.5C8.04131 7 6.64236 7.57946 5.61091 8.61091C4.57946 9.64236 4 11.0413 4 12.5C4 13.9587 4.57946 15.3576 5.61091 16.3891C6.64236 17.4205 8.04131 18 9.5 18H14.5C15.9587 18 17.3576 17.4205 18.3891 16.3891C19.4205 15.3576 20 13.9587 20 12.5C20 11.0413 19.4205 9.64236 18.3891 8.61091C17.3576 7.57946 15.9587 7 14.5 7ZM15.5 10C15.7449 10 15.9813 10.09 16.1644 10.2527C16.3474 10.4155 16.4643 10.6397 16.493 10.883L16.5 11V11.5H17C17.2549 11.5003 17.5 11.5979 17.6854 11.7728C17.8707 11.9478 17.9822 12.187 17.9972 12.4414C18.0121 12.6958 17.9293 12.9464 17.7657 13.1418C17.6021 13.3373 17.3701 13.4629 17.117 13.493L17 13.5H16.5V14C16.4997 14.2549 16.4021 14.5 16.2272 14.6854C16.0522 14.8707 15.813 14.9822 15.5586 14.9972C15.3042 15.0121 15.0536 14.9293 14.8582 14.7657C14.6627 14.6021 14.5371 14.3701 14.507 14.117L14.5 14V13.5H14C13.7451 13.4997 13.5 13.4021 13.3146 13.2272C13.1293 13.0522 13.0178 12.813 13.0028 12.5586C12.9879 12.3042 13.0707 12.0536 13.2343 11.8582C13.3979 11.6627 13.6299 11.5371 13.883 11.507L14 11.5H14.5V11C14.5 10.7348 14.6054 10.4804 14.7929 10.2929C14.9804 10.1054 15.2348 10 15.5 10ZM8.5 10C9.16304 10 9.79893 10.2634 10.2678 10.7322C10.7366 11.2011 11 11.837 11 12.5C11 13.163 10.7366 13.7989 10.2678 14.2678C9.79893 14.7366 9.16304 15 8.5 15C7.83696 15 7.20107 14.7366 6.73223 14.2678C6.26339 13.7989 6 13.163 6 12.5C6 11.837 6.26339 11.2011 6.73223 10.7322C7.20107 10.2634 7.83696 10 8.5 10ZM8.5 12C8.36739 12 8.24021 12.0527 8.14645 12.1464C8.05268 12.2402 8 12.3674 8 12.5C8 12.6326 8.05268 12.7598 8.14645 12.8536C8.24021 12.9473 8.36739 13 8.5 13C8.63261 13 8.75979 12.9473 8.85355 12.8536C8.94732 12.7598 9 12.6326 9 12.5C9 12.3674 8.94732 12.2402 8.85355 12.1464C8.75979 12.0527 8.63261 12 8.5 12Z"
                                    fill="currentColor"
                                    className="text-text-weak"
                                  />
                                </svg>
                                <p className="flex-grow-0 flex-shrink-0 text-base font-bold text-center text-text-weak">
                                  {isLoadingStats ? (
                                    <span className="text-text-subdued">Loading...</span>
                                  ) : hasStats ? (
                                    `${friend.statistics.totalGames.toLocaleString()} Games`
                                  ) : (
                                    <span className="text-text-subdued">—</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
                                <svg
                                  width="24"
                                  height="24"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="flex-grow-0 flex-shrink-0 w-6 h-6 relative"
                                  preserveAspectRatio="xMidYMid meet"
                                >
                                  <path
                                    d="M7 17V18C7 18.2652 7.10536 18.5196 7.29289 18.7071C7.48043 18.8946 7.73478 19 8 19H16C16.2652 19 16.5196 18.8946 16.7071 18.7071C16.8946 18.5196 17 18.2652 17 18V17C17 16.2044 16.6839 15.4413 16.1213 14.8787C15.5587 14.3161 14.7956 14 14 14H10C9.20435 14 8.44129 14.3161 7.87868 14.8787C7.31607 15.4413 7 16.2044 7 17ZM15 8C15 8.79565 14.6839 9.55871 14.1213 10.1213C13.5587 10.6839 12.7956 11 12 11C11.2044 11 10.4413 10.6839 9.87868 10.1213C9.31607 9.55871 9 8.79565 9 8C9 7.20435 9.31607 6.44129 9.87868 5.87868C10.4413 5.31607 11.2044 5 12 5C12.7956 5 13.5587 5.31607 14.1213 5.87868C14.6839 6.44129 15 7.20435 15 8Z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className="text-text-weak"
                                  />
                                </svg>
                                <p className="flex-grow-0 flex-shrink-0 text-base font-bold text-center text-text-weak">
                                  {friend.statistics.friendsCount > 0 ? (
                                    `${friend.statistics.friendsCount} Friends`
                                  ) : (
                                    <span className="text-text-subdued">—</span>
                                  )}
                                </p>
                              </div>
                            </div>

                            {/* Country and Join Date - SM: bottom, MD: below stats, LG: hidden */}
                            <div className="flex items-center justify-start relative gap-2">
                              {friend.countryCode && (
                                <>
                                  {(() => {
                                    const flag = getCountryFlag(friend.countryCode);
                                    // Check if flag exists and is not empty
                                    if (flag && flag.trim().length > 0) {
                                      return <span className="text-lg">{flag}</span>;
                                    }
                                    // Show fallback when countryCode exists but no valid flag
                                    return (
                                      <div className="w-6 h-6 rounded bg-surface-transparent-mid border border-border-subtle flex-shrink-0" />
                                    );
                                  })()}
                                  <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued lg:hidden">
                                    {friend.countryName}
                                  </p>
                                  {friend.joinDate && (
                                    <>
                                      <div className="lg:hidden">
                                        <DotSeparator />
                                      </div>
                                      <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued lg:hidden">
                                        Joined {new Date(friend.joinDate).toLocaleDateString('en-US', {
                                          month: 'long',
                                          year: 'numeric'
                                        })}
                                      </p>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabPanel>
            </TabPanels>
          </TabGroup>
        </div>
      </div>
    </div>
  );
}
