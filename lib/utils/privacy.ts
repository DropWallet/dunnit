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
  isLoadingGames: boolean
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
    
    // Public profile but no game data = Game Private
    const hasGameData = (statistics?.totalGames ?? 0) > 0 || games.length > 0;
    return hasGameData ? 'public' : 'game-private';
  }
  
  return 'unknown';
}
