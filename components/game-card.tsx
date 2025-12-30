"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface GameCardProps {
  appId: number;
  title: string;
  hoursPlayed: number;
  unlockedAchievements: number;
  totalAchievements: number;
  coverImageUrl?: string;
  logoUrl?: string; // Fallback image
  achievementIcons?: Array<{ iconUrl: string; iconGrayUrl: string; unlocked: boolean }>;
}

export function GameCard({
  appId,
  title,
  hoursPlayed,
  unlockedAchievements,
  totalAchievements,
  coverImageUrl,
  logoUrl,
  achievementIcons = [],
}: GameCardProps) {
  const [imageError, setImageError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);
  const [skewX, setSkewX] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  
  // Debug: Log image errors
  const handleImageError = () => {
    console.warn(`Failed to load cover image for "${title}":`, coverImageUrl);
    setImageError(true);
  };
  
  const handleFallbackError = () => {
    console.warn(`Failed to load fallback logo for "${title}":`, logoUrl);
    setFallbackError(true);
  };

  // Mouse move handler for skew effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const centerX = rect.width / 2;
    const offsetX = (x - centerX) / centerX; // -1 to 1
    
    // Calculate skew: max 3 degrees, based on mouse position
    const maxSkew = 3;
    setSkewX(offsetX * maxSkew);
  };

  const handleMouseLeave = () => {
    setSkewX(0);
  };
  
  // Determine which image to show
  const showCoverImage = coverImageUrl && !imageError;
  const showLogo = !showCoverImage && logoUrl && !fallbackError;
  const showPlaceholder = !showCoverImage && !showLogo;
  const completionRate = totalAchievements > 0 
    ? Math.round((unlockedAchievements / totalAchievements) * 100)
    : 0;

  // Get first 5 unlocked achievements
  const unlocked = achievementIcons.filter(a => a.unlocked).slice(0, 5);
  const remainingUnlocked = unlockedAchievements - unlocked.length;
  
  // Fill remaining slots (always show 6 total)
  const displayIcons = [];
  for (let i = 0; i < 6; i++) {
    if (i < unlocked.length) {
      // Show unlocked achievement
      displayIcons.push(
        <img
          key={i}
          src={unlocked[i].iconUrl}
          alt=""
          className="flex-grow w-0 aspect-square object-cover"
        />
      );
    } else if (i === unlocked.length && remainingUnlocked > 0) {
      // Show "+X" indicator
      displayIcons.push(
        <div key={i} className="flex-grow w-0 aspect-square flex items-center justify-center bg-surface-transparent-mid">
          <p className="text-xs font-semibold text-center text-text-subdued">
            +{remainingUnlocked}
          </p>
        </div>
      );
    } else {
      // Show empty placeholder
      displayIcons.push(
        <div key={i} className="flex-grow w-0 aspect-square bg-surface-transparent-mid" />
      );
    }
  }

  return (
    <Link href={`/games/${appId}`} className="block">
      <div
        ref={cardRef}
        className="flex flex-col border border-border-strong justify-start items-start h-auto w-full gap-2.5 rounded-xl bg-card transition-all hover:scale-[1.02] hover:border-2 hover:shadow-sm"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Game Cover Image */}
        <div className="flex justify-start items-center self-stretch relative gap-2 px-2 pt-2">
          {showCoverImage ? (
            <img
              src={coverImageUrl}
              alt={title}
              className="flex-grow w-full h-auto rounded-md object-cover shadow-game-cover transition-transform duration-300 ease-out"
              style={{ transform: `skewX(${skewX}deg)` }}
              onError={handleImageError}
            />
          ) : showLogo ? (
            <img
              src={logoUrl}
              alt={title}
              className="flex-grow w-full h-auto rounded object-cover shadow-game-cover transition-transform duration-300 ease-out"
              style={{ transform: `skewX(${skewX}deg)` }}
              onError={handleFallbackError}
            />
          ) : (
            <div className="flex-grow w-full h-auto rounded object-cover shadow-game-cover bg-surface-mid flex items-center justify-center transition-transform duration-300 ease-out" style={{ aspectRatio: '460/215', transform: `skewX(${skewX}deg)` }}>
              <span className="text-text-subdued text-sm">Game Cover</span>
            </div>
          )}
        </div>

      {/* Game Info */}
      <div className="flex flex-col justify-start items-start self-stretch gap-3">
        {/* Title and Hours */}
        <div className="flex flex-col justify-start items-start self-stretch relative px-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-lg text-left font-semibold text-text-strong truncate w-full">
                  {title}
                </p>
              </TooltipTrigger>
              <TooltipContent>
                <p>{title}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <p className="text-sm text-left text-text-subdued">
            {hoursPlayed < 1 
              ? `${Math.round(hoursPlayed * 60)} mins played`
              : `${hoursPlayed.toFixed(1)} hrs played`
            }
          </p>
        </div>

        {/* Achievements Section */}
        <div className="flex flex-col justify-start items-start self-stretch gap-3 px-2 pt-2.5 pb-2 rounded-bl rounded-br bg-surface-transparent-mid">
          {/* Achievement Icons */}
          <div className="flex justify-start items-center self-stretch relative gap-2">
            {displayIcons}
          </div>

          {/* Achievement Progress */}
          <div className="flex flex-col justify-start items-start self-stretch gap-1.5">
            {/* Progress Text */}
            <div className="flex justify-center items-center self-stretch relative gap-2">
              <p className="flex-grow text-xs text-left text-text-subdued">
                <span className="text-xs font-bold text-left text-text-subdued">
                  {unlockedAchievements} of {totalAchievements}
                </span>
                <span className="text-xs text-left text-text-subdued"> achievements</span>
              </p>
              <p className="flex-shrink-0 text-xs font-bold text-center text-text-subdued">
                {completionRate}%
              </p>
            </div>

            {/* Progress Bar */}
            <div className="flex flex-col justify-start items-start self-stretch relative overflow-hidden gap-2 p-0.5 rounded-full bg-background">
              <div
                className="flex-shrink-0 h-[5px] rounded-tl-full rounded-bl-full transition-all bg-primary"
                style={{ 
                  width: `${completionRate}%`
                }}
              />
            </div>
          </div>
        </div>
      </div>
      </div>
    </Link>
  );
}
