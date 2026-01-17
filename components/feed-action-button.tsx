"use client";

import React from "react";

interface FeedActionButtonProps {
  icon: React.ReactNode;
  count?: number;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel: string;
  showCount?: boolean; // If true, shows count text next to icon
}

export function FeedActionButton({
  icon,
  count,
  onClick,
  disabled = false,
  ariaLabel,
  showCount = false,
}: FeedActionButtonProps) {
  const buttonClasses = showCount
    ? "flex justify-center items-center flex-grow-0 flex-shrink-0 h-7 relative overflow-hidden gap-2 px-2 py-2.5 rounded-md border border-border-strong hover:bg-surface-mid transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
    : "flex flex-col justify-center items-center flex-grow-0 flex-shrink-0 h-7 w-7 relative overflow-hidden gap-2 px-[9px] py-2.5 rounded-md border border-border-strong hover:bg-surface-mid transition-colors disabled:opacity-50 disabled:cursor-not-allowed group";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={buttonClasses}
      aria-label={ariaLabel}
    >
      <div className="flex-grow-0 flex-shrink-0 w-4 h-4 relative text-text-weak group-hover:text-text-moderate transition-colors">
        {icon}
      </div>
      {showCount && count !== undefined && (
        <p className="flex-grow-0 flex-shrink-0 text-xs font-medium text-left text-text-weak group-hover:text-text-moderate transition-colors">
          {count}
        </p>
      )}
    </button>
  );
}
