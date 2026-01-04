import { getCountryFlag } from "@/lib/utils/country";
import { DotSeparator } from "@/components/dot-separator";

interface FriendStatistics {
  totalGames: number;
  totalAchievements: number;
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
  statistics: FriendStatistics;
  statsLoaded?: boolean;
}

interface FriendCardProps {
  friend: Friend;
  isLoadingStats: boolean;
  onClick: () => void;
}

export function FriendCard({ friend, isLoadingStats, onClick }: FriendCardProps) {
  const hasStats = friend.statsLoaded && friend.statistics;

  return (
    <div
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
        {/* Stats - SM: stacked, MD: horizontal, LG: horizontal */}
        <div className="flex flex-col md:flex-row lg:flex-row justify-start items-start md:items-start lg:items-center flex-grow-0 flex-shrink-0 gap-3 md:gap-8 lg:gap-8">
          <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 relative gap-2">
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
                d="M7 21V19H11V15.9C10.1833 15.7167 9.45433 15.371 8.813 14.863C8.17167 14.355 7.70067 13.7173 7.4 12.95C6.15 12.8 5.10433 12.2543 4.263 11.313C3.42167 10.3717 3.00067 9.26733 3 8V5H7V3H17V5H21V8C21 9.26667 20.579 10.371 19.737 11.313C18.895 12.255 17.8493 12.8007 16.6 12.95C16.3 13.7167 15.8293 14.3543 15.188 14.863C14.5467 15.3717 13.8173 15.7173 13 15.9V19H17V21H7ZM7 10.8V7H5V8C5 8.63333 5.18333 9.20433 5.55 9.713C5.91667 10.2217 6.4 10.584 7 10.8ZM12 14C12.8333 14 13.5417 13.7083 14.125 13.125C14.7083 12.5417 15 11.8333 15 11V5H9V11C9 11.8333 9.29167 12.5417 9.875 13.125C10.4583 13.7083 11.1667 14 12 14ZM17 10.8C17.6 10.5833 18.0833 10.2207 18.45 9.712C18.8167 9.20333 19 8.63267 19 8V7H17V10.8Z"
                fill="currentColor"
                className="text-text-weak"
              />
            </svg>
            <p className="flex-grow-0 flex-shrink-0 text-base font-bold text-center text-text-weak">
              {isLoadingStats ? (
                <span className="text-text-subdued">Loading...</span>
              ) : hasStats ? (
                `${friend.statistics.totalAchievements.toLocaleString()} Achievements`
              ) : (
                <span className="text-text-subdued">—</span>
              )}
            </p>
          </div>
          <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 relative gap-2">
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
                d="M12 3C12.2652 3 12.5196 3.10536 12.7071 3.29289C12.8946 3.48043 13 3.73478 13 4V5H14.5C16.4891 5 18.3968 5.79018 19.8033 7.1967C21.2098 8.60322 22 10.5109 22 12.5C22 14.4891 21.2098 16.3968 19.8033 17.8033C18.3968 19.2098 16.4891 20 14.5 20H9.5C7.51088 20 5.60322 19.2098 4.1967 17.8033C2.79018 16.3968 2 14.4891 2 12.5C2 10.5109 2.79018 8.60322 4.1967 7.1967C5.60322 5.79018 7.51088 5 9.5 5H11V4C11 3.73478 11.1054 3.48043 11.2929 3.29289C11.4804 3.10536 11.7348 3 12 3ZM14.5 7H9.5C8.04131 7 6.64236 7.57946 5.61091 8.61091C4.57946 9.64236 4 11.0413 4 12.5C4 13.9587 4.57946 15.3576 5.61091 16.3891C6.64236 17.4205 8.04131 18 9.5 18H14.5C15.9587 18 17.3576 17.4205 18.3891 16.3891C19.4205 15.3576 20 13.9587 20 12.5C20 11.0413 19.4205 9.64236 18.3891 8.61091C17.3576 7.57946 15.9587 7 14.5 7ZM15.5 10C15.7449 10 15.9813 10.09 16.1644 10.2527C16.3474 10.4155 16.4643 10.6397 16.493 10.883L16.5 11V11.5H17C17.2549 11.5003 17.5 11.5979 17.6854 11.7728C17.8707 11.9478 17.9822 12.187 17.9972 12.4414C18.0121 12.6958 17.9293 12.9464 17.7657 13.1418C17.6021 13.3373 17.3701 13.4629 17.117 13.493L17 13.5H16.5V14C16.4997 14.2549 16.4021 14.5 16.2272 14.6854C16.0522 14.8707 15.813 14.9822 15.5586 14.9972C15.3042 15.0121 15.0536 14.9293 14.8582 14.7657C14.6627 14.6021 14.5371 14.3701 14.507 14.117L14.5 14V13.5H14C13.7451 13.4997 13.5 13.4021 13.3146 13.2272C13.1293 13.0522 13.0178 12.813 13.0028 12.5586C12.9879 12.3042 13.0707 12.0536 13.2343 11.8582C13.3979 11.6627 13.6299 11.5371 13.883 11.507L14 11.5H14.5V11C14.5 10.7348 14.6054 10.4804 14.7929 10.2929C14.9804 10.1054 15.2348 10 15.5 10ZM8.5 10C9.16304 10 9.79893 10.2634 10.2678 10.7322C10.7366 11.2011 11 11.837 11 12.5C11 13.163 10.7366 13.7989 10.2678 14.2678C9.79893 14.7366 9.16304 15 8.5 15C7.83696 15 7.20107 14.7366 6.73223 14.2678C6.26339 13.7989 6 13.163 6 12.5C6 11.837 6.26339 11.2011 6.73223 10.7322C7.20107 10.2634 7.83696 10 8.5 10ZM8.5 12C8.36739 12 8.24021 12.0527 8.14645 12.1464C8.05268 12.2402 8 12.3674 8 12.5C8 12.6326 8.05268 12.7598 8.14645 12.8536C8.24021 12.9473 8.36739 13 8.5 13C8.63261 13 8.75979 12.9473 8.85355 12.8536C8.94732 12.7598 9 12.6326 9 12.5C9 12.3674 8.94732 12.2402 8.85355 12.1464C8.75979 12.0527 8.63261 12 8.5 12Z"
                fill="currentColor"
                className="text-text-weak"
              />
            </svg>
            <p className="flex-grow-0 flex-shrink-0 text-base font-bold text-center text-text-weak">
              {isLoadingStats ? (
                <span className="text-text-subdued">Loading...</span>
              ) : hasStats ? (
                `${friend.statistics.totalGames.toLocaleString()} Games`
              ) : (
                <span className="text-text-subdued">—</span>
              )}
            </p>
          </div>
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
            <p className="flex-grow-0 flex-shrink-0 text-base font-bold text-center text-text-weak">
              {friend.statistics.friendsCount > 0 ? (
                `${friend.statistics.friendsCount} Friends`
              ) : (
                <span className="text-text-subdued">—</span>
              )}
            </p>
          </div>
        </div>

        {/* Country and Join Date - SM: bottom, MD: below stats, LG: hidden */}
        <div className="flex items-center justify-start relative gap-2">
          {friend.countryCode && (
            <>
              {(() => {
                const flag = getCountryFlag(friend.countryCode);
                // Check if flag exists and is not empty
                if (flag && flag.trim().length > 0) {
                  return <span className="text-lg">{flag}</span>;
                }
                // Show fallback when countryCode exists but no valid flag
                return (
                  <div className="w-6 h-6 rounded bg-surface-transparent-mid border border-border-subtle flex-shrink-0" />
                );
              })()}
              <p className="flex-grow-0 flex-shrink-0 text-xs text-center text-text-subdued lg:hidden">
                {friend.countryName}
              </p>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
