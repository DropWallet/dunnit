"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { CircularProgress } from "@/components/ui/circular-progress";
import { AchievementCard } from "@/components/achievement-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useUserData } from "@/hooks/useUserData";

interface GameData {
  game: {
    appId: number;
    name: string;
    playtimeMinutes: number;
    iconUrl?: string;
    coverImageUrl?: string;
  };
  achievements: Array<{
    achievement: {
      name: string;
      description: string;
      iconUrl: string;
      globalPercentage?: number;
    };
    unlocked: boolean;
    unlockedAt?: Date;
  }>;
  heroImageUrl: string;
}

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const steamId = searchParams.get('steamId'); // Optional: for viewing friend's game
  const { user: friendUser } = useUserData(steamId || "", false);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>("rarity");
  const [hideLocked, setHideLocked] = useState(false);

  const loadGameData = useCallback(async () => {
    try {
      const appId = params.appId as string;
      const url = steamId 
        ? `/api/games/${appId}?steamId=${steamId}`
        : `/api/games/${appId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          router.push(steamId ? `/user/${steamId}` : "/dashboard");
          return;
        }
        throw new Error("Failed to load game");
      }

      const data = await response.json();
      
      // Parse dates from strings
      const parsedData: GameData = {
        ...data,
        achievements: data.achievements.map((ach: any) => ({
          ...ach,
          unlockedAt: ach.unlockedAt ? new Date(ach.unlockedAt) : undefined,
        })),
      };
      
      setGameData(parsedData);
    } catch (error) {
      console.error("Error loading game data:", error);
      router.push(steamId ? `/user/${steamId}` : "/dashboard");
    } finally {
      setIsLoading(false);
    }
  }, [params.appId, router, steamId]);

  useEffect(() => {
    if (params.appId) {
      loadGameData();
    }
  }, [params.appId, loadGameData]);

  // Sort and filter achievements (must be called before early returns)
  const sortedAndFilteredAchievements = useMemo(() => {
    if (!gameData) return [];
    
    let filtered = [...gameData.achievements];
    
    // Filter locked achievements if toggle is on
    if (hideLocked) {
      filtered = filtered.filter((a) => a.unlocked);
    }
    
    // Sort achievements
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "rarity": {
          // Sort by global percentage (rarest first - lowest %)
          const aPercent = a.achievement.globalPercentage ?? 100;
          const bPercent = b.achievement.globalPercentage ?? 100;
          if (aPercent !== bPercent) return aPercent - bPercent;
          // Fallback to name if same rarity
          return a.achievement.name.localeCompare(b.achievement.name);
        }
        case "unlock-date": {
          // Most recent first
          const aDate = a.unlockedAt?.getTime() ?? 0;
          const bDate = b.unlockedAt?.getTime() ?? 0;
          if (aDate !== bDate) return bDate - aDate;
          // Unlocked achievements first, then locked
          if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
          // Fallback to name
          return a.achievement.name.localeCompare(b.achievement.name);
        }
        case "name": {
          // Alphabetical A-Z
          return a.achievement.name.localeCompare(b.achievement.name);
        }
        case "unlocked-status": {
          // Unlocked first, then locked
          if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
          // Fallback to rarity if same status
          const aPercent = a.achievement.globalPercentage ?? 100;
          const bPercent = b.achievement.globalPercentage ?? 100;
          if (aPercent !== bPercent) return aPercent - bPercent;
          // Final fallback to name
          return a.achievement.name.localeCompare(b.achievement.name);
        }
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [gameData, sortBy, hideLocked]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-text-moderate">Loading...</div>
      </div>
    );
  }

  if (!gameData) {
    return null;
  }

  const { game, achievements, heroImageUrl } = gameData;
  const unlockedAchievements = achievements.filter((a) => a.unlocked).length;
  const totalAchievements = achievements.length;
  const completionRate = totalAchievements > 0
    ? (unlockedAchievements / totalAchievements) * 100
    : 0;
  const hoursPlayed = game.playtimeMinutes / 60;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero Block */}
      <div className="max-w-6xl mx-auto">
        {/* Breadcrumb Navigation */}
        <div className="p-4 md:p-8 pb-0">
          <Breadcrumb>
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
              {steamId && friendUser && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      href={`/user/${steamId}`}
                      onClick={(e) => {
                        e.preventDefault();
                        router.push(`/user/${steamId}`);
                      }}
                      className="cursor-pointer"
                    >
                      {friendUser.username}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </>
              )}
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{gameData?.game.name || "Game"}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 h-[448px] overflow-hidden gap-10 p-4 md:p-8">
          <div className="flex flex-col justify-end items-start self-stretch flex-grow-0 flex-shrink-0 h-96 relative overflow-hidden gap-2 p-2 md:p-3 rounded-xl border border-border-strong">
            {/* Background Hero Image */}
            <img
              src={heroImageUrl}
              alt={game.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
            
            {/* Content Overlay */}
            <div className="flex flex-col-reverse gap-3 relative z-10 w-full md:flex-row md:justify-between md:items-center md:self-stretch md:flex-grow-0 md:flex-shrink-0">
              {/* Game Info Card */}
              <div className="flex flex-col justify-start items-start self-stretch md:flex-grow-0 md:flex-shrink-0 relative overflow-hidden gap-2 px-4 py-2 rounded-lg bg-surface-transparent-high border border-border-inverted-moderate backdrop-blur-[10px]">
              <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 gap-2 min-w-0 w-full">
                  {/* Game Icon and Title */}
                  <div className="flex justify-start items-center flex-shrink min-w-0 w-full relative gap-4">
                    {game.iconUrl && (
                      <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-0.5 p-0.5 rounded-md border-2 border-border-strong">
                        <img
                          src={game.iconUrl}
                          alt=""
                          className="flex-grow-0 flex-shrink-0 w-8 h-8 rounded-sm object-cover"
                        />
                      </div>
                    )}
                    <p className="flex-shrink min-w-0 text-3xl md:text-4xl font-bold text-center text-text-inverted-strong truncate">
                      {game.name}
                    </p>
                  </div>
                  
                  {/* Stats Row */}
                  <div className="flex flex-col sm:flex-row justify-start items-start sm:items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-0.5 sm:gap-3">
                    <p className="flex-grow-0 flex-shrink-0 text-lg text-left">
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-black text-left text-text-inverted-strong">
                        {Math.round(completionRate)}%
                      </span>
                      <span className="flex-grow-0 flex-shrink-0 text-lg font-bold text-left text-text-inverted-subdued">
                        {" "}
                      </span>
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-bold text-left text-text-inverted-subdued">
                        completed
                      </span>
                    </p>
                    <div className="hidden sm:block flex-grow-0 flex-shrink-0 w-0.5 h-3 bg-inverted-subdued"></div>
                    <p className="flex-grow-0 flex-shrink-0 text-lg text-left">
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-black text-left text-text-inverted-strong">
                        {unlockedAchievements} of {totalAchievements}
                      </span>
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-bold text-left text-text-inverted-subdued">
                        {" "}
                      </span>
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-bold text-left text-text-inverted-subdued">
                        achievements
                      </span>
                    </p>
                    <div className="hidden sm:block flex-grow-0 flex-shrink-0 w-0.5 h-3 bg-inverted-subdued"></div>
                    <p className="flex-grow-0 flex-shrink-0 text-lg text-left">
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-black text-left text-text-inverted-strong">
                        {hoursPlayed < 1
                          ? `${Math.round(hoursPlayed * 60)} mins`
                          : `${hoursPlayed.toFixed(1)} hours`}
                      </span>
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-bold text-left text-text-inverted-strong">
                        {" "}
                      </span>
                      <span className="flex-grow-0 tracking-tight flex-shrink-0 text-lg font-bold text-left text-text-inverted-subdued">
                        played
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Circular Progress Chart */}
              <div className="flex justify-center items-center flex-grow-0 flex-shrink-0 w-24 h-24 relative rounded-lg bg-surface-transparent-high border border-border-inverted-moderate backdrop-blur-[20px]">
                <CircularProgress
                  percentage={completionRate}
                  size={80}
                  strokeWidth={8}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Achievements Section */}
        <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative overflow-hidden gap-5 px-4 md:px-8">
          <div className="flex flex-col gap-5 w-full">
            <p className="flex-grow-0 flex-shrink-0 text-3xl font-bold text-left text-text-strong">
              Achievements
            </p>
            
            {/* Filters and Sort Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              {/* Sort Dropdown */}
              <div className="flex items-center gap-2">
                <Select value={sortBy} onValueChange={setSortBy}>
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
                    <SelectItem value="unlocked-status" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                      Unlocked status
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Hide Locked Toggle */}
              <div className="flex items-center gap-2">
                <Switch
                  id="hide-locked"
                  checked={hideLocked}
                  onCheckedChange={(checked) => setHideLocked(checked === true)}
                />
                <Label
                  htmlFor="hide-locked"
                  className="text-sm text-text-strong cursor-pointer"
                >
                  Hide locked achievements
                </Label>
              </div>
            </div>

            {/* Achievements List */}
            <div className="flex flex-col justify-start items-start self-stretch gap-3">
              {sortedAndFilteredAchievements.map((userAchievement) => (
                <AchievementCard
                  key={userAchievement.achievement.name}
                  name={userAchievement.achievement.name}
                  description={userAchievement.achievement.description}
                  iconUrl={userAchievement.achievement.iconUrl}
                  unlockedAt={userAchievement.unlockedAt}
                  globalPercentage={userAchievement.achievement.globalPercentage}
                  unlocked={userAchievement.unlocked}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
