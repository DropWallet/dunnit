"use client";

import { Navbar } from "@/components/navbar";
import { FeedSessionCard } from "@/components/feed-session-card";
import { useFeed } from "@/hooks/useFeed";

export default function FeedPage() {
  const { sessions, isLoading, error } = useFeed();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Main Content Container */}
      <div className="px-4 py-8 sm:px-6 md:px-8">
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
                </div>
              )}
            </div>

            {/* Column 2: Profile Metadata */}
            {/* lg: 1/3 width, xl: 5/12 width, hidden on smaller screens */}
            <div className="hidden lg:block lg:col-span-1 xl:col-span-5">
              <div className="h-96 bg-surface-low rounded-lg">
                {/* Profile metadata will go here */}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}