import type { Game, UserAchievement } from '@/lib/data/types';

export interface UserStatistics {
  totalGames: number;
  startedGames: number; // Games with playtime > 0
  totalAchievements: number;
  unlockedAchievements: number;
  averageCompletionRate: number; // Percentage
}

/**
 * Calculate user statistics from games and achievements
 */
export function calculateStatistics(
  games: Game[],
  allAchievements: Map<number, UserAchievement[]> // appId -> achievements
): UserStatistics {
  const totalGames = games.length;
  const startedGames = games.filter(game => game.playtimeMinutes > 0).length;
  
  let totalAchievements = 0;
  let unlockedAchievements = 0;
  let gamesWithAchievements = 0;
  
  // Calculate achievement statistics
  allAchievements.forEach((achievements, appId) => {
    if (achievements.length > 0) {
      gamesWithAchievements++;
      const unlocked = achievements.filter(a => a.unlocked).length;
      totalAchievements += achievements.length;
      unlockedAchievements += unlocked;
    }
  });
  
  // Calculate average completion rate
  // This is the average of completion rates per game, not total achievements / total unlocked
  let totalCompletionRate = 0;
  let gamesWithCompletion = 0;
  
  allAchievements.forEach((achievements, appId) => {
    if (achievements.length > 0) {
      const unlocked = achievements.filter(a => a.unlocked).length;
      const completionRate = (unlocked / achievements.length) * 100;
      totalCompletionRate += completionRate;
      gamesWithCompletion++;
    }
  });
  
  const averageCompletionRate = gamesWithCompletion > 0
    ? totalCompletionRate / gamesWithCompletion
    : 0;
  
  return {
    totalGames,
    startedGames,
    totalAchievements,
    unlockedAchievements,
    averageCompletionRate: Math.round(averageCompletionRate * 10) / 10, // Round to 1 decimal
  };
}
