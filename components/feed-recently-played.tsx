"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useUserGames } from "@/hooks/useUserGames";

export function FeedRecentlyPlayed() {
  const { games, isLoading: isLoadingGames } = useUserGames();

  // Get recently played games (last 3, sorted by lastPlayed)
  const recentlyPlayedGames = useMemo(() => {
    if (!games || games.length === 0) return [];
    
    // Filter games with lastPlayed and sort by most recent
    const gamesWithLastPlayed = games
      .filter(game => game.lastPlayed)
      .sort((a, b) => {
        if (!a.lastPlayed || !b.lastPlayed) return 0;
        return b.lastPlayed.getTime() - a.lastPlayed.getTime();
      });
    
    return gamesWithLastPlayed.slice(0, 3);
  }, [games]);

  const formatPlaytime = (playtimeMinutes: number): string => {
    const hours = playtimeMinutes / 60;
    return `${hours.toFixed(1)} hrs played`;
  };

  return (
    <div className="flex flex-col justify-center items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-3">
      <p className="flex-grow-0 flex-shrink-0 text-xl font-semibold text-center text-text-strong">
        Recently played
      </p>
      {isLoadingGames ? (
        <p className="text-text-subdued text-sm">Loading games...</p>
      ) : recentlyPlayedGames.length === 0 ? (
        <p className="text-text-subdued text-sm">No recently played games</p>
      ) : (
        <div className="flex flex-col justify-center items-start self-stretch flex-grow-0 flex-shrink-0 gap-2.5">
          {recentlyPlayedGames.map((game) => (
            <RecentlyPlayedGameCard key={game.appId} game={game} formatPlaytime={formatPlaytime} />
          ))}
        </div>
      )}
    </div>
  );
}

interface RecentlyPlayedGameCardProps {
  game: {
    appId: number;
    name: string;
    playtimeMinutes: number;
    coverImageUrl?: string;
    logoUrl?: string;
    iconUrl?: string;
  };
  formatPlaytime: (minutes: number) => string;
}

function RecentlyPlayedGameCard({ game, formatPlaytime }: RecentlyPlayedGameCardProps) {
  const [imageError, setImageError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);
  const [iconError, setIconError] = useState(false);
  const [storeApiImageUrl, setStoreApiImageUrl] = useState<string | null>(null);
  const [isFetchingStoreImage, setIsFetchingStoreImage] = useState(false);

  // Reset error states when image URLs change
  useEffect(() => {
    setImageError(false);
    setFallbackError(false);
    setIconError(false);
    setStoreApiImageUrl(null);
  }, [game.coverImageUrl, game.logoUrl, game.iconUrl]);

  // Handle image load error - try to fetch from Store API on-demand
  const handleImageError = async () => {
    // Only try Store API if this is a default header.jpg URL (not already a Store API image)
    const isDefaultHeader = game.coverImageUrl?.includes('/steam/apps/') && game.coverImageUrl?.endsWith('/header.jpg');
    
    if (isDefaultHeader && !isFetchingStoreImage && !storeApiImageUrl) {
      setIsFetchingStoreImage(true);
      try {
        const response = await fetch(`/api/games/${game.appId}/image`);
        if (response.ok) {
          const data = await response.json();
          if (data.coverImageUrl) {
            setStoreApiImageUrl(data.coverImageUrl);
            setImageError(false);
            setIsFetchingStoreImage(false);
            return;
          }
        }
      } catch (error) {
        // Silently fail - will fall back to logo/icon
      } finally {
        setIsFetchingStoreImage(false);
      }
    }
    
    setImageError(true);
  };

  const handleFallbackError = () => {
    setFallbackError(true);
  };

  const handleIconError = () => {
    setIconError(true);
  };

  // Determine which image to show
  // Default to header.jpg if no coverImageUrl is provided
  const defaultCoverImageUrl = game.coverImageUrl || `https://steamcdn-a.akamaihd.net/steam/apps/${game.appId}/header.jpg`;
  const effectiveCoverImageUrl = storeApiImageUrl || defaultCoverImageUrl;
  const showCoverImage = effectiveCoverImageUrl && !imageError && !isFetchingStoreImage;
  const showLogo = !showCoverImage && !isFetchingStoreImage && game.logoUrl && !fallbackError;
  const showIcon = !showCoverImage && !showLogo && !isFetchingStoreImage && game.iconUrl && !iconError;
  const showLoadingPlaceholder = isFetchingStoreImage;
  const showPlaceholder = !showCoverImage && !showLogo && !showIcon && !showLoadingPlaceholder;

  return (
    <Link
      href={`/games/${game.appId}`}
      className="flex justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-3 p-2 rounded-md bg-surface-low hover:bg-surface-mid transition-colors cursor-pointer border border-border-weak"
    >
      {showCoverImage ? (
        <img
          src={effectiveCoverImageUrl}
          alt={game.name}
          className="flex-grow-0 flex-shrink-0 w-32 h-[59.83px] object-cover rounded-sm"
          onError={handleImageError}
        />
      ) : showLoadingPlaceholder ? (
        <div className="flex-grow-0 flex-shrink-0 w-32 h-[59.83px] rounded-sm bg-surface-mid animate-pulse" />
      ) : showLogo ? (
        <img
          src={game.logoUrl}
          alt={game.name}
          className="flex-grow-0 flex-shrink-0 w-32 h-[59.83px] object-cover rounded-sm"
          style={{ aspectRatio: '460/215' }}
          onError={handleFallbackError}
        />
      ) : showIcon ? (
        <img
          src={game.iconUrl}
          alt={game.name}
          className="flex-grow-0 flex-shrink-0 w-32 h-[59.83px] object-cover rounded-sm"
          style={{ aspectRatio: '460/215' }}
          onError={handleIconError}
        />
      ) : (
        <div className="flex-grow-0 flex-shrink-0 w-32 h-[59.83px] rounded-sm bg-surface-mid flex items-center justify-center">
          <span className="text-text-subdued text-xs">No image</span>
        </div>
      )}
      <div className="flex flex-col justify-center items-start self-stretch flex-grow gap-3 min-w-0">
        <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative min-w-0">
          <p className="text-text-moderate font-bold text-left text-text-strong truncate w-full">
            {game.name}
          </p>
          <p className="text-sm text-left text-text-weak">
            {formatPlaytime(game.playtimeMinutes)}
          </p>
        </div>
      </div>
    </Link>
  );
}
