"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { GameCard } from "@/components/game-card";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { Trophy } from "@/components/trophy";
import { calculateRarity } from "@/lib/utils/achievements";
import { useUserData } from "@/hooks/useUserData";
import { useUserStatistics } from "@/hooks/useUserStatistics";
import { useUserGames } from "@/hooks/useUserGames";
import { useUserAchievements } from "@/hooks/useUserAchievements";
import { useUserFriends } from "@/hooks/useUserFriends";
import { useGameAchievements } from "@/hooks/useGameAchievements";
import { GameSortingControls } from "@/components/game-sorting-controls";
import { AchievementSortingControls } from "@/components/achievement-sorting-controls";
import { AchievementBreakdown } from "@/components/achievement-breakdown";
import { FriendsList } from "@/components/friends-list";
import { UserProfileHeader } from "@/components/user-profile-header";
import { PrivacyMessage } from "@/components/privacy-message";
import { detectPrivacyState } from "@/lib/utils/privacy";
import type { Game } from "@/lib/data/types";
import { 
  sortGames, 
  sortAchievements,
  type GameSortOption,
  type AchievementSortOption,
  type GameAchievement,
  type UserAchievement
} from "@/lib/utils/sorting";

export default function UserDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const steamId = params.steamId as string;

  // Track when user explicitly clicks Achievements tab (captured via onChange handler)
  const [achievementsTabClicked, setAchievementsTabClicked] = useState(false);

  // Track initial mount to prevent TabGroup onChange from triggering during initialization
  const isInitialMountRef = useRef(true);

  // Tab state - always start on games tab (index 0)
  const [selectedTabIndex, setSelectedTabIndex] = useState<number>(0);

  // Use hooks for data fetching
  const { user, isLoading: isLoadingUser, error: userError } = useUserData(steamId, false);
  const { statistics, isLoading: isLoadingStats, refetch: refetchStatistics } = useUserStatistics(steamId);
  const { games: allGames, isLoading: isLoadingGames } = useUserGames(steamId);
  // Lazy load achievements - only fetch when Achievements tab is explicitly clicked
  const shouldLoadAchievements = achievementsTabClicked && selectedTabIndex === 1;
  const { achievements: allAchievementsList, isLoading: isLoadingAllAchievements, refetch: refetchAchievements } = useUserAchievements(steamId, shouldLoadAchievements);
  const { friends: allFriends, isLoading: isLoadingFriends, error: friendsError } = useUserFriends(steamId);

  // Local state
  const [displayedGamesCount, setDisplayedGamesCount] = useState(15);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState<GameSortOption>("last-played");
  const [showUnplayed, setShowUnplayed] = useState<boolean>(true);
  const [gameAchievements, setGameAchievements] = useState<Map<number, GameAchievement[]>>(new Map());
  const [loadingAchievements, setLoadingAchievements] = useState<Set<number>>(new Set());
  /** Diagnostic: why achievements are empty per game (steam-403 = Steam says private, etc.) */
  const [achievementEmptyReasons, setAchievementEmptyReasons] = useState<Map<number, string>>(new Map());
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const previousLoadingSizeRef = useRef<number>(0);
  const hasRefetchedForThisCycleRef = useRef<boolean>(false);
  // Ref to track loaded achievement appIds to prevent re-fetching
  const loadedAchievementAppIds = useRef<Set<number>>(new Set());
  /** One-time full achievement sync on stale first load so stats reflect all games without scrolling */
  const hasTriggeredAllAchievementsSyncRef = useRef(false);
  const allAchievementsSyncTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Achievement tab state
  const [achievementSortBy, setAchievementSortBy] = useState<AchievementSortOption>("rarity");
  const [displayedAchievementsCount, setDisplayedAchievementsCount] = useState(30);
  const achievementLoadMoreObserverRef = useRef<IntersectionObserver | null>(null);

  // Friends tab state
  const [friends, setFriends] = useState<typeof allFriends>([]);
  const [loadingFriendStats, setLoadingFriendStats] = useState<Set<string>>(new Set());
  const friendsStatsLoadingRef = useRef<Set<string>>(new Set());

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

  // Save tab index to sessionStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(`user-dashboard-selected-tab-${steamId}`, selectedTabIndex.toString());
    }
  }, [selectedTabIndex, steamId]);

  // Handle tab changes - capture user intent directly via onChange event
  const handleTabChange = (index: number) => {
    setSelectedTabIndex(index);
    
    // Since we always start at index 0, any onChange means user clicked a tab
    // Set achievementsTabClicked when user clicks Achievements tab
    if (index === 1) {
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

  // Reset refs when steamId changes
  useEffect(() => {
    previousLoadingSizeRef.current = 0;
    hasRefetchedForThisCycleRef.current = false;
    loadedAchievementAppIds.current.clear();
    hasTriggeredAllAchievementsSyncRef.current = false;
    allAchievementsSyncTimeoutsRef.current.forEach(clearTimeout);
    allAchievementsSyncTimeoutsRef.current = [];
    setAchievementsTabClicked(false); // Reset achievements tab clicked state
    setAchievementEmptyReasons(new Map());
    isInitialMountRef.current = true; // Reset initial mount flag when steamId changes
  }, [steamId]);

  // Stale first load: prime achievement cache so stats reflect all games without scrolling
  useEffect(() => {
    if (allGames.length === 0 || isLoadingGames || hasTriggeredAllAchievementsSyncRef.current) return;
    hasTriggeredAllAchievementsSyncRef.current = true;
    allAchievementsSyncTimeoutsRef.current = [];
    fetch(`/api/user/${steamId}/achievements/all`)
      .then(() => {
        allAchievementsSyncTimeoutsRef.current.push(
          setTimeout(() => refetchStatistics().catch(console.error), 3000)
        );
        allAchievementsSyncTimeoutsRef.current.push(
          setTimeout(() => refetchStatistics().catch(console.error), 10000)
        );
      })
      .catch(console.error);
    return () => allAchievementsSyncTimeoutsRef.current.forEach(clearTimeout);
  }, [allGames.length, isLoadingGames, steamId, refetchStatistics]);

  // Compute unlocked achievements from game cards (Games tab)
  // This is needed because detectPrivacyState doesn't see gameAchievements directly
  const unlockedFromGameCards = useMemo(() => {
    let count = 0;
    gameAchievements.forEach((achievements) => {
      count += achievements.filter(a => a.unlocked).length;
    });
    return count;
  }, [gameAchievements]);

  // Detect privacy state - include both sources of achievement data
  const privacyState = detectPrivacyState(
    user,
    statistics,
    allGames,
    isLoadingUser,
    isLoadingGames,
    isLoadingStats,
    allAchievementsList.filter(a => a.unlocked).length + unlockedFromGameCards
  );

  // Sort and filter games
  const sortedAndFilteredGames = useMemo(() => {
    const filtered = showUnplayed ? allGames : allGames.filter((g) => g.playtimeMinutes > 0);
    return sortGames(filtered, sortBy, gameAchievements);
  }, [allGames, sortBy, showUnplayed, gameAchievements]);

  const gamesToDisplay = useMemo(() => {
    return sortedAndFilteredGames.slice(0, displayedGamesCount);
  }, [sortedAndFilteredGames, displayedGamesCount]);

  // Load achievements for displayed games
  useEffect(() => {
    if (allGames.length === 0) return;

    // Only load achievements for ALL games if sorting by achievement-progress
    // For last-played sorting, we use derivedLastPlayed from the database (no achievement fetch needed)
    // Games with missing lastPlayed will be sorted to the bottom using playtime fallback
    const needsAllGames = sortBy === 'achievement-progress';
    const targetGames = needsAllGames ? allGames : gamesToDisplay;
    
    // Use ref to check what's already loaded (prevents re-fetching)
    const gamesNeedingAchievements = targetGames.filter(
      (game) => !loadedAchievementAppIds.current.has(game.appId)
    );

    if (gamesNeedingAchievements.length > 0) {
      const appIdsToLoad = gamesNeedingAchievements.map((g) => g.appId);
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id) => newSet.add(id));
          return newSet;
        });

      const achievementPromises = gamesNeedingAchievements.map(async (game) => {
        try {
          const achRes = await fetch(`/api/achievements?appId=${game.appId}&steamId=${steamId}`);
          const achData = await achRes.json().catch(() => ({}));
          const achievements = achData.achievements ?? [];
          const emptyReason = achData.emptyReason as string | undefined;
          const parsedAchievements = (achievements || []).map((ach: GameAchievement) => ({
            ...ach,
            unlockedAt: ach.unlockedAt ? (ach.unlockedAt instanceof Date ? ach.unlockedAt : new Date(ach.unlockedAt)) : undefined,
          }));
          return {
            appId: game.appId,
            achievements: achRes.ok ? parsedAchievements : [],
            emptyReason: !achRes.ok || parsedAchievements.length === 0 ? emptyReason : undefined,
          };
        } catch {
          return { appId: game.appId, achievements: [], emptyReason: 'steam-error' as const };
        }
      });

      Promise.all(achievementPromises).then((achievementsData) => {
        const reasonsByCode = new Map<string, number[]>();
        achievementsData.forEach(({ appId, achievements, emptyReason }) => {
          if (emptyReason) {
            const list = reasonsByCode.get(emptyReason) ?? [];
            list.push(appId);
            reasonsByCode.set(emptyReason, list);
          }
        });
        if (reasonsByCode.size > 0) {
          const summary = Array.from(reasonsByCode.entries())
            .map(([reason, appIds]) => `${reason}: ${appIds.length} game(s) (e.g. appIds ${appIds.slice(0, 3).join(', ')})`)
            .join('; ');
          console.info(
            '[Achievements] Load diagnostic:',
            summary,
            '— steam-403 = Steam says game details private; steam-400 = no achievements; steam-5xx/steam-error = Steam/network issue.'
          );
        }

        setGameAchievements(prev => {
          const newMap = new Map(prev);
          achievementsData.forEach(({ appId, achievements }) => {
            newMap.set(appId, achievements);
            loadedAchievementAppIds.current.add(appId);
          });
          return newMap;
        });
        setAchievementEmptyReasons(prev => {
          const next = new Map(prev);
          achievementsData.forEach(({ appId, emptyReason }) => {
            if (emptyReason) next.set(appId, emptyReason);
          });
          return next;
        });

        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id) => newSet.delete(id));
          return newSet;
        });
      });
    }
  }, [allGames.length, gamesToDisplay, steamId, sortBy]); // Removed gameAchievements from deps to prevent flickering

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
        refetchStatistics().catch(console.error);
      }, 5000); // 5 seconds to allow queued database writes to complete
      
      return () => clearTimeout(timer);
    }

    // Update the ref for next comparison
    previousLoadingSizeRef.current = currentLoadingSize;
  }, [loadingAchievements.size]); // Only depend on loadingAchievements.size

  // Sort and filter achievements
  const sortedAndFilteredAchievements = useMemo(() => {
    const filtered = allAchievementsList.filter((a) => a.unlocked);
    return sortAchievements(filtered, achievementSortBy);
  }, [allAchievementsList, achievementSortBy]);

  const achievementsToDisplay = useMemo(() => {
    return sortedAndFilteredAchievements.slice(0, displayedAchievementsCount);
  }, [sortedAndFilteredAchievements, displayedAchievementsCount]);

  // Group achievements into rows
  const achievementRows = useMemo(() => {
    const rows: UserAchievement[][] = [];
    for (let i = 0; i < achievementsToDisplay.length; i += columnsPerRow) {
      rows.push(achievementsToDisplay.slice(i, i + columnsPerRow));
    }
    return rows;
  }, [achievementsToDisplay, columnsPerRow]);

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
  
  // Use statistics.unlockedAchievements to match the stats bar
  // This ensures consistency between the stats bar and achievement drawer
  const unlockedAchievementsCount = statistics?.unlockedAchievements || 0;

  // Infinite scroll for games
  const loadMoreGames = useCallback(async () => {
    if (isLoadingMore || isLoadingGames) return;
    
    const hasMore = displayedGamesCount < sortedAndFilteredGames.length;
    if (!hasMore) return;

    setIsLoadingMore(true);
    setDisplayedGamesCount(prev => prev + 15);
    setIsLoadingMore(false);
  }, [displayedGamesCount, sortedAndFilteredGames, isLoadingMore, isLoadingGames]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreGames();
        }
      },
      { rootMargin: '200px' }
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

  // Infinite scroll for achievements
  const achievementLoadMoreRef = useCallback((node: HTMLDivElement | null) => {
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
        { rootMargin: '200px', threshold: 0.1 }
      );
      
      observer.observe(node);
      achievementLoadMoreObserverRef.current = observer;
    }
  }, [displayedAchievementsCount, sortedAndFilteredAchievements.length]);

  // Update friends when fetched
  useEffect(() => {
    if (allFriends) {
      setFriends(allFriends);
    }
  }, [allFriends]);

  // Viewport-based loading: Load statistics only for visible friends
  // Only load when Friends tab is active (index 2)
  const handleFriendVisible = useCallback((steamId: string) => {
    // Only load if Friends tab is active
    if (selectedTabIndex !== 2) return;

    // Find the friend
    const friend = friends.find((f) => f.steamId === steamId);
    if (!friend) return;

    // Skip if already loaded or loading
    if (friend.statsLoaded || friendsStatsLoadingRef.current.has(steamId)) return;

    // Mark as loading
    friendsStatsLoadingRef.current.add(steamId);
    setLoadingFriendStats((prev) => new Set(prev).add(steamId));

    // Fetch statistics
    fetch(`/api/friends/${steamId}/statistics?t=${Date.now()}`)
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        return null;
      })
      .then((data) => {
        if (data && data.statistics) {
          setFriends((prevFriends) =>
            prevFriends.map((f) =>
              f.steamId === steamId
                ? {
                    ...f,
                    statistics: {
                      totalGames: data.statistics.totalGames || 0,
                      totalAchievements: data.statistics.totalAchievements || 0,
                      unlockedAchievements: data.statistics.unlockedAchievements || 0,
                      friendsCount: data.statistics.friendsCount || 0,
                    },
                    statsLoaded: true,
                  }
                : f
            )
          );
        } else {
          // Mark as loaded even if fetch failed (to avoid retrying)
          setFriends((prevFriends) =>
            prevFriends.map((f) =>
              f.steamId === steamId ? { ...f, statsLoaded: true } : f
            )
          );
        }
      })
      .catch(() => {
        // Mark as loaded even on error
        setFriends((prevFriends) =>
          prevFriends.map((f) =>
            f.steamId === steamId ? { ...f, statsLoaded: true } : f
          )
        );
      })
      .finally(() => {
        friendsStatsLoadingRef.current.delete(steamId);
        setLoadingFriendStats((prev) => {
          const newSet = new Set(prev);
          newSet.delete(steamId);
          return newSet;
        });
      });
  }, [friends, selectedTabIndex]);

  // Handle errors
  if (userError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-text-strong text-lg mb-4">Unable to load user profile</p>
          <p className="text-text-subdued mb-4">{userError.message}</p>
          <Button onClick={() => router.push("/dashboard")} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (isLoadingUser || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-16">
      <Navbar />

      <div className="p-4 md:px-8 md:py-5">
        <div className="max-w-6xl mx-auto">
          {/* Breadcrumb Navigation */}
          <Breadcrumb className="mb-4">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink 
                  href="/dashboard"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push("/dashboard");
                  }}
                  className="cursor-pointer"
                >
                  Dashboard
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{user?.username || "User"}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          {/* Privacy Message */}
          <PrivacyMessage 
            state={privacyState} 
            username={user?.username || 'User'} 
          />

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

            <div className="border-b border-border-subdued mt-4"></div>

            <TabPanels>
              {/* Games Tab */}
              <TabPanel>
                    <div className="flex flex-col gap-4 mt-4">
                      <GameSortingControls
                        sortBy={sortBy}
                        onSortChange={setSortBy}
                        showUnplayed={showUnplayed}
                        onShowUnplayedChange={setShowUnplayed}
                      />

                  {isLoadingGames ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-6">
                      {Array.from({ length: 15 }).map((_, i) => (
                        <div key={i} className="h-[300px] bg-card rounded-md animate-pulse" />
                      ))}
                    </div>
                  ) : gamesToDisplay.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg bg-surface-mid border border-border-strong">
                      <p className="text-text-moderate text-lg mb-2">No games found</p>
                      <p className="text-text-subdued text-sm text-center">
                        {showUnplayed ? "This user has no games" : "No played games to display"}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 md:gap-6">
                        {gamesToDisplay.map((game) => {
                          const achievements = gameAchievements.get(game.appId) || [];
                          const unlocked = achievements.filter((a) => a.unlocked);
                          const total = achievements.length;
                          
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
                              steamId={steamId}
                              achievementEmptyReason={achievementEmptyReasons.get(game.appId)}
                            />
                          );
                        })}
                      </div>
                      {displayedGamesCount < sortedAndFilteredGames.length && (
                        <div ref={loadMoreRef} className="mt-8 flex justify-center items-center py-4">
                          {isLoadingMore && (
                            <div className="text-text-subdued text-sm">Loading more games...</div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </TabPanel>

              {/* Achievements Tab */}
              <TabPanel>
                <div className="flex flex-col gap-4 mt-4">
                  <AchievementSortingControls
                    sortBy={achievementSortBy}
                    onSortChange={setAchievementSortBy}
                  />

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
                              {row.map((achievement, index) => {
                                const rarity = calculateRarity(achievement.achievement?.globalPercentage);
                                const percentage = achievement.achievement?.globalPercentage ?? 0;
                                
                                return (
                                  <Trophy
                                    key={`trophy-${achievement.appId}-${achievement.achievement?.apiName || achievement.achievement?.name}-${rowIndex}-${index}`}
                                    rarity={rarity}
                                    percentage={percentage}
                                    iconUrl={achievement.unlocked ? achievement.achievement?.iconUrl : (achievement.achievement?.iconGrayUrl || achievement.achievement?.iconUrl || "")}
                                    name={achievement.achievement?.name || "Unknown"}
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
                      {displayedAchievementsCount < sortedAndFilteredAchievements.length && (
                        <div ref={achievementLoadMoreRef} className="mt-8 h-4" />
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
    </div>
  );
}
