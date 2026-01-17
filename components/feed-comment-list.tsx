"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { FeedCommentItem } from "@/components/feed-comment-item";
import { Button } from "@/components/ui/button";
import type { Comment } from "@/lib/data/access";

interface FeedCommentListProps {
  sessionId: string;
  currentUserId?: string;
  commentCount?: number; // Total comment count from session
  onCommentAdded?: (comment: Comment) => void;
  onCommentUpdated?: (commentId: string, content: string) => void;
  onCommentDeleted?: (commentId: string) => void;
}

export interface FeedCommentListRef {
  addOptimisticComment: (comment: Comment) => void;
}

interface CommentsResponse {
  comments: Comment[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export const FeedCommentList = forwardRef<FeedCommentListRef, FeedCommentListProps>(
  function FeedCommentList(
    {
      sessionId,
      currentUserId,
      commentCount = 0,
      onCommentAdded,
      onCommentUpdated,
      onCommentDeleted,
    },
    ref
  ) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });
  const listRef = useRef<HTMLDivElement>(null);

  // Helper to normalize comment dates (convert strings to Date objects)
  const normalizeComment = (comment: any): Comment => ({
    ...comment,
    createdAt: comment.createdAt instanceof Date ? comment.createdAt : new Date(comment.createdAt),
    updatedAt: comment.updatedAt instanceof Date ? comment.updatedAt : new Date(comment.updatedAt),
  });

  const fetchComments = async (offset: number = 0, limit: number = 20) => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/feed/${sessionId}/comments?limit=${limit}&offset=${offset}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch comments");
      }
      const data: CommentsResponse = await response.json();
      
      // Normalize dates from API response (JSON serializes dates as strings)
      const normalizedComments = data.comments.map(normalizeComment);
      
      if (offset === 0) {
        setComments(normalizedComments);
      } else {
        setComments((prev) => [...prev, ...normalizedComments]);
      }
      setPagination(data.pagination);
    } catch (error) {
      console.error("Error fetching comments:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchComments(0, 20);
  }, [sessionId]);

  // Scroll to new comment when added
  useEffect(() => {
    if (onCommentAdded && comments.length > 0 && listRef.current) {
      const firstComment = listRef.current.firstElementChild;
      if (firstComment) {
        firstComment.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [comments.length, onCommentAdded]);

  const handleLoadMore = () => {
    fetchComments(pagination.offset + pagination.limit, pagination.limit);
  };

  const handleEdit = async (commentId: string, content: string) => {
    try {
      const response = await fetch(
        `/api/feed/${sessionId}/comments/${commentId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      if (!response.ok) throw new Error("Failed to update comment");
      
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, content, isEdited: true } : c
        )
      );
      onCommentUpdated?.(commentId, content);
    } catch (error) {
      console.error("Error updating comment:", error);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      const response = await fetch(
        `/api/feed/${sessionId}/comments/${commentId}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to delete comment");
      
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setPagination((prev) => ({ ...prev, total: prev.total - 1 }));
      onCommentDeleted?.(commentId);
    } catch (error) {
      console.error("Error deleting comment:", error);
    }
  };

  // Expose method to add optimistic comment via ref
  useImperativeHandle(ref, () => ({
    addOptimisticComment: (comment: Comment) => {
      // Normalize dates before adding (API responses have date strings)
      const normalizedComment = normalizeComment(comment);
      // Add comment to the beginning of the list (newest first)
      setComments((prev) => [normalizedComment, ...prev]);
      setPagination((prev) => ({ ...prev, total: prev.total + 1 }));
      
      // Scroll to the new comment
      setTimeout(() => {
        if (listRef.current) {
          const firstComment = listRef.current.firstElementChild;
          if (firstComment) {
            firstComment.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
      }, 100);
    },
  }));

  // Don't show skeleton if we know there are no comments (prevents height jump)
  if (isLoading && comments.length === 0) {
    // If commentCount is 0, skip skeleton to prevent card height jump
    if (commentCount === 0) {
      return null;
    }
    // Only show 1 skeleton item to minimize height jump (mimics 1 comment)
    return (
      <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 gap-5">
        <div className="flex justify-start items-start gap-2 w-full">
          <div className="w-6 h-6 rounded-full bg-surface-mid animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-24 bg-surface-mid animate-pulse rounded" />
            <div className="h-4 w-full bg-surface-mid animate-pulse rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (comments.length === 0) {
    return null; // No empty state per requirements
  }

  return (
    <div
      ref={listRef}
      className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 w-full gap-5"
    >
      {comments.map((comment) => (
        <FeedCommentItem
          key={comment.id}
          comment={comment}
          currentUserId={currentUserId}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ))}
      {pagination.hasMore && (
        <Button
          variant="outline"
          size="xs"
          onClick={handleLoadMore}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? "Loading..." : "Load More"}
        </Button>
      )}
    </div>
  );
  }
);
