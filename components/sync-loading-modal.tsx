"use client";

import { cn } from "@/lib/utils";

interface SyncLoadingModalProps {
  isVisible: boolean;
}

export function SyncLoadingModal({ isVisible }: SyncLoadingModalProps) {
  return (
    <div 
      className={cn(
        "fixed bottom-0 left-0 right-0 flex justify-center items-center mb-12 z-toast pointer-events-none transition-all duration-300 ease-in-out",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      )}
    >
      <div className="flex flex-col items-center w-[315px] gap-1 px-6 py-5 rounded-lg bg-surface-low border border-border-weak shadow-2xl">
        <p className="text-sm font-semibold text-center text-text-strong">
          Tickling Steam & syncing dashboard,
        </p>
        <p className="text-sm text-center text-text-subdued leading-tight">
          This can take a while for large profiles, Steam can be a fickle beast.
        </p>
        {/* Loader Container */}
        <div className="loader mt-3" aria-hidden="true" />
      </div>
    </div>
  );
}
