"use client";

import { Suspense, useState } from "react";
import { Navbar } from "@/components/navbar";
import { FeedSessionCard } from "@/components/feed-session-card";
import { FeedProfileMetadata } from "@/components/feed-profile-metadata";
import { FeedRecentlyPlayed } from "@/components/feed-recently-played";
import { useFeed } from "@/hooks/useFeed";
import { RefreshCw } from "lucide-react";

function FeedContent() {
  const { sessions, isLoading, isLoadingMore, error, hasMore, loadMore, refetch } = useFeed();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  return (
    <div className="min-h-screen bg-background pt-16">
      <Navbar />
      
      {/* Main Content Container */}
      <div className="px-4 py-8 sm:px-6 md:px-8 pb-20">
        <div className="mx-auto xl:max-w-[1280px]">
          {/* Two Column Layout - lg: 3-col grid, xl: 12-col grid */}
          <div className="lg:grid lg:grid-cols-3 lg:gap-8 xl:grid-cols-12">
            {/* Column 1: Feed Cards */}
            {/* lg: 2/3 width, xl: 7/12 width */}
            <div className="lg:col-span-2 xl:col-span-7">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-text-subdued">Loading feed...</p>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-text-subdued">Failed to load feed. Please try again later.</p>
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-text-subdued">No activity to show yet. Check back later!</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {sessions.map((session) => (
                    <FeedSessionCard
                      key={session.sessionId}
                      session={session}
                      totalGameAchievements={session.totalGameAchievements}
                      unlockedGameAchievements={session.unlockedGameAchievements}
                    />
                  ))}
                  
                  {/* Load More Button */}
                  {hasMore && (
                    <div className="flex items-center justify-center py-8">
                      <button
                        onClick={loadMore}
                        disabled={isLoadingMore}
                        className="px-6 py-2 rounded-md bg-surface-mid hover:bg-surface-high text-text-strong font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoadingMore ? "Loading..." : "Load More"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Column 2: Profile Metadata */}
            {/* lg: 1/3 width, xl: 5/12 width, hidden on smaller screens */}
            <div className="hidden lg:block lg:col-span-1 xl:col-span-5">
              <div className="sticky top-20">
                <FeedProfileMetadata />
                <div className="mt-8">
                  <FeedRecentlyPlayed />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Refresh Button - Fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center md:justify-end mr-4 pb-5 z-40">
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="px-4 py-2 rounded-md bg-surface-mid hover:bg-surface-high text-sm text-text-moderate font-normal transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-xl"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? "Refreshing..." : "Refresh Feed"}
        </button>
      </div>
    </div>
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background pt-16">
        <Navbar />
        <div className="flex items-center justify-center py-12">
          <p className="text-text-subdued">Loading...</p>
        </div>
      </div>
    }>
      <FeedContent />
    </Suspense>
  );
}