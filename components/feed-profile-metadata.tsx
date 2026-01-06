"use client";

import Link from "next/link";
import { useUserData } from "@/hooks/useUserData";
import { useUserStatistics } from "@/hooks/useUserStatistics";
import { getCountryFlag } from "@/lib/utils/country";
import { DotSeparator } from "@/components/dot-separator";

export function FeedProfileMetadata() {
  const { user, isLoading: isLoadingUser } = useUserData();
  const { statistics, isLoading: isLoadingStats } = useUserStatistics();

  if (isLoadingUser || !user) {
    return (
      <div className="flex flex-col justify-center items-start self-stretch flex-grow-0 flex-shrink-0 overflow-hidden rounded-lg bg-surface-low border border-border-weak">
        <div className="flex flex-col justify-center items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-3 p-4">
          <p className="text-text-subdued">Loading profile...</p>
        </div>
      </div>
    );
  }

  const formatJoinDate = (joinDate?: string | Date) => {
    if (!joinDate) return null;
    return new Date(joinDate).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });
  };

  return (
    <div className="flex flex-col justify-center items-start self-stretch flex-grow-0 flex-shrink-0 overflow-hidden rounded-lg bg-surface-low border border-border-weak">
      {/* Profile Header */}
      <div className="flex flex-col items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-3 p-4 xl:flex-row xl:items-center xl:gap-4">
        {/* Avatar - LG: 14x14, XL: 120x120 */}
        <img
          src={user.avatarUrl}
          alt={user.username}
          className="flex-grow-0 flex-shrink-0 w-14 h-14 xl:w-[120px] xl:h-[120px] rounded object-cover border border-border-strong"
        />
        
        {/* User Info */}
        <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 gap-4">
          <div className="flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 relative gap-1.5">
            {/* Username - LG: text-2xl, XL: text-3xl */}
            <p className="flex-grow-0 flex-shrink-0 text-2xl xl:text-3xl font-semibold text-center text-text-strong">
              {user.username}
            </p>
            
            {/* Country and Join Date */}
            <div className="flex justify-center items-center flex-grow-0 flex-shrink-0 relative gap-2">
              {user.countryCode && (
                <>
                  <span className="text-xs">{getCountryFlag(user.countryCode)}</span>
                  <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued">
                    {user.countryName || user.countryCode}
                  </p>
                  {user.joinDate && (
                    <>
                      <DotSeparator />
                      <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued">
                        Joined {formatJoinDate(user.joinDate)}
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* View Profile Button */}
          <Link
            href="/dashboard"
            className="flex justify-center items-center flex-grow-0 flex-shrink-0 h-10 relative gap-2 px-4 py-2 rounded-md bg-primary hover:bg-primary/90 text-background font-medium transition-colors"
          >
            <p className="flex-grow-0 flex-shrink-0 text-sm font-medium text-left">
              View profile
            </p>
          </Link>
        </div>
      </div>

      {/* Statistics Section */}
      <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 h-[132px] xl:h-auto relative gap-3 p-3 bg-surface-mid border-t border-border-weak lg:grid lg:grid-cols-2 lg:gap-0 xl:flex xl:flex-row xl:justify-start xl:gap-8 xl:px-4 xl:py-3">
        {isLoadingStats ? (
          <div className="col-span-2 xl:col-span-1">
            <p className="text-text-subdued text-xs">Loading statistics...</p>
          </div>
        ) : statistics ? (
          <>
            {/* Achievements */}
            <div className="flex flex-col justify-start items-start absolute left-3 top-3 xl:relative xl:left-0 xl:top-0 gap-0.5 rounded">
              <p className="flex-grow-0 flex-shrink-0 text-xl font-semibold text-center text-text-moderate">
                {statistics.unlockedAchievements.toLocaleString()}
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued">
                Achievements
              </p>
            </div>

            {/* Avg Completion Rate */}
            <div className="flex flex-col justify-start items-start absolute left-[155.5px] top-3 xl:relative xl:left-0 xl:top-0 gap-0.5 rounded">
              <p className="flex-grow-0 flex-shrink-0 text-xl font-semibold text-center text-text-moderate">
                {statistics.averageCompletionRate}%
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued">
                Avg completion rate
              </p>
            </div>

            {/* Games */}
            <div className="flex flex-col justify-start items-start absolute left-3 top-[66px] xl:relative xl:left-0 xl:top-0 gap-0.5 rounded">
              <p className="flex-grow-0 flex-shrink-0 text-xl font-semibold text-center text-text-moderate">
                {statistics.totalGames.toLocaleString()}
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued">
                Games
              </p>
            </div>

            {/* Started Games */}
            <div className="flex flex-col justify-start items-start absolute left-[155.5px] top-[66px] xl:relative xl:left-0 xl:top-0 gap-0.5 rounded">
              <p className="flex-grow-0 flex-shrink-0 text-xl font-semibold text-center text-text-moderate">
                {statistics.startedGames.toLocaleString()}
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued">
                Started games
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
