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
  // Count all achievements from games where at least one achievement has been unlocked
  // (No playtime filter - show all achievements earned)
  allAchievements.forEach((achievements, appId) => {
    if (achievements.length > 0) {
      // Check if at least one achievement is unlocked
      const unlocked = achievements.filter(a => a.unlocked).length;
      
      // Only count achievements from games where you've unlocked at least one
      // This prevents games with no unlocks from counting toward stats
      if (unlocked > 0) {
        gamesWithAchievements++;
        totalAchievements += achievements.length;
        unlockedAchievements += unlocked;
      }
    }
  });
  
  // Calculate average completion rate
  // Match Steam's method: total unlocked achievements / total achievements * 100
  // Only counting achievements from started games (playtime > 0)
  const averageCompletionRate = totalAchievements > 0
    ? (unlockedAchievements / totalAchievements) * 100
    : 0;
  
  return {
    totalGames,
    startedGames,
    totalAchievements,
    unlockedAchievements,
    averageCompletionRate: Math.round(averageCompletionRate * 10) / 10, // Round to 1 decimal place
  };
}
