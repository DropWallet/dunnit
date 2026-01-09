import { getCountryFlag } from "@/lib/utils/country";
import { DotSeparator } from "@/components/dot-separator";

interface User {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string;
  countryName?: string;
  joinDate?: string | Date;
}

interface Statistics {
  totalGames: number;
  startedGames: number;
  totalAchievements: number;
  unlockedAchievements: number;
  averageCompletionRate: number;
}

interface UserProfileHeaderProps {
  user: User;
  statistics: Statistics | null;
  isLoadingStats: boolean;
}

export function UserProfileHeader({
  user,
  statistics,
  isLoadingStats,
}: UserProfileHeaderProps) {

  return (
    <div className="flex flex-col justify-start items-start gap-5 lg:flex-row lg:items-center lg:gap-10">
      {/* Avatar */}
      <img
        src={user.avatarUrl}
        alt={user.username}
        className="flex-shrink-0 w-40 h-40 rounded object-cover border border-border-strong"
      />
      
      {/* User Info and Statistics */}
      <div className="flex flex-col justify-start items-start gap-5 w-full md:w-auto">
        {/* User Info */}
        <div className="flex flex-col justify-start items-start gap-1.5">
          <p className="text-3xl font-semibold text-center text-text-strong">
            {user.username}
          </p>
          <div className="flex justify-center items-center gap-2">
            {user.countryCode && (
              <>
                <span className="text-xs">{getCountryFlag(user.countryCode)}</span>
                <p className="text-xs text-center text-text-subdued">
                  {user.countryName}
                </p>
                {user.joinDate && (
                  <>
                    <DotSeparator />
                    <p className="text-xs text-center text-text-subdued">
                      Joined {new Date(user.joinDate).toLocaleDateString('en-US', {
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

        {/* Statistics and Sync Progress Section */}
        <div className="flex flex-col md:flex-row gap-2 w-full">
          {/* Statistics Section */}
          {isLoadingStats ? (
            <div className="grid grid-cols-2 gap-0.5 p-1 rounded-lg bg-surface-mid border border-border-strong w-full md:w-auto md:flex md:justify-start md:items-center animate-pulse">
              {/* Achievements Skeleton */}
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <div className="h-9 md:h-8 w-20 bg-surface-low rounded" />
                <div className="h-3 w-16 bg-surface-low rounded mt-0.5" />
              </div>
              {/* Avg Completion Rate Skeleton */}
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <div className="h-9 md:h-8 w-12 bg-surface-low rounded" />
                <div className="h-3 w-24 bg-surface-low rounded mt-0.5" />
              </div>
              {/* Games Skeleton */}
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <div className="h-9 md:h-8 w-16 bg-surface-low rounded" />
                <div className="h-3 w-12 bg-surface-low rounded mt-0.5" />
              </div>
              {/* Started Games Skeleton */}
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <div className="h-9 md:h-8 w-16 bg-surface-low rounded" />
                <div className="h-3 w-20 bg-surface-low rounded mt-0.5" />
              </div>
            </div>
          ) : statistics ? (
            <div className="grid grid-cols-2 gap-0.5 p-1 rounded-lg bg-surface-mid border border-border-strong w-full md:w-auto md:flex md:justify-start md:items-center">
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                  {statistics.unlockedAchievements.toLocaleString()}
                </p>
                <p className="text-xs text-center text-text-subdued">Achievements</p>
              </div>
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                  {statistics.averageCompletionRate}%
                </p>
                <p className="text-xs text-center text-text-subdued">
                  Avg completion rate
                </p>
              </div>
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                  {statistics.totalGames.toLocaleString()}
                </p>
                <p className="text-xs text-center text-text-subdued">Games</p>
              </div>
              <div className="flex flex-col justify-start items-start gap-0.5 px-3 py-2.5 rounded">
                <p className="text-3xl md:text-2xl font-semibold text-center text-text-moderate">
                  {statistics.startedGames.toLocaleString()}
                </p>
                <p className="text-xs text-center text-text-subdued">Started games</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
