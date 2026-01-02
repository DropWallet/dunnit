"use client";

import { useState, useRef, useEffect } from "react";
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
  iconUrl?: string; // Additional fallback
  achievementIcons?: Array<{ iconUrl: string; iconGrayUrl: string; unlocked: boolean }>;
  isLoadingAchievements?: boolean;
}

export function GameCard({
  appId,
  title,
  hoursPlayed,
  unlockedAchievements,
  totalAchievements,
  coverImageUrl,
  logoUrl,
  iconUrl,
  achievementIcons = [],
  isLoadingAchievements = false,
}: GameCardProps) {
  const [imageError, setImageError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);
  const [iconError, setIconError] = useState(false);
  const [skewX, setSkewX] = useState(0);
  const [skewY, setSkewY] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  
  // Reset error states when image URLs change
  useEffect(() => {
    setImageError(false);
    setFallbackError(false);
    setIconError(false);
  }, [coverImageUrl, logoUrl, iconUrl]);
  
  // Debug: Log image errors
  const handleImageError = () => {
    console.warn(`Failed to load cover image for "${title}":`, coverImageUrl);
    setImageError(true);
  };
  
  const handleFallbackError = () => {
    console.warn(`Failed to load fallback logo for "${title}":`, logoUrl);
    setFallbackError(true);
  };
  
  const handleIconError = () => {
    console.warn(`Failed to load icon for "${title}":`, iconUrl);
    setIconError(true);
  };

  // Mouse move handler for skew effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const offsetX = (x - centerX) / centerX; // -1 to 1
    const offsetY = (y - centerY) / centerY; // -1 to 1
    
    // Calculate skew: max 3 degrees, based on mouse position
    const maxSkew = 3;
    setSkewX(offsetX * maxSkew);
    setSkewY(offsetY * maxSkew);
  };

  const handleMouseLeave = () => {
    setSkewX(0);
    setSkewY(0);
  };
  
  // Determine which image to show
  const showCoverImage = coverImageUrl && !imageError;
  const showLogo = !showCoverImage && logoUrl && !fallbackError;
  const showIcon = !showCoverImage && !showLogo && iconUrl && !iconError;
  const showPlaceholder = !showCoverImage && !showLogo && !showIcon;
  const completionRate = totalAchievements > 0 
    ? Math.round((unlockedAchievements / totalAchievements) * 100)
    : 0;
  
  // Debug logging for Ball x Pit (remove after fixing)
  useEffect(() => {
    if (title === "Ball x Pit") {
      console.log("Ball x Pit image state:", {
        coverImageUrl,
        logoUrl,
        iconUrl,
        imageError,
        fallbackError,
        iconError,
        showCoverImage,
        showLogo,
        showIcon,
        showPlaceholder,
      });
    }
  }, [title, coverImageUrl, logoUrl, iconUrl, imageError, fallbackError, iconError, showCoverImage, showLogo, showIcon, showPlaceholder]);

  // Get first 4 unlocked achievements (changed from 5)
  const unlocked = achievementIcons.filter(a => a.unlocked).slice(0, 4);
  const remainingUnlocked = unlockedAchievements - unlocked.length;
  
  // Fill remaining slots (always show 5 total, changed from 6)
  const displayIcons = [];
  for (let i = 0; i < 5; i++) {
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
        <div key={i} className="flex-grow w-0 aspect-square flex items-center justify-center bg-surface-low">
          <p className="text-[10px] sm:text-xs font-semibold text-center text-text-subdued">
            +{remainingUnlocked}
          </p>
        </div>
      );
    } else {
      // Show empty placeholder with achievement icon (new star icon)
      displayIcons.push(
        <div key={i} className="flex-grow w-0 aspect-square bg-surface-low flex items-center justify-center">
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            style={{ color: 'var(--color-surface-transparent-mid)' }}
          >
            <path d="M13.5098 3.139C12.8578 1.954 11.1418 1.954 10.4888 3.139C9.63009 4.69939 8.92221 6.33815 8.3748 8.033C8.34899 8.09931 8.30357 8.15618 8.24462 8.19602C8.18566 8.23586 8.11596 8.25678 8.0448 8.256C6.57777 8.29413 5.11551 8.43986 3.6698 8.692C2.3328 8.925 1.7438 10.529 2.7598 11.522C2.8878 11.6473 3.01714 11.772 3.1478 11.896C4.12662 12.8228 5.16301 13.6869 6.2508 14.483C6.30022 14.5158 6.33766 14.5638 6.3575 14.6197C6.37733 14.6756 6.37849 14.7364 6.3608 14.793C5.81164 16.4407 5.41924 18.1366 5.1888 19.858C4.9988 21.282 6.5068 22.156 7.6838 21.552C9.11268 20.8197 10.4789 19.9712 11.7688 19.015C11.8364 18.9672 11.9171 18.9416 11.9998 18.9416C12.0825 18.9416 12.1633 18.9672 12.2308 19.015C13.5199 19.9723 14.8863 20.8209 16.3158 21.552C17.4928 22.156 19.0008 21.282 18.8108 19.858C18.5807 18.1366 18.1886 16.4407 17.6398 14.793C17.6221 14.7364 17.6233 14.6756 17.6431 14.6197C17.6629 14.5638 17.7004 14.5158 17.7498 14.483C18.9823 13.5809 20.1486 12.5917 21.2398 11.523C22.2558 10.529 21.6668 8.925 20.3298 8.692C18.8838 8.43981 17.4212 8.29408 15.9538 8.256C15.8828 8.25658 15.8133 8.23556 15.7546 8.19573C15.6958 8.1559 15.6506 8.09915 15.6248 8.033C15.0791 6.3375 14.3702 4.69857 13.5098 3.139Z" fill="currentColor"/>
          </svg>
        </div>
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
              className="flex-grow w-full h-auto object-cover shadow-game-cover transition-transform duration-300 ease-out"
              style={{ transform: `skewX(${skewX}deg) skewY(${skewY}deg)` }}
              onError={handleImageError}
            />
          ) : showLogo ? (
            <img
              src={logoUrl}
              alt={title}
              className="flex-grow w-full h-auto rounded object-cover shadow-game-cover transition-transform duration-300 ease-out"
              style={{ transform: `skewX(${skewX}deg) skewY(${skewY}deg)` }}
              onError={handleFallbackError}
            />
          ) : showIcon ? (
            <img
              src={iconUrl}
              alt={title}
              className="flex-grow w-full h-auto rounded object-cover shadow-game-cover transition-transform duration-300 ease-out"
              style={{ transform: `skewX(${skewX}deg) skewY(${skewY}deg)` }}
              onError={handleIconError}
            />
          ) : (
            <div className="flex-grow w-full h-auto rounded object-cover shadow-game-cover bg-surface-mid flex items-center justify-center transition-transform duration-300 ease-out" style={{ aspectRatio: '460/215', transform: `skewX(${skewX}deg) skewY(${skewY}deg)` }}>
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
                <p className="text-md md:text-lg text-left font-semibold text-text-strong truncate w-full">
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
          <div className="flex justify-start items-center self-stretch relative gap-2 md:gap-3">
            {isLoadingAchievements ? (
              // Skeleton loading state - 5 placeholder squares with pulse animation
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-grow w-0 aspect-square bg-surface-low animate-pulse rounded"
                />
              ))
            ) : (
              displayIcons
            )}
          </div>

          {/* Achievement Progress */}
          <div className="flex flex-col justify-start items-start self-stretch gap-1.5">
            {isLoadingAchievements ? (
              // Skeleton for progress text and bar
              <>
                <div className="flex justify-center items-center self-stretch relative gap-2">
                  <div className="flex-grow h-4 bg-surface-low animate-pulse rounded" />
                  <div className="flex-shrink-0 w-12 h-4 bg-surface-low animate-pulse rounded" />
                </div>
                <div className="flex flex-col justify-start items-start self-stretch relative overflow-hidden gap-2 p-0.5 rounded-full bg-background">
                  <div className="flex-shrink-0 h-[5px] w-0 rounded-tl-full rounded-bl-full bg-surface-low animate-pulse" />
                </div>
              </>
            ) : (
              // Existing progress display
              <>
                {/* Progress Text */}
                <div className="flex justify-center items-center self-stretch relative gap-2">
                  <p className="flex-grow text-xs text-left text-text-subdued truncate">
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
              </>
            )}
          </div>
        </div>
      </div>
      </div>
    </Link>
  );
}
