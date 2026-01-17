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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isExpanded = content.length > 0;

  // Auto-focus when expanded
  useEffect(() => {
    if (isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded]);

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(content.trim());
      setContent("");
    } catch (error) {
      console.error("Error submitting comment:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setContent("");
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

  return (
    <div 
      className={`flex flex-col justify-center items-start self-stretch flex-grow-0 flex-shrink-0 rounded-lg bg-background border transition-colors ${
        isExpanded 
          ? "p-2 border-input-active focus-within:border-input-active" 
          : "p-2 border-border-strong hover:border-input-hover"
      }`}
    >
      <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 gap-2 w-full">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment"
          disabled={isSubmitting}
          rows={isExpanded ? 3 : 1}
          className="flex-grow text-sm font-medium text-left text-text-moderate placeholder:text-text-weak bg-transparent border-none outline-none w-full resize-none focus:outline-none"
          maxLength={1000}
          aria-label="Add a comment"
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
            disabled={isSubmitting || !content.trim()}
            aria-label="Post comment"
          >
            Comment
          </Button>
        </div>
      )}
    </div>
  );
}
