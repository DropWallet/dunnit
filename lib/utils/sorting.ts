import type { Game } from '@/lib/data/types';

// Type for game achievement data (as stored in gameAchievements Map)
export interface GameAchievement {
  achievement: {
    name: string;
    description: string;
    iconUrl: string;
    iconGrayUrl: string;
    globalPercentage?: number;
  };
  unlocked: boolean;
  unlockedAt?: Date | string;
}

// Type for user achievement (from useUserAchievements hook)
export interface UserAchievement {
  achievement: {
    name: string;
    description: string;
    iconUrl: string;
    iconGrayUrl?: string;
    globalPercentage?: number;
    apiName?: string;
  };
  unlocked: boolean;
  unlockedAt?: Date;
  appId?: number;
  gameName?: string;
}

// Game sort options
export type GameSortOption = 
  | "last-played" 
  | "most-played" 
  | "least-played" 
  | "name-asc" 
  | "name-desc" 
  | "achievement-progress";

// Achievement sort options
export type AchievementSortOption = "rarity" | "unlock-date" | "name";

/**
 * Calculates a derived "last played" date for a game using a weighted fallback strategy.
 * 
 * This implements a three-tier fallback system similar to Steam Hunters:
 * 1. Priority 1: Uses `rtime_last_played` from Steam API if available
 * 2. Priority 2: Falls back to the most recent achievement unlock timestamp
 * 3. Priority 3: Returns undefined (will fall back to playtime-based sorting)
 * 
 * This is necessary because Steam's privacy settings often hide `rtime_last_played`
 * for friends' games, but achievement unlock times are typically still available.
 * 
 * @param game - The game object to calculate derived last played date for
 * @param gameAchievements - Map of appId to achievement arrays for the game
 * @returns Date object if a valid timestamp is found, undefined otherwise
 */
export function getDerivedLastPlayed(
  game: Game,
  gameAchievements: Map<number, GameAchievement[]>
): Date | undefined {
  const dates: Date[] = [];
  
  // Collect all available dates from different sources
  // Priority 1: Use rtime_last_played if available (from Steam API)
  if (game.lastPlayed) {
    dates.push(new Date(game.lastPlayed));
  }
  
  // Priority 2: Use cached derived_last_played if available (from database)
  // This provides immediate sorting without needing to fetch achievements
  if (game.derivedLastPlayed) {
    dates.push(new Date(game.derivedLastPlayed));
  }
  
  // Priority 3: Find most recent achievement unlock time from in-memory achievements map
  // This is the most up-to-date source (may include achievements just unlocked)
  const achievements = gameAchievements.get(game.appId) || [];
  if (achievements.length > 0) {
    const unlockedAchievements = achievements.filter(
      (ach): ach is GameAchievement & { unlockedAt: Date | string } => 
        ach.unlocked && ach.unlockedAt !== undefined
    );
    if (unlockedAchievements.length > 0) {
      // Find the most recent unlock time
      const mostRecentUnlock = unlockedAchievements.reduce((latest, current) => {
        const currentTime = current.unlockedAt instanceof Date 
          ? current.unlockedAt.getTime() 
          : new Date(current.unlockedAt).getTime();
        const latestTime = latest.unlockedAt instanceof Date 
          ? latest.unlockedAt.getTime() 
          : new Date(latest.unlockedAt).getTime();
        return currentTime > latestTime ? current : latest;
      });
      
      const unlockDate = mostRecentUnlock.unlockedAt instanceof Date 
        ? mostRecentUnlock.unlockedAt 
        : new Date(mostRecentUnlock.unlockedAt);
      dates.push(unlockDate);
    }
  }
  
  // Return the most recent date from all sources
  // This ensures we use the most accurate "last played" time, even if achievements
  // were unlocked more recently than the Steam API's lastPlayed timestamp
  if (dates.length === 0) {
    return undefined; // No date available (will fall back to playtime sorting)
  }
  
  // Find the most recent date
  return dates.reduce((latest, current) => {
    // Filter out invalid dates
    if (isNaN(latest.getTime())) return current;
    if (isNaN(current.getTime())) return latest;
    return current.getTime() > latest.getTime() ? current : latest;
  });
}

/**
 * Sorts games based on the specified sort option.
 * 
 * @param games - Array of games to sort
 * @param sortBy - Sort option to use
 * @param gameAchievements - Map of appId to achievement arrays (required for some sort options)
 * @returns Sorted array of games
 */
export function sortGames(
  games: Game[],
  sortBy: GameSortOption,
  gameAchievements: Map<number, GameAchievement[]>
): Game[] {
  return [...games].sort((a, b) => {
    switch (sortBy) {
      case "last-played": {
        // Use derivedLastPlayed which includes achievement unlock times as fallback
        const aDerived = getDerivedLastPlayed(a, gameAchievements);
        const bDerived = getDerivedLastPlayed(b, gameAchievements);
        const aLastPlayed = aDerived ? aDerived.getTime() : 0;
        const bLastPlayed = bDerived ? bDerived.getTime() : 0;
        
        // If both have derivedLastPlayed, sort by that
        if (aLastPlayed !== 0 && bLastPlayed !== 0) {
          return bLastPlayed - aLastPlayed;
        }
        
        // If one has derivedLastPlayed and the other doesn't, prioritize the one with it
        if (aLastPlayed !== 0 && bLastPlayed === 0) return -1;
        if (aLastPlayed === 0 && bLastPlayed !== 0) return 1;
        
        // Both are undefined - use playtime2WeeksMinutes as proxy for "recently played"
        // Games with recent playtime (last 2 weeks) should appear first
        const aRecent = a.playtime2WeeksMinutes || 0;
        const bRecent = b.playtime2WeeksMinutes || 0;
        
        // If one has recent playtime and the other doesn't, prioritize recent playtime
        if (aRecent > 0 && bRecent === 0) return -1;
        if (aRecent === 0 && bRecent > 0) return 1;
        
        // Both have recent playtime or both don't - sort by recent playtime, then total playtime
        if (aRecent !== bRecent) return bRecent - aRecent;
        return (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0);
      }
      case "most-played": {
        return (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0);
      }
      case "least-played": {
        return (a.playtimeMinutes || 0) - (b.playtimeMinutes || 0);
      }
      case "name-asc": {
        return a.name.localeCompare(b.name);
      }
      case "name-desc": {
        return b.name.localeCompare(a.name);
      }
      case "achievement-progress": {
        const aAchievements = gameAchievements.get(a.appId) || [];
        const bAchievements = gameAchievements.get(b.appId) || [];
        const aUnlocked = aAchievements.filter((ach) => ach.unlocked).length;
        const bUnlocked = bAchievements.filter((ach) => ach.unlocked).length;
        const aTotal = aAchievements.length;
        const bTotal = bAchievements.length;
        const aProgress = aTotal > 0 ? (aUnlocked / aTotal) * 100 : 0;
        const bProgress = bTotal > 0 ? (bUnlocked / bTotal) * 100 : 0;
        if (aProgress !== bProgress) return bProgress - aProgress;
        // Fallback to total achievements
        return bTotal - aTotal;
      }
      default:
        return 0;
    }
  });
}

/**
 * Sorts achievements based on the specified sort option.
 * 
 * @param achievements - Array of achievements to sort
 * @param sortBy - Sort option to use
 * @returns Sorted array of achievements
 */
export function sortAchievements(
  achievements: UserAchievement[],
  sortBy: AchievementSortOption
): UserAchievement[] {
  return [...achievements].sort((a, b) => {
    switch (sortBy) {
      case "rarity": {
        const aPercent = a.achievement?.globalPercentage ?? 100;
        const bPercent = b.achievement?.globalPercentage ?? 100;
        if (aPercent !== bPercent) return aPercent - bPercent;
        return a.achievement?.name.localeCompare(b.achievement?.name) ?? 0;
      }
      case "unlock-date": {
        const aDate = a.unlockedAt ? new Date(a.unlockedAt).getTime() : 0;
        const bDate = b.unlockedAt ? new Date(b.unlockedAt).getTime() : 0;
        if (aDate !== bDate) return bDate - aDate;
        return a.achievement?.name.localeCompare(b.achievement?.name) ?? 0;
      }
      case "name": {
        return a.achievement?.name.localeCompare(b.achievement?.name) ?? 0;
      }
      default:
        return 0;
    }
  });
}
