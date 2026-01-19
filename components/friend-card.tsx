import { forwardRef } from "react";
import { getCountryFlag } from "@/lib/utils/country";
import { DotSeparator } from "@/components/dot-separator";
import { PrivateIcon } from "@/components/ui/private-icon";

interface FriendStatistics {
  totalGames: number;
  totalAchievements: number;
  unlockedAchievements: number;
  friendsCount: number;
}

interface Friend {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string;
  countryName?: string;
  joinDate?: string;
  communityVisibilityState?: number; // 1 = Private, 2 = Friends Only, 3 = Public
  statistics: FriendStatistics;
  statsLoaded?: boolean;
}

interface FriendCardProps {
  friend: Friend;
  isLoadingStats: boolean;
  onClick: () => void;
}

export const FriendCard = forwardRef<HTMLDivElement, FriendCardProps>(
  ({ friend, isLoadingStats, onClick }, ref) => {
  const hasStats = friend.statsLoaded && friend.statistics;
  const isPrivate = friend.communityVisibilityState === 1 || friend.communityVisibilityState === 2;

  return (
    <div
      ref={ref}
      onClick={onClick}
      className="flex flex-col md:flex-col lg:flex-row justify-start items-start md:items-start lg:items-center gap-4 pl-3 pr-8 pt-3 pb-3 md:pb-3 rounded-lg bg-surface-low border border-border-weak cursor-pointer hover:bg-surface-mid transition-colors"
    >
      {/* Avatar and Name - SM: stacked, MD: horizontal, LG: horizontal */}
      <div className="flex justify-start items-center self-stretch md:self-stretch lg:self-auto flex-grow relative gap-3">
        <img
          src={friend.avatarUrl}
          alt={friend.username}
          className="flex-grow-0 flex-shrink-0 w-14 h-14 rounded object-cover border border-border-strong"
        />
        <p className="flex-grow text-base font-bold text-left text-text-strong">
          {friend.username}
        </p>
      </div>

      {/* Stats and Country Wrapper - MD: flex-col, LG: flex-row */}
      <div className="flex flex-col md:flex-col lg:flex-row self-stretch md:self-stretch lg:self-auto gap-3 md:gap-4 lg:gap-8">
        {/* Friends Count - Always show with skeleton when loading */}
        {!isPrivate && (
          <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-grow-0 flex-shrink-0 w-6 h-6 relative"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                d="M7 17V18C7 18.2652 7.10536 18.5196 7.29289 18.7071C7.48043 18.8946 7.73478 19 8 19H16C16.2652 19 16.5196 18.8946 16.7071 18.7071C16.8946 18.5196 17 18.2652 17 18V17C17 16.2044 16.6839 15.4413 16.1213 14.8787C15.5587 14.3161 14.7956 14 14 14H10C9.20435 14 8.44129 14.3161 7.87868 14.8787C7.31607 15.4413 7 16.2044 7 17ZM15 8C15 8.79565 14.6839 9.55871 14.1213 10.1213C13.5587 10.6839 12.7956 11 12 11C11.2044 11 10.4413 10.6839 9.87868 10.1213C9.31607 9.55871 9 8.79565 9 8C9 7.20435 9.31607 6.44129 9.87868 5.87868C10.4413 5.31607 11.2044 5 12 5C12.7956 5 13.5587 5.31607 14.1213 5.87868C14.6839 6.44129 15 7.20435 15 8Z"
                stroke="currentColor"
                strokeWidth="2"
                className="text-text-weak"
              />
            </svg>
            {isLoadingStats ? (
              <div className="h-5 w-20 bg-surface-mid rounded animate-pulse" />
            ) : hasStats && typeof friend.statistics.friendsCount === 'number' ? (
              <p className="flex-grow-0 flex-shrink-0 text-base font-bold text-center text-text-weak">
                {friend.statistics.friendsCount.toLocaleString()} Friends
              </p>
            ) : (
              <div className="h-5 w-20 bg-surface-mid rounded animate-pulse" />
            )}
          </div>
        )}

        {/* Country and Join Date - SM: bottom, MD: below stats, LG: hidden */}
        {!isPrivate && (
          <div className="flex items-center justify-start relative gap-2">
            {(() => {
              const flag = friend.countryCode ? getCountryFlag(friend.countryCode) : null;
              // If no flag found, show globe
              return (
                <span className="text-lg inline-block flex-shrink-0" style={{ minWidth: '1.5rem' }} title={friend.countryName || "Location Private"}>
                  {flag || '🌐'}
                </span>
              );
            })()}
            {friend.countryName && (
              <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued lg:hidden">
                {friend.countryName}
              </p>
            )}
            {friend.joinDate && (
              <>
                <div className="lg:hidden">
                  <DotSeparator />
                </div>
                <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued lg:hidden">
                  Joined {new Date(friend.joinDate).toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric'
                  })}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Private profile indicator - Right side */}
      {isPrivate && (
        <div className="flex items-center gap-2 text-text-weak ml-0 lg:ml-auto">
          <PrivateIcon className="w-5 h-5 text-text-weak" />
          <span className="text-md font-bold">Private profile</span>
        </div>
      )}
    </div>
  );
});

FriendCard.displayName = "FriendCard";
