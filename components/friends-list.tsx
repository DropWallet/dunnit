import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FriendCard } from "@/components/friend-card";

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

interface FriendsListProps {
  friends: Friend[];
  isLoading: boolean;
  sortBy: string;
  onSortChange: (value: string) => void;
  loadingFriendStats: Set<string>;
}

export function FriendsList({
  friends,
  isLoading,
  sortBy,
  onSortChange,
  loadingFriendStats,
}: FriendsListProps) {
  const router = useRouter();

  // Sort friends
  const sortedFriends = [...friends].sort((a: Friend, b: Friend) => {
    switch (sortBy) {
      case "achievements": {
        return (b.statistics.totalAchievements || 0) - (a.statistics.totalAchievements || 0);
      }
      case "name": {
        return a.username.localeCompare(b.username);
      }
      case "date-added": {
        // Since we don't have friendSince from Steam API, sort by joinDate as fallback
        const aDate = a.joinDate ? new Date(a.joinDate).getTime() : 0;
        const bDate = b.joinDate ? new Date(b.joinDate).getTime() : 0;
        return bDate - aDate;
      }
      default:
        return 0;
    }
  });

  return (
    <div className="flex flex-col gap-4 mt-4">
      {/* Sort Controls */}
      <div className="flex flex-col sm:flex-row flex-col-reverse justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger className="w-[200px] border-border-strong bg-surface-low text-text-strong">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent className="bg-surface-low border-border-strong">
              <SelectItem value="achievements" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                Achievements (amount)
              </SelectItem>
              <SelectItem value="name" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                Name (A-Z)
              </SelectItem>
              <SelectItem value="date-added" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
                Date added
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Friends List */}
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <p className="text-text-subdued">Loading friends...</p>
        </div>
      ) : sortedFriends.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg bg-surface-mid border border-border-strong">
          <p className="text-text-moderate text-lg mb-2">No friends found</p>
          <p className="text-text-subdued text-sm text-center">
            You don't have any Steam friends yet
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sortedFriends.map((friend: Friend) => {
            const isLoadingStats = loadingFriendStats.has(friend.steamId);
            return (
              <FriendCard
                key={friend.steamId}
                friend={friend}
                isLoadingStats={isLoadingStats}
                onClick={() => router.push(`/user/${friend.steamId}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
