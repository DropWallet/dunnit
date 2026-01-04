"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { getCountryFlag } from "@/lib/utils/country";
import { DotSeparator } from "@/components/dot-separator";
import { GameCard } from "@/components/game-card";
import { ArrowLeft } from "lucide-react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { Trophy } from "@/components/trophy";
import { calculateRarity } from "@/lib/utils/achievements";
import { useUserData } from "@/hooks/useUserData";
import { useUserStatistics } from "@/hooks/useUserStatistics";
import { useUserGames } from "@/hooks/useUserGames";
import { useUserAchievements } from "@/hooks/useUserAchievements";
import { useGameAchievements } from "@/hooks/useGameAchievements";
import { GameSortingControls } from "@/components/game-sorting-controls";
import { AchievementSortingControls } from "@/components/achievement-sorting-controls";
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

  // Use hooks for data fetching
  const { user, isLoading: isLoadingUser, error: userError } = useUserData(steamId, false);
  const { statistics, isLoading: isLoadingStats } = useUserStatistics(steamId);
  const { games: allGames, isLoading: isLoadingGames } = useUserGames(steamId);
  const { achievements: allAchievementsList, isLoading: isLoadingAllAchievements } = useUserAchievements(steamId);

  // Local state
  const [displayedGamesCount, setDisplayedGamesCount] = useState(15);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState<GameSortOption>("last-played");
  const [showUnplayed, setShowUnplayed] = useState<boolean>(true);
  const [gameAchievements, setGameAchievements] = useState<Map<number, GameAchievement[]>>(new Map());
  const [loadingAchievements, setLoadingAchievements] = useState<Set<number>>(new Set());
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Achievement tab state
  const [achievementSortBy, setAchievementSortBy] = useState<AchievementSortOption>("rarity");
  const [displayedAchievementsCount, setDisplayedAchievementsCount] = useState(30);
  const achievementLoadMoreObserverRef = useRef<IntersectionObserver | null>(null);

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

    // If sorting by achievement progress OR last-played, load achievements for ALL games
    // (last-played needs achievements to find latest unlock time as fallback)
    // Otherwise, load only for displayed games
    const needsAllGames = sortBy === 'achievement-progress' || sortBy === 'last-played';
    const gamesNeedingAchievements = needsAllGames
      ? allGames.filter((game) => !gameAchievements.has(game.appId))
      : gamesToDisplay.filter((game) => !gameAchievements.has(game.appId));

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
        
        setLoadingAchievements(prev => {
          const newSet = new Set(prev);
          appIdsToLoad.forEach((id) => newSet.delete(id));
          return newSet;
        });
      });
    }
  }, [allGames, gamesToDisplay, gameAchievements, steamId, sortBy]);

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
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          {/* Back Button */}
          <Button
            onClick={() => router.push("/dashboard")}
            variant="ghost"
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>

          {/* User Profile Section */}
          <div className="flex flex-col justify-start items-start gap-5 lg:flex-row lg:items-center lg:gap-10">
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="flex-shrink-0 w-40 h-40 rounded object-cover border border-border-strong"
            />
            
            <div className="flex flex-col justify-start items-start gap-5 w-full md:w-auto">
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
                    <p className="text-xs text-center text-text-subdued">Avg completion rate</p>
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
                              {row.map((achievement, index) => {
                                const rarity = calculateRarity(achievement.achievement?.globalPercentage);
                                const percentage = achievement.achievement?.globalPercentage ?? 0;
                                
                                return (
                                  <Trophy
                                    key={`${achievement.appId}-${achievement.achievement?.name}-${index}`}
                                    rarity={rarity}
                                    percentage={percentage}
                                    name={achievement.achievement?.name || "Unknown"}
                                    iconUrl={achievement.achievement?.iconUrl || ""}
                                    unlockedAt={achievement.unlockedAt}
                                  />
                                );
                              })}
                            </div>
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
            </TabPanels>
          </TabGroup>
        </div>
      </div>
    </div>
  );
}
