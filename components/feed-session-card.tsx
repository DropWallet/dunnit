"use client";

import { useState } from "react";
import type React from "react";
import Link from "next/link";
import { type FeedSession } from "@/lib/utils/feed-sessions";
import { getRarityBorderClass } from "@/lib/utils/achievements";
import { FeedLikeButton } from "@/components/feed-like-button";

/**
 * Skeleton loading state for FeedSessionCard
 */
export function FeedSessionCardSkeleton() {
  return (
    <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 w-full gap-4 px-4 pt-4 pb-3 sm:p-5 sm:pb-3 rounded-lg bg-surface-low border border-border-weak">
      {/* User Header Skeleton */}
      <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 w-full relative gap-3 sm:gap-4">
        <div className="flex-grow-0 flex-shrink-0 w-10 h-10 rounded-full bg-surface-mid animate-pulse" />
        <div className="flex flex-col justify-start items-start flex-grow relative gap-2">
          <div className="h-4 w-32 bg-surface-mid animate-pulse rounded" />
          <div className="h-3 w-24 bg-surface-mid animate-pulse rounded" />
        </div>
      </div>

      {/* Mobile Layout Skeleton */}
      <div className="flex md:hidden flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-4 rounded">
        {/* Game Image Skeleton */}
        <div className="self-stretch h-[156px] bg-surface-mid animate-pulse rounded" />

        {/* Content Section Skeleton */}
        <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-4">
          {/* Badge and Label Skeleton */}
          <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-3">
            <div className="w-10 h-[35px] bg-surface-mid animate-pulse rounded" />
            <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 relative gap-2">
              <div className="h-6 w-48 bg-surface-mid animate-pulse rounded" />
              <div className="h-4 w-32 bg-surface-mid animate-pulse rounded" />
            </div>
          </div>

          {/* Session Details Skeleton */}
          <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-2">
            <div className="h-5 w-40 bg-surface-mid animate-pulse rounded" />
            <div className="h-5 w-32 bg-surface-mid animate-pulse rounded" />
          </div>

          {/* Achievement Icons Skeleton */}
          <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 w-10 bg-surface-mid animate-pulse rounded border border-border-weak" />
            ))}
          </div>

          {/* Progress Bar Skeleton */}
          <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-3 px-3 pt-2.5 pb-2 rounded bg-surface-transparent-mid">
            <div className="flex justify-center items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-2">
              <div className="flex-grow h-3 bg-surface-mid animate-pulse rounded" />
              <div className="flex-shrink-0 w-12 h-3 bg-surface-mid animate-pulse rounded" />
            </div>
            <div className="self-stretch h-[5px] bg-surface-mid animate-pulse rounded-full" />
          </div>
        </div>
      </div>

      {/* Desktop Layout Skeleton */}
      <div className="hidden md:flex justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-8 p-4 rounded bg-surface-mid">
        {/* Content Section Skeleton - Left */}
        <div className="flex flex-col justify-start items-start flex-grow gap-4">
          {/* Badge and Label Skeleton */}
          <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-3">
            <div className="w-10 h-[35px] bg-surface-low animate-pulse rounded" />
            <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 relative gap-2">
              <div className="h-6 w-48 bg-surface-low animate-pulse rounded" />
              <div className="h-4 w-32 bg-surface-low animate-pulse rounded" />
            </div>
          </div>

          {/* Session Details Skeleton */}
          <div className="flex flex-row justify-start items-start flex-grow-0 flex-shrink-0 gap-3">
            <div className="h-5 w-40 bg-surface-low animate-pulse rounded" />
            <div className="h-5 w-32 bg-surface-low animate-pulse rounded" />
          </div>

          {/* Achievement Icons Skeleton */}
          <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 w-12 bg-surface-low animate-pulse rounded border border-border-weak" />
            ))}
          </div>

          {/* Progress Bar Skeleton */}
          <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-3 pt-1 pb-2 rounded-md bg-surface-mid">
            <div className="flex justify-center items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-2">
              <div className="flex-grow h-3 bg-surface-low animate-pulse rounded" />
              <div className="flex-shrink-0 w-12 h-3 bg-surface-low animate-pulse rounded" />
            </div>
            <div className="self-stretch h-[5px] bg-surface-low animate-pulse rounded-full" />
          </div>
        </div>

        {/* Game Image Skeleton - Right */}
        <div className="h-64 w-[98px] bg-surface-low animate-pulse rounded-md" />
      </div>

      {/* Like Button Area Skeleton */}
      <div className="h-8 w-20 bg-surface-mid animate-pulse rounded" />
    </div>
  );
}

interface FeedSessionCardProps {
  session: FeedSession;
  // Total achievements in the game (for progress bar)
  totalGameAchievements: number;
  // Unlocked achievements in the game (for progress bar)
  unlockedGameAchievements: number;
}

export function FeedSessionCard({ 
  session,
  totalGameAchievements,
  unlockedGameAchievements,
}: FeedSessionCardProps) {
  // Calculate completion rate for progress bar
  const completionRate = totalGameAchievements > 0 
    ? Math.round((unlockedGameAchievements / totalGameAchievements) * 100)
    : 0;

  // Badge color - will be swapped for custom badges later
  const badgeColor = '#00BBA7'; // Placeholder teal color

  // Show all achievements from the session (up to 5 visible)
  const displayAchievements = session.achievements.slice(0, 5);
  const remainingCount = session.achievements.length - displayAchievements.length;
  const hasAchievements = session.achievements.length > 0;
  const isPlaytimeOnly = session.achievementCount === 0;

  // State for image fallbacks
  const [desktopImageError, setDesktopImageError] = useState(false);
  const [storeApiCapsuleUrl, setStoreApiCapsuleUrl] = useState<string | null>(null);
  const [isFetchingStoreImage, setIsFetchingStoreImage] = useState(false);
  const [fallbackToHeader, setFallbackToHeader] = useState(false);

  // Determine which image to use
  // Mobile: use coverImageUrl (header.jpg - landscape)
  // MD+: use CDN capsule art (portrait) - direct CDN URL, no API call needed
  const mobileImageUrl = session.game.coverImageUrl;
  // Use Store API capsule if available, otherwise use CDN capsule art URL
  const defaultCapsuleArtUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${session.game.appId}/library_600x900_2x.jpg`;
  const capsuleArtUrl = storeApiCapsuleUrl || defaultCapsuleArtUrl;

  // Handle desktop capsule art error - try Store API for capsule_image
  const handleDesktopImageError = async (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // If we're already showing header.jpg fallback and it failed, hide the image
    if (fallbackToHeader) {
      setDesktopImageError(true);
      return;
    }

    // If we already have a Store API capsule URL, it means Store API returned something but it also failed
    // Fallback to header.jpg
    if (storeApiCapsuleUrl) {
      if (mobileImageUrl) {
        setFallbackToHeader(true);
        // Let React re-render with the new state
        return;
      } else {
        setDesktopImageError(true);
        return;
      }
    }

    // If we're already fetching, don't trigger again
    if (isFetchingStoreImage) {
      return;
    }

    // Try Store API to get capsule_image
    setIsFetchingStoreImage(true);
    try {
      const response = await fetch(`/api/games/${session.game.appId}/image`);
      if (response.ok) {
        const data = await response.json();
        // Prefer capsuleImageUrl from Store API, fallback to coverImageUrl
        if (data.capsuleImageUrl) {
          setStoreApiCapsuleUrl(data.capsuleImageUrl);
          // React will re-render and update the src automatically
          setIsFetchingStoreImage(false);
          return;
        } else if (data.coverImageUrl) {
          // If no capsule_image, use coverImageUrl but mark as header fallback
          setStoreApiCapsuleUrl(data.coverImageUrl);
          setFallbackToHeader(true);
          // React will re-render and update the src automatically
          setIsFetchingStoreImage(false);
          return;
        }
      }
    } catch (error) {
      // Silently fail
    } finally {
      setIsFetchingStoreImage(false);
    }

    // If Store API failed, try header.jpg fallback
    if (mobileImageUrl) {
      setFallbackToHeader(true);
      // Set mobileImageUrl in state so React can use it
      setStoreApiCapsuleUrl(mobileImageUrl);
      return;
    }
    
    // If no header.jpg available, hide the image
    setDesktopImageError(true);
  };

  return (
    <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 w-full gap-4 px-4 pt-4 pb-4 rounded-lg bg-surface-low border border-border-weak">
      {/* User Header */}
      <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 w-full relative gap-3 sm:gap-4">
        <Link href={`/user/${session.user.steamId}`}>
          <img
            src={session.user.avatarUrl}
            alt={session.user.username}
            className="flex-grow-0 flex-shrink-0 w-10 h-10 rounded object-cover border border-border-strong cursor-pointer hover:opacity-80 transition-opacity"
            onError={(e) => {
              e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%23666'/%3E%3Cpath d='M20 20c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 1c-2.21 0-4 1.79-4 4v1h8v-1c0-2.21-1.79-4-4-4z' fill='%23999'/%3E%3C/svg%3E";
            }}
          />
        </Link>
        <div className="flex flex-col justify-start items-start flex-grow relative">
          <Link href={`/user/${session.user.steamId}`}>
            <p className="self-stretch flex-grow-0 flex-shrink-0 text-sm font-medium text-left text-text-strong cursor-pointer hover:underline">
              {session.user.username}
            </p>
          </Link>
          <p className="flex-grow-0 flex-shrink-0 text-xs text-left text-text-subdued">
            {session.relativeTime}
          </p>
        </div>
      </div>

      {/* Mobile Layout: Vertical (default) */}
      <div className="flex md:hidden flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-4 rounded">
        {/* Game Cover Image - Mobile */}
        {mobileImageUrl ? (
          <Link href={`/games/${session.game.appId}?steamId=${session.user.steamId}`}>
            <img
              src={mobileImageUrl}
              alt={session.game.name}
              className="self-stretch flex-grow-0 flex-shrink-0 h-auto object-cover rounded cursor-pointer hover:opacity-90 transition-opacity"
              style={{ aspectRatio: '460/215' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </Link>
        ) : (
          <Link href={`/games/${session.game.appId}?steamId=${session.user.steamId}`}>
            <div className="self-stretch flex-grow-0 flex-shrink-0 h-[156px] bg-surface-mid rounded flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity">
              <span className="text-text-subdued text-sm">{session.game.name}</span>
            </div>
          </Link>
        )}

        {/* Content Section - Mobile */}
        <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-4">
          {/* Badge and Achievement Summary */}
          <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-3">
            <svg
              width="40"
              height="35"
              viewBox="0 0 40 35"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-grow-0 flex-shrink-0"
              preserveAspectRatio="xMidYMid meet"
            >
              <path d="M10 35L0 17.5L10 0H30L40 17.5L30 35H10Z" fill={badgeColor}></path>
            </svg>
            <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 relative gap-0.5">
              <p className="flex-grow-0 flex-shrink-0 text-xl font-medium text-left text-text-strong">
                {session.narrative?.label || `Unlocked ${session.achievementCount} achievement${session.achievementCount !== 1 ? 's' : ''}`}
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-sm font-light text-left text-text-subdued">
                In <Link href={`/games/${session.game.appId}?steamId=${session.user.steamId}`} className="hover:underline cursor-pointer">{session.game.name}</Link>
              </p>
            </div>
          </div>

          {/* Session Details */}
          <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 gap-1">
            <div className="flex justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-1">
              <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-subdued">
                Session:
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-moderate">
                {session.durationFormatted}
              </p>
            </div>
            {/* Only show "Unlocks" for achievement sessions */}
            {!isPlaytimeOnly && (
              <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 relative gap-1">
                <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-subdued">
                  Unlocks:
                </p>
                <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-moderate">
                  {session.achievementCount}
                </p>
              </div>
            )}
          </div>

          {/* Achievement Icons - Only show if there are achievements */}
          {hasAchievements && (
            <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 gap-3">
              {displayAchievements.map((achievement) => {
                const borderClass = getRarityBorderClass(achievement.rarity);
                return (
                  <div
                    key={achievement.apiName}
                    className={`flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 h-10 w-10 relative p-1 bg-background border ${borderClass}`}
                  >
                    <img 
                      src={achievement.iconUrl} 
                      alt={achievement.name}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.currentTarget.src = achievement.iconGrayUrl;
                      }}
                    />
                  </div>
                );
              })}
              {remainingCount > 0 && (
                <div className="flex flex-col justify-center items-center flex-grow-0 flex-shrink-0 h-10 w-10 relative p-1 bg-background border border-border-strong">
                  <p className="text-[10px] font-semibold text-center text-text-subdued">
                    +{remainingCount}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Achievement Progress Bar */}
          <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-3 px-3 pt-2.5 pb-2 rounded bg-surface-transparent-mid">
            <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-1.5">
              {/* Progress Text */}
              <div className="flex justify-center items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-2">
                <p className="flex-grow text-xs text-left text-text-moderate">
                  <span className="text-xs font-bold text-left text-text-moderate">
                    {unlockedGameAchievements} of {totalGameAchievements}
                  </span>
                  <span className="text-xs text-left text-text-moderate"> achievements</span>
                </p>
                <p className="flex-grow-0 flex-shrink-0 text-xs font-bold text-center text-text-moderate">
                  {completionRate}%
                </p>
              </div>
              {/* Progress Bar */}
              <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative overflow-hidden gap-2 p-0.5 rounded-full bg-background">
                <div
                  className="flex-grow-0 flex-shrink-0 h-[5px] rounded-tl-full rounded-bl-full transition-all bg-primary"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MD+ Layout: Horizontal (content left, image right) */}
      <div className="hidden md:flex justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-8 p-4 rounded bg-surface-mid">
        {/* Content Section - Left */}
        <div className="flex flex-col justify-start items-start flex-grow gap-4">
          {/* Badge and Achievement Summary */}
          <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-3">
            <svg
              width="40"
              height="35"
              viewBox="0 0 40 35"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-grow-0 flex-shrink-0"
              preserveAspectRatio="xMidYMid meet"
            >
              <path d="M10 35L0 17.5L10 0H30L40 17.5L30 35H10Z" fill={badgeColor}></path>
            </svg>
            <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 relative">
              <p className="flex-grow-0 flex-shrink-0 text-xl font-medium text-left text-text-strong">
                {session.narrative?.label || `Unlocked ${session.achievementCount} achievement${session.achievementCount !== 1 ? 's' : ''}`}
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-sm font-normal text-left text-text-subdued">
                In <Link href={`/games/${session.game.appId}?steamId=${session.user.steamId}`} className="hover:underline cursor-pointer">{session.game.name}</Link>
              </p>
            </div>
          </div>

          {/* Session Details */}
          <div className="flex flex-row justify-start items-start flex-grow-0 flex-shrink-0 gap-3">
            <div className="flex justify-start items-start self-stretch flex-grow-0 relative gap-1">
              <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-weak">
                Session:
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-moderate">
                {session.durationFormatted}
              </p>
            </div>
            {/* Only show "Unlocks" for achievement sessions */}
            {!isPlaytimeOnly && (
              <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 relative gap-1">
                <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-weak">
                  Unlocks:
                </p>
                <p className="flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-moderate">
                  {session.achievementCount}
                </p>
              </div>
            )}
          </div>

          {/* Achievement Icons - Only show if there are achievements */}
          {hasAchievements && (
            <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 gap-3">
              {displayAchievements.map((achievement) => {
                const borderClass = getRarityBorderClass(achievement.rarity);
                return (
                  <div
                    key={achievement.apiName}
                    className={`flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 w-12 h-12 relative p-1 bg-background border ${borderClass}`}
                  >
                    <img 
                      src={achievement.iconUrl} 
                      alt={achievement.name}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.currentTarget.src = achievement.iconGrayUrl;
                      }}
                    />
                  </div>
                );
              })}
              {remainingCount > 0 && (
                <div className="flex flex-col justify-center items-center flex-grow-0 flex-shrink-0 h-12 w-12 relative p-1 bg-background">
                  <p className="text-base font-semibold text-center text-text-subdued">
                    +{remainingCount}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Achievement Progress Bar */}
          <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-3 pt-1 pb-2 rounded-md bg-surface-mid">
            <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-1.5">
              {/* Progress Text */}
              <div className="flex justify-center items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-2">
                <p className="flex-grow text-xs text-left text-text-moderate">
                  <span className="text-xs font-bold text-left text-text-moderate">
                    {unlockedGameAchievements} of {totalGameAchievements}
                  </span>
                  <span className="text-xs text-left text-text-moderate"> achievements</span>
                </p>
                <p className="flex-grow-0 flex-shrink-0 text-xs font-bold text-center text-text-moderate">
                  {completionRate}%
                </p>
              </div>
              {/* Progress Bar */}
              <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative overflow-hidden gap-2 p-0.5 rounded-full bg-background">
                <div
                  className="flex-grow-0 flex-shrink-0 h-[5px] rounded-tl-full rounded-bl-full transition-all bg-primary"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Game Art Image - Right (MD+) - Portrait Capsule Art */}
        {!desktopImageError && (
          <Link href={`/games/${session.game.appId}?steamId=${session.user.steamId}`}>
            <img
              src={fallbackToHeader && mobileImageUrl ? mobileImageUrl : capsuleArtUrl}
              alt={session.game.name}
              className={`self-stretch h-full rounded-md object-cover cursor-pointer hover:opacity-90 transition-opacity ${
                isPlaytimeOnly 
                  ? 'max-h-[147px] max-w-[98px]' 
                  : 'max-h-64 max-w-[98px]'
              }`}
              style={{
                aspectRatio: fallbackToHeader ? '460/215' : '600/900', // Landscape for header, portrait for capsule
                boxShadow: '0px 66px 19px 0 rgba(0,0,0,0), 0px 42px 17px 0 rgba(0,0,0,0.04), 0px 24px 14px 0 rgba(0,0,0,0.12), 0px 11px 11px 0 rgba(0,0,0,0.2), 0px 3px 6px 0 rgba(0,0,0,0.23)',
              }}
              onError={handleDesktopImageError}
            />
          </Link>
        )}
      </div>

      {/* Like Button - Below achievement block */}
      <FeedLikeButton session={session} />
    </div>
  );
}
