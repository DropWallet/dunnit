"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface FeedCommentInputProps {
  sessionId: string;
  onSubmit: (content: string) => Promise<void>;
  onCancel?: () => void;
}

export function FeedCommentInput({ sessionId, onSubmit, onCancel }: FeedCommentInputProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isExpanded = content.length > 0;
  const isTooLong = content.length > 500;

  // Auto-focus when expanded
  useEffect(() => {
    if (isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded]);

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting || isTooLong) return;
    
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(content.trim());
      setContent("");
      setError(null);
    } catch (error) {
      console.error("Error submitting comment:", error);
      // Detect network errors and provide user-friendly message
      const isNetworkError = error instanceof TypeError && 
                            (error.message.includes("Failed to fetch") || 
                             error.message.includes("NetworkError") ||
                             !navigator.onLine);
      
      const errorMessage = isNetworkError
        ? "Unable to post comment. Check your connection and try again."
        : error instanceof Error 
          ? error.message 
          : "Unable to post comment. Please try again.";
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setContent("");
    setError(null);
    if (onCancel) {
      onCancel();
    }
    // Return focus to comment button or remove focus
    textareaRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape to cancel
    if (e.key === "Escape" && isExpanded) {
      e.preventDefault();
      handleCancel();
      return;
    }
    
    // Enter to submit (but allow Shift+Enter for new line)
    if (e.key === "Enter" && !e.shiftKey && !isSubmitting && content.trim()) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Clear error when user starts typing
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    if (error) {
      setError(null);
    }
  };

  const hasError = !!error || isTooLong;
  const errorMessage = isTooLong 
    ? "Content cannot exceed 500 characters" 
    : error;

  return (
    <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 w-full gap-2">
      <div 
        className={`flex flex-col justify-center items-start self-stretch flex-grow-0 flex-shrink-0 rounded-lg bg-background border transition-colors ${
          isExpanded 
            ? hasError
              ? "p-2 border-input-error focus-within:border-input-error" 
              : "p-2 border-input-active focus-within:border-input-active"
            : "p-2 border-border-strong hover:border-input-hover"
        }`}
      >
        <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 gap-2 w-full">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment"
            disabled={isSubmitting}
            rows={isExpanded ? 3 : 1}
            className="flex-grow text-sm font-medium text-left text-text-moderate placeholder:text-text-weak bg-transparent border-none outline-none w-full resize-none focus:outline-none"
            maxLength={500}
            aria-label="Add a comment"
            aria-invalid={hasError}
            aria-describedby={hasError ? "comment-input-error" : undefined}
          />
        </div>
        
        {/* Action buttons - only show when expanded */}
        {isExpanded && (
          <div className="flex justify-end items-center self-stretch flex-grow-0 flex-shrink-0 gap-2 w-full">
            <Button
              variant="outline"
              size="xs"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="text-text-subdued hover:text-text-moderate"
              aria-label="Cancel comment"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="xs"
              onClick={handleSubmit}
              disabled={isSubmitting || !content.trim() || isTooLong}
              aria-label="Post comment"
            >
              Comment
            </Button>
          </div>
        )}
      </div>
      
      {/* Error message - show below input */}
      {hasError && (
        <p 
          id="comment-input-error"
          className="text-xs text-destructive mt-0"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      
      {/* Character counter - show when approaching limit */}
      {isExpanded && content.length > 400 && (
        <p className={`text-xs mt-0 ${isTooLong ? "text-destructive" : "text-text-subdued"}`}>
          {content.length} / 500
        </p>
      )}
    </div>
  );
}
