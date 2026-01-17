"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { MoreVertical, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DotSeparator } from "@/components/dot-separator";
import { getRelativeTime } from "@/lib/utils/feed-sessions";
import type { Comment } from "@/lib/data/access";

interface FeedCommentItemProps {
  comment: Comment;
  currentUserId?: string;
  onEdit?: (commentId: string, content: string) => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
}

export function FeedCommentItem({
  comment,
  currentUserId,
  onEdit,
  onDelete,
}: FeedCommentItemProps) {
  const isOwner = currentUserId === comment.userId;
  const relativeTime = getRelativeTime(comment.createdAt);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end of text
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
    }
  }, [isEditing]);

  const handleEditClick = () => {
    setEditContent(comment.content);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editContent.trim() || isSubmitting || !onEdit) return;
    
    const trimmedContent = editContent.trim();
    // Don't save if content hasn't changed
    if (trimmedContent === comment.content) {
      setIsEditing(false);
      return;
    }
    
    setIsSubmitting(true);
    try {
      await onEdit(comment.id, trimmedContent);
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating comment:", error);
      // Keep edit mode open on error so user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setEditContent(comment.content);
    setIsEditing(false);
    textareaRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape to cancel
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
      return;
    }
    
    // Enter to save (but allow Shift+Enter for new line)
    if (e.key === "Enter" && !e.shiftKey && !isSubmitting && editContent.trim()) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    try {
      await onDelete(comment.id);
    } catch (error) {
      console.error("Error deleting comment:", error);
    }
  };

  return (
    <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 w-full relative gap-2">
      {/* Avatar */}
      <Link href={`/user/${comment.userId}`}>
        <img
          src={comment.avatarUrl}
          alt={comment.username}
          className="flex-grow-0 flex-shrink-0 w-6 h-6 rounded-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
          onError={(e) => {
            e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23666'/%3E%3Cpath d='M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 1c-2.21 0-4 1.79-4 4v1h8v-1c0-2.21-1.79-4-4-4z' fill='%23999'/%3E%3C/svg%3E";
          }}
        />
      </Link>

      {/* Content */}
      <div className="flex flex-col justify-start items-start flex-1 min-w-0 w-full relative">
        {/* Header: Username, timestamp, menu */}
        <div className="flex justify-start items-center w-full relative gap-1">
          <Link href={`/user/${comment.userId}`}>
            <p className="flex-shrink-0 text-xs font-semibold text-left text-text-strong cursor-pointer hover:underline">
              {comment.username}
            </p>
          </Link>
          <DotSeparator />
          <p className="flex-grow text-xs font-semibold text-left text-text-weak truncate">
            {relativeTime}
          </p>
          {isOwner && !isEditing && (
            <div className="flex-shrink-0">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-7 w-7 p-0 hover:bg-surface-mid"
                    aria-label="Comment options"
                  >
                    <MoreVertical className="h-4 w-4 text-text-weak" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-surface-low border-border-weak text-text-strong min-w-[160px]"
                >
                  {onEdit && (
                    <DropdownMenuItem
                      onClick={handleEditClick}
                      className="cursor-pointer"
                    >
                      <Edit className="h-4 w-4 text-text-weak mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem
                          onSelect={(e) => e.preventDefault()}
                          className="cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4 text-text-weak mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDelete}
                            variant="destructive"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Comment content or edit textarea */}
        {isEditing ? (
          <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 gap-2 w-full mt-2">
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              rows={3}
              className="self-stretch flex-grow-0 flex-shrink-0 w-full px-3 py-2 text-sm font-medium text-left text-text-strong bg-surface-low border border-input-active rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-text-weak"
              maxLength={1000}
              aria-label="Edit comment"
            />
            {/* Save/Cancel buttons */}
            <div className="flex justify-end items-center self-stretch flex-grow-0 flex-shrink-0 gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={handleCancel}
                disabled={isSubmitting}
                className="text-text-subdued hover:text-text-moderate"
                aria-label="Cancel edit"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="xs"
                onClick={handleSave}
                disabled={isSubmitting || !editContent.trim()}
                aria-label="Save comment"
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="self-stretch flex-grow-0 flex-shrink-0 max-w-full text-sm text-left text-text-strong break-words leading-relaxed">
              {comment.content}
            </p>

            {/* Reply button - only show when not editing */}
            <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-2 pt-1.5">
              <button className="flex-grow-0 flex-shrink-0 text-xs font-semibold text-left text-text-weak hover:text-text-moderate transition-colors cursor-pointer">
                Reply
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
