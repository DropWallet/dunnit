"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { getCountryFlag } from "@/lib/utils/country";
import { DotSeparator } from "@/components/dot-separator";
import { GameCard } from "@/components/game-card";

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
  const [games, setGames] = useState<any[]>([]);
  const [gameAchievements, setGameAchievements] = useState<Map<number, any[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingGames, setIsLoadingGames] = useState(true);
  const [showAllGames, setShowAllGames] = useState(false);

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
        
        // Sort by lastPlayed (most recent first), then playtime2WeeksMinutes, then playtimeMinutes
        const sortedGames = gamesData.games.sort((a: any, b: any) => {
          // First, sort by lastPlayed date (most recent first)
          const aLastPlayed = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
          const bLastPlayed = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
          if (aLastPlayed !== bLastPlayed) return bLastPlayed - aLastPlayed;
          
          // Fallback to recent playtime (last 2 weeks)
          const aRecent = a.playtime2WeeksMinutes || 0;
          const bRecent = b.playtime2WeeksMinutes || 0;
          if (aRecent !== bRecent) return bRecent - aRecent;
          
          // Final fallback to total playtime
          return (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0);
        });
        
        const gamesToLoad = showAllGames ? sortedGames : sortedGames.slice(0, 15);
        setGames(gamesToLoad);
        
        // Fetch achievements for games in parallel
        const achievementPromises = gamesToLoad.map(async (game: any) => {
          try {
            const achRes = await fetch(`/api/achievements?appId=${game.appId}`);
            if (!achRes.ok) return { appId: game.appId, achievements: [] };
            const achData = await achRes.json();
            return { appId: game.appId, achievements: achData.achievements || [] };
          } catch {
            return { appId: game.appId, achievements: [] };
          }
        });
        
        const achievementsData = await Promise.all(achievementPromises);
        const achievementsMap = new Map();
        achievementsData.forEach(({ appId, achievements }) => {
          achievementsMap.set(appId, achievements);
        });
        setGameAchievements(achievementsMap);
        setIsLoadingGames(false);
      } catch (error) {
        console.error("Error loading games:", error);
        setIsLoadingGames(false);
      }
    }
    
    loadGames();
  }, [router, showAllGames]);


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
                <div className="grid grid-cols-2 gap-3 p-1 rounded-lg bg-surface-mid border border-border-strong w-full md:w-full md:flex md:justify-start md:items-center">
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-2xl font-semibold text-center text-text-moderate">
                      {statistics.unlockedAchievements.toLocaleString()}
                    </p>
                    <p className="text-xs text-center text-text-subdued">Achievements</p>
                  </div>
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-2xl font-semibold text-center text-text-moderate">
                      {statistics.averageCompletionRate}%
                    </p>
                    <p className="text-xs text-center text-text-subdued">
                      Avg completion rate
                    </p>
                  </div>
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-2xl font-semibold text-center text-text-moderate">
                      {statistics.totalGames.toLocaleString()}
                    </p>
                    <p className="text-xs text-center text-text-subdued">Games</p>
                  </div>
                  <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                    <p className="text-2xl font-semibold text-center text-text-moderate">
                      {statistics.startedGames.toLocaleString()}
                    </p>
                    <p className="text-xs text-center text-text-subdued">Started games</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Games Grid */}
          {isLoadingGames ? (
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 mt-8">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="h-[583px] bg-card rounded-md animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 md:gap-6 mt-8">
                {games.map((game) => {
                  const achievements = gameAchievements.get(game.appId) || [];
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
                    />
                  );
                })}
              </div>
              {!showAllGames && games.length >= 15 && (
                <div className="mt-8 text-center">
                  <Button onClick={() => setShowAllGames(true)} variant="outline">
                    View All Games
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
