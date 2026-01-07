import type { Game } from '@/lib/data/types';

// Flexible User interface that works with both hook and API types
interface User {
  communityVisibilityState?: number;
  [key: string]: any; // Allow any other properties
}

interface Statistics {
  totalGames: number;
  unlockedAchievements: number;
}

export type PrivacyState = 'public' | 'game-private' | 'private' | 'unknown';

export function detectPrivacyState(
  user: User | null,
  statistics: Statistics | null,
  games: Game[],
  isLoadingUser: boolean,
  isLoadingGames: boolean,
  achievementsCount?: number // Add achievements count parameter
): PrivacyState {
  if (!user || isLoadingUser) return 'unknown';
  
  // Strictly private (communityVisibilityState: 1 = Private, 2 = Friends Only)
  if (user.communityVisibilityState === 1 || user.communityVisibilityState === 2) {
    return 'private';
  }
  
  // Public profile (communityVisibilityState: 3 = Public)
  if (user.communityVisibilityState === 3) {
    // Wait for games to finish loading before determining game-private state
    if (isLoadingGames) return 'unknown';
    
    // Public profile with games but no achievements = Game Private
    const hasGameData = (statistics?.totalGames ?? 0) > 0 || games.length > 0;
    const hasAchievementData = (statistics?.unlockedAchievements ?? 0) > 0 || (achievementsCount ?? 0) > 0;
    
    // If we have games but no achievements, it's game-private
    if (hasGameData && !hasAchievementData) {
      return 'game-private';
    }
    
    // If we have both games and achievements, it's fully public
    if (hasGameData && hasAchievementData) {
      return 'public';
    }
    
    // If no game data at all, it's game-private (can't determine)
    return 'game-private';
  }
  
  return 'unknown';
}
