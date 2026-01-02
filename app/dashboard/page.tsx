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

          {/* Filters, Sort Controls, and Games Grid */}
          <div className="flex flex-col gap-5 mt-8">
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
        </div>
      </div>
    </div>
  );
}
