import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FriendCard } from "@/components/friend-card";

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

interface FriendsListProps {
  friends: Friend[];
  isLoading: boolean;
  sortBy?: string;
  onSortChange?: (value: string) => void;
  loadingFriendStats: Set<string>;
  onFriendVisible?: (steamId: string) => void;
}

export function FriendsList({
  friends,
  isLoading,
  sortBy = "name",
  onSortChange,
  loadingFriendStats,
  onFriendVisible,
}: FriendsListProps) {
  const router = useRouter();
  const friendRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Sort friends based on sortBy prop, default to name
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
        return a.username.localeCompare(b.username);
    }
  });

  // Set up Intersection Observer for viewport-based loading
  useEffect(() => {
    if (!onFriendVisible) return;

    // Create observer with root margin to start loading slightly before visible
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const steamId = entry.target.getAttribute("data-steam-id");
            if (steamId) {
              onFriendVisible(steamId);
            }
          }
        });
      },
      {
        rootMargin: "200px", // Start loading 200px before friend card is visible
        threshold: 0.1,
      }
    );

    // Observe all friend cards
    friendRefs.current.forEach((element) => {
      if (element) {
        observerRef.current?.observe(element);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [sortedFriends, onFriendVisible]);

  // Update observer when friends change
  useEffect(() => {
    if (!observerRef.current) return;

    // Re-observe all friend cards
    friendRefs.current.forEach((element) => {
      if (element) {
        observerRef.current?.observe(element);
      }
    });
  }, [sortedFriends]);

  return (
    <div className="flex flex-col gap-4 mt-4">
      {/* Sort Controls - only show if onSortChange is provided */}
      {onSortChange && (
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
      )}

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
                ref={(el) => {
                  if (el) {
                    friendRefs.current.set(friend.steamId, el);
                    el.setAttribute("data-steam-id", friend.steamId);
                  } else {
                    friendRefs.current.delete(friend.steamId);
                  }
                }}
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
