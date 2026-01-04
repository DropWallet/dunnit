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
  // IMPORTANT: Only count achievements from games that have been started (playtime > 0)
  // AND where at least one achievement has been unlocked
  // AND with minimum playtime (Steam likely uses ~5 minutes to filter out games that were just launched)
  // This matches Steam's behavior - they only count achievements from games you've actually played
  const MIN_PLAYTIME_MINUTES = 10; // Minimum playtime to count achievements (Steam's threshold)
  
  allAchievements.forEach((achievements, appId) => {
    if (achievements.length > 0) {
      // Find the game to check if it's been started
      const game = games.find(g => g.appId === appId);
      
      // Only count achievements from games with sufficient playtime (started games with meaningful playtime)
      if (game && game.playtimeMinutes >= MIN_PLAYTIME_MINUTES) {
        // Check if at least one achievement is unlocked
        const unlocked = achievements.filter(a => a.unlocked).length;
        
        // Only count achievements from games where you've unlocked at least one
        // This matches Steam's behavior - games with no unlocks don't count toward stats
        if (unlocked > 0) {
          gamesWithAchievements++;
          totalAchievements += achievements.length;
          unlockedAchievements += unlocked;
        }
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
