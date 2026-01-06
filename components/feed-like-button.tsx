"use client";

import { useState } from "react";
import { type FeedSession } from "@/lib/utils/feed-sessions";

interface FeedLikeButtonProps {
  session: FeedSession;
  onLikeChange?: (liked: boolean, count: number) => void;
}

export function FeedLikeButton({ session, onLikeChange }: FeedLikeButtonProps) {
  const [isLiked, setIsLiked] = useState(session.isLiked);
  const [likeCount, setLikeCount] = useState(session.likeCount);
  const [likedByUsers, setLikedByUsers] = useState(session.likedByUsers || []);
  const [isLoading, setIsLoading] = useState(false);

  const handleLike = async () => {
    if (isLoading) return;

    // Optimistic update
    const newLiked = !isLiked;
    const newCount = newLiked ? likeCount + 1 : Math.max(0, likeCount - 1);
    
    setIsLiked(newLiked);
    setLikeCount(newCount);
    setIsLoading(true);

    try {
      const method = newLiked ? "POST" : "DELETE";
      const response = await fetch(`/api/feed/${session.sessionId}/like`, {
        method,
      });

      if (!response.ok) {
        throw new Error("Failed to update like");
      }

      const data = await response.json();
      setIsLiked(data.liked);
      setLikeCount(data.likeCount);
      
      // Update liked by users from API response
      if (data.likedByUsers) {
        setLikedByUsers(data.likedByUsers);
      }
      
      if (onLikeChange) {
        onLikeChange(data.liked, data.likeCount);
      }
    } catch (error) {
      // Rollback on error
      setIsLiked(!newLiked);
      setLikeCount(likeCount);
      setLikedByUsers(session.likedByUsers || []); // Rollback to original
      console.error("Error updating like:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const heartColor = isLiked ? "text-like-pink" : "text-text-subdued";
  const heartFill = isLiked ? "fill-like-pink" : "fill-text-subdued";

  // Empty state (no likes)
  if (likeCount === 0 && !isLiked) {
    return (
      <div className="flex justify-between items-center self-stretch flex-grow-0 flex-shrink-0 relative">
        <p className="flex-grow-0 flex-shrink-0 text-sm font-light text-left text-text-subdued">
          Be the first to like this post
        </p>
        <button
          onClick={handleLike}
          disabled={isLoading}
          className="flex flex-col justify-center items-center flex-grow-0 flex-shrink-0 w-10 relative overflow-hidden gap-2 px-[9px] py-2.5 rounded-full bg-surface-mid hover:bg-surface-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={isLiked ? "Unlike this post" : "Like this post"}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`flex-grow-0 flex-shrink-0 w-5 h-5 relative ${heartColor}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <path
              d="M9.63833 17.5937C9.74394 17.6685 9.87017 17.7086 9.99958 17.7086C10.129 17.7086 10.2552 17.6685 10.3608 17.5937L10 17.0837L10.3617 17.5937L10.3683 17.5887L10.3858 17.5762L10.4525 17.5278C10.5103 17.4862 10.5922 17.4253 10.6983 17.3453C11.9367 16.4107 13.1056 15.3874 14.1958 14.2837C15.1525 13.3103 16.125 12.1728 16.8617 10.9662C17.595 9.76616 18.125 8.44616 18.125 7.12283C18.125 5.55199 17.6375 4.32449 16.775 3.49116C15.9167 2.66283 14.7583 2.29199 13.5417 2.29199C12.1042 2.29199 10.835 2.98616 10 4.05616C9.165 2.98616 7.895 2.29199 6.45833 2.29199C3.89167 2.29199 1.875 4.49116 1.875 7.12283C1.875 8.44616 2.40583 9.76533 3.13833 10.9662C3.875 12.1728 4.8475 13.3103 5.80417 14.2845C6.96651 15.4604 8.21801 16.5448 9.5475 17.5278L9.61417 17.5762L9.63167 17.5887L9.63833 17.5937Z"
              className={heartFill}
            />
          </svg>
        </button>
      </div>
    );
  }

  // Liked state (with count and avatars)
  const displayAvatars = likedByUsers.slice(0, 3);

  return (
    <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-2">
      {/* Avatar stack - show up to 3 avatars */}
      {displayAvatars.length > 0 && (
        <div className="flex flex-row-reverse justify-start items-center flex-grow-0 flex-shrink-0 relative -space-x-3">
          {displayAvatars.map((user, index) => (
            <img
              key={user.userId}
              src={user.avatarUrl}
              alt=""
              className="flex-grow-0 flex-shrink-0 w-6 h-6 rounded-full object-cover border-2 border-background"
              onError={(e) => {
                e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23666'/%3E%3Cpath d='M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 1c-2.21 0-4 1.79-4 4v1h8v-1c0-2.21-1.79-4-4-4z' fill='%23999'/%3E%3C/svg%3E";
              }}
            />
          ))}
        </div>
      )}
      
      <p className="flex-grow text-xs font-semibold text-left text-text-moderate">
        {likeCount} {likeCount === 1 ? "like" : "likes"}
      </p>
      
      <button
        onClick={handleLike}
        disabled={isLoading}
        className="flex flex-col justify-center items-center flex-grow-0 flex-shrink-0 w-10 relative overflow-hidden gap-2 px-[9px] py-2.5 rounded-full bg-surface-mid hover:bg-surface-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={isLiked ? "Unlike this post" : "Like this post"}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`flex-grow-0 flex-shrink-0 w-5 h-5 relative ${heartColor}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <path
            d="M9.63833 17.5937C9.74394 17.6685 9.87017 17.7086 9.99958 17.7086C10.129 17.7086 10.2552 17.6685 10.3608 17.5937L10 17.0837L10.3617 17.5937L10.3683 17.5887L10.3858 17.5762L10.4525 17.5278C10.5103 17.4862 10.5922 17.4253 10.6983 17.3453C11.9367 16.4107 13.1056 15.3874 14.1958 14.2837C15.1525 13.3103 16.125 12.1728 16.8617 10.9662C17.595 9.76616 18.125 8.44616 18.125 7.12283C18.125 5.55199 17.6375 4.32449 16.775 3.49116C15.9167 2.66283 14.7583 2.29199 13.5417 2.29199C12.1042 2.29199 10.835 2.98616 10 4.05616C9.165 2.98616 7.895 2.29199 6.45833 2.29199C3.89167 2.29199 1.875 4.49116 1.875 7.12283C1.875 8.44616 2.40583 9.76533 3.13833 10.9662C3.875 12.1728 4.8475 13.3103 5.80417 14.2845C6.96651 15.4604 8.21801 16.5448 9.5475 17.5278L9.61417 17.5762L9.63167 17.5887L9.63833 17.5937Z"
            className={heartFill}
          />
        </svg>
      </button>
    </div>
  );
}
