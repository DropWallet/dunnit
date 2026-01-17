"use client";

import { useState, useRef } from "react";
import { type FeedSession } from "@/lib/utils/feed-sessions";
import { FeedActionButton } from "@/components/feed-action-button";
import { FeedCommentInput } from "@/components/feed-comment-input";
import { FeedCommentList, type FeedCommentListRef } from "@/components/feed-comment-list";
import { useUserData } from "@/hooks/useUserData";
import type { Comment } from "@/lib/data/access";

interface FeedLikeButtonProps {
  session: FeedSession;
  onLikeChange?: (liked: boolean, count: number) => void;
}

export function FeedLikeButton({ session, onLikeChange }: FeedLikeButtonProps) {
  const [isLiked, setIsLiked] = useState(session.isLiked);
  const [likeCount, setLikeCount] = useState(session.likeCount);
  const [likedByUsers, setLikedByUsers] = useState(session.likedByUsers || []);
  const [isLoading, setIsLoading] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(session.commentCount || 0);
  const commentListRef = useRef<FeedCommentListRef>(null);
  const { user: currentUser } = useUserData(undefined, false);

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

  const handleCommentClick = () => {
    // If comments are visible, hide them (and input if open)
    if (showComments) {
      setShowComments(false);
      setShowCommentInput(false);
    } else {
      // If comments are hidden, show input and comments
      setShowCommentInput(true);
      setShowComments(true);
    }
  };

  const handleCommentSubmit = async (content: string) => {
    try {
      const response = await fetch(`/api/feed/${session.sessionId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error("Failed to post comment");
      }

      const data = await response.json();
      const newComment: Comment = data.comment;

      // Optimistic update: Add comment to list immediately
      if (commentListRef.current) {
        commentListRef.current.addOptimisticComment(newComment);
      }

      // Auto-expand comments if not already shown
      if (!showComments) {
        setShowComments(true);
      }

      // Update comment count
      setCommentCount((prev) => prev + 1);

      // Clear input and close
      setShowCommentInput(false);
    } catch (error) {
      console.error("Error posting comment:", error);
      throw error;
    }
  };

  // Heart icon SVG (new design)
  // Stroke uses currentColor to inherit from wrapper (text-subdued → text-moderate on hover) when not liked
  // When liked, uses like-pink color
  const HeartIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`flex-grow-0 flex-shrink-0 w-4 h-4 relative ${isLiked ? "text-like-pink" : ""}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d="M10.833 2.58301C11.6574 2.58301 12.3815 2.83265 12.8984 3.33105V3.33203C13.4125 3.82871 13.7499 4.59899 13.75 5.69727C13.75 6.56215 13.4001 7.47991 12.8496 8.38086V8.38184C12.3007 9.28095 11.5638 10.1449 10.8213 10.9004C9.97517 11.7568 9.06833 12.5511 8.10742 13.2764C8.06652 13.3072 8.03012 13.3331 8 13.3555C7.12758 12.7047 6.29831 11.9982 5.51855 11.2393L5.17676 10.8994C4.43477 10.1437 3.69979 9.28005 3.15137 8.38184C2.60082 7.47929 2.25 6.56201 2.25 5.69727C2.25021 3.96104 3.57189 2.58301 5.16699 2.58301C6.06523 2.58311 6.87063 3.01594 7.40918 3.70605L8 4.46387L8.59082 3.70605C9.12942 3.01587 9.93418 2.58311 10.833 2.58301Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill={isLiked ? "currentColor" : "none"}
      />
    </svg>
  );

  // Comment icon SVG
  // Text color inherits from wrapper (text-subdued → text-moderate on hover)
  const CommentIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-grow-0 flex-shrink-0 w-4 h-4 relative"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d="M7.99991 1.33301C7.12443 1.33301 6.25752 1.50545 5.44869 1.84048C4.63985 2.17551 3.90492 2.66657 3.28587 3.28563C2.03562 4.53587 1.33324 6.23156 1.33324 7.99967C1.32798 9.539 1.86093 11.0318 2.83991 12.2197L1.50658 13.553C1.41407 13.6468 1.35141 13.7658 1.32649 13.8951C1.30158 14.0245 1.31552 14.1583 1.36658 14.2797C1.42195 14.3996 1.51171 14.5004 1.62448 14.5693C1.73724 14.6381 1.86791 14.6719 1.99991 14.6663H7.99991C9.76802 14.6663 11.4637 13.964 12.714 12.7137C13.9642 11.4635 14.6666 9.76778 14.6666 7.99967C14.6666 6.23156 13.9642 4.53587 12.714 3.28563C11.4637 2.03539 9.76802 1.33301 7.99991 1.33301ZM7.99991 13.333H3.60658L4.22658 12.713C4.35074 12.5881 4.42044 12.4191 4.42044 12.243C4.42044 12.0669 4.35074 11.8979 4.22658 11.773C3.35363 10.901 2.81003 9.75337 2.68837 8.52554C2.56672 7.29771 2.87454 6.06568 3.5594 5.03936C4.24425 4.01303 5.26377 3.25591 6.44425 2.89699C7.62474 2.53807 8.89315 2.59954 10.0334 3.07095C11.1736 3.54236 12.1151 4.39452 12.6975 5.48227C13.2799 6.57001 13.4672 7.82604 13.2273 9.03635C12.9875 10.2467 12.3354 11.3364 11.3823 12.1198C10.4291 12.9033 9.23375 13.332 7.99991 13.333Z"
        fill="currentColor"
      />
    </svg>
  );

  // Empty state (no likes)
  if (likeCount === 0 && !isLiked) {
    return (
      <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-4">
        <div className="flex justify-between items-center self-stretch flex-grow-0 flex-shrink-0 relative">
          <p className="flex-grow-0 flex-shrink-0 text-xs font-medium text-left text-text-subdued">
            Be the first to like this post
          </p>
          <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 gap-3">
            <FeedActionButton
              icon={CommentIcon}
              count={commentCount}
              onClick={handleCommentClick}
              ariaLabel={`${commentCount} comments`}
              showCount={true}
            />
            <FeedActionButton
              icon={HeartIcon}
              onClick={handleLike}
              disabled={isLoading}
              ariaLabel={isLiked ? "Unlike this post" : "Like this post"}
            />
          </div>
        </div>
        {showCommentInput && (
          <FeedCommentInput
            sessionId={session.sessionId}
            onSubmit={handleCommentSubmit}
          />
        )}
        {showComments && (
          <FeedCommentList
            ref={commentListRef}
            sessionId={session.sessionId}
            currentUserId={currentUser?.steamId}
            commentCount={commentCount}
            onCommentDeleted={() => {
              setCommentCount((prev) => Math.max(0, prev - 1));
            }}
          />
        )}
      </div>
    );
  }

  // Liked state (with count and avatars)
  const displayAvatars = likedByUsers.slice(0, 3);

  return (
    <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-4">
      <div className="flex justify-between items-center self-stretch flex-grow-0 flex-shrink-0 relative">
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
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
        </div>
        
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 gap-3">
          <FeedActionButton
            icon={CommentIcon}
            count={commentCount}
            onClick={handleCommentClick}
            ariaLabel={`${commentCount} comments`}
            showCount={true}
          />
          <FeedActionButton
            icon={HeartIcon}
            onClick={handleLike}
            disabled={isLoading}
            ariaLabel={isLiked ? "Unlike this post" : "Like this post"}
          />
        </div>
      </div>
      {showCommentInput && (
        <FeedCommentInput
          sessionId={session.sessionId}
          onSubmit={handleCommentSubmit}
        />
      )}
      {showComments && (
        <FeedCommentList
          ref={commentListRef}
          sessionId={session.sessionId}
          currentUserId={currentUser?.steamId}
          commentCount={commentCount}
          onCommentDeleted={() => {
            setCommentCount((prev) => Math.max(0, prev - 1));
          }}
        />
      )}
    </div>
  );
}
