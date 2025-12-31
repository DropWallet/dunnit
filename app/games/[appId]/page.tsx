"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { CircularProgress } from "@/components/ui/circular-progress";
import { AchievementCard } from "@/components/achievement-card";

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
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadGameData = useCallback(async () => {
    try {
      const appId = params.appId as string;
      const response = await fetch(`/api/games/${appId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          router.push("/dashboard");
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
      router.push("/dashboard");
    } finally {
      setIsLoading(false);
    }
  }, [params.appId, router]);

  useEffect(() => {
    if (params.appId) {
      loadGameData();
    }
  }, [params.appId, loadGameData]);

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
        <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 h-[448px] overflow-hidden gap-10 p-4 md:p-8">
          <div className="flex flex-col justify-end items-start self-stretch flex-grow-0 flex-shrink-0 h-96 relative overflow-hidden gap-2 p-2 md:p-3 rounded-xl border border-border-strong">
            {/* Background Hero Image */}
            <img
              src={heroImageUrl}
              alt={game.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
            
            {/* Content Overlay */}
            <div className="flex flex-col-reverse gap-3 relative z-10 md:flex-row md:justify-between md:items-center md:self-stretch md:flex-grow-0 md:flex-shrink-0">
              {/* Game Info Card */}
              <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 relative overflow-hidden gap-2 px-4 py-2 rounded-lg bg-surface-transparent-high border border-border-inverted-moderate backdrop-blur-[10px]">
                <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 gap-2">
                  {/* Game Icon and Title */}
                  <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-4">
                    {game.iconUrl && (
                      <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-0.5 p-0.5 rounded-md border-2 border-border-strong">
                        <img
                          src={game.iconUrl}
                          alt=""
                          className="flex-grow-0 flex-shrink-0 w-8 h-8 rounded-sm object-cover"
                        />
                      </div>
                    )}
                    <p className="flex-grow-0 flex-shrink-0 text-4xl font-bold text-center text-text-inverted-strong">
                      {game.name}
                    </p>
                  </div>
                  
                  {/* Stats Row */}
                  <div className="flex flex-col sm:flex-row justify-start items-start sm:items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-1 sm:gap-3">
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
          <p className="flex-grow-0 flex-shrink-0 text-3xl font-bold text-center text-text-strong">
            Achievements
          </p>
          <div className="flex flex-col justify-start items-start self-stretch gap-3">
            {achievements
              .filter((a) => a.unlocked)
              .map((userAchievement) => (
                <AchievementCard
                  key={userAchievement.achievement.name}
                  name={userAchievement.achievement.name}
                  description={userAchievement.achievement.description}
                  iconUrl={userAchievement.achievement.iconUrl}
                  unlockedAt={userAchievement.unlockedAt}
                  globalPercentage={userAchievement.achievement.globalPercentage}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
