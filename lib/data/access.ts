import type { User, Game, UserGame, Achievement, UserAchievement } from './types';
import { SupabaseDataAccess } from './supabase-access';

/**
 * Data Access Layer - Supabase implementation
 * Falls back to in-memory for local development if Supabase is not configured
 */
export interface DataAccess {
  // User operations
  saveUser(user: User): Promise<void>;
  getUser(steamId: string): Promise<User | null>;
  updateUser(steamId: string, updates: Partial<User>): Promise<void>;

  // Game operations
  saveUserGames(userId: string, games: Game[]): Promise<void>;
  getUserGames(userId: string): Promise<Game[]>;
  getUserGame(userId: string, appId: number): Promise<Game | null>;

  // Achievement operations
  saveUserAchievements(
    userId: string,
    appId: number,
    achievements: Achievement[],
    unlockedAchievements: string[],
    unlockTimes?: Map<string, number>, // apiName -> unlocktime (Unix timestamp)
    globalPercentages?: Map<string, number> // apiName -> percentage
  ): Promise<void>;
  getUserAchievements(userId: string, appId: number): Promise<UserAchievement[]>;
  clearUserAchievements(userId: string, appId: number): Promise<void>;
  getAchievementLastSyncedAt(userId: string, appId: number): Promise<Date | null>;

  // Statistics operations
  getUserStatistics(userId: string): Promise<{ statistics: any; calculatedAt: Date } | null>;
  saveUserStatistics(userId: string, statistics: any): Promise<void>;
}

class InMemoryDataAccess implements DataAccess {
  private users = new Map<string, User>();
  private userGames = new Map<string, Map<number, Game>>(); // userId -> Map<appId, Game>
  private userAchievements = new Map<string, Map<number, Map<string, UserAchievement>>>(); // userId -> Map<appId, Map<apiName, UserAchievement>>

  async saveUser(user: User): Promise<void> {
    this.users.set(user.steamId, { ...user });
  }

  async getUser(steamId: string): Promise<User | null> {
    return this.users.get(steamId) || null;
  }

  async updateUser(steamId: string, updates: Partial<User>): Promise<void> {
    const user = this.users.get(steamId);
    if (user) {
      this.users.set(steamId, { ...user, ...updates, updatedAt: new Date() });
    }
  }

  async saveUserGames(userId: string, games: Game[]): Promise<void> {
    const gameMap = new Map<number, Game>();
    games.forEach((game) => {
      gameMap.set(game.appId, game);
    });
    this.userGames.set(userId, gameMap);
  }

  async getUserGames(userId: string): Promise<Game[]> {
    const gameMap = this.userGames.get(userId);
    if (!gameMap) {
      return [];
    }
    return Array.from(gameMap.values());
  }

  async getUserGame(userId: string, appId: number): Promise<Game | null> {
    const gameMap = this.userGames.get(userId);
    return gameMap?.get(appId) || null;
  }

  async saveUserAchievements(
    userId: string,
    appId: number,
    achievements: Achievement[],
    unlockedAchievements: string[],
    unlockTimes?: Map<string, number>,
    globalPercentages?: Map<string, number>
  ): Promise<void> {
    if (!this.userAchievements.has(userId)) {
      this.userAchievements.set(userId, new Map());
    }
    const appMap = this.userAchievements.get(userId)!;

    if (!appMap.has(appId)) {
      appMap.set(appId, new Map());
    }
    const achievementMap = appMap.get(appId)!;

    achievements.forEach((achievement) => {
      const isUnlocked = unlockedAchievements.includes(achievement.apiName);
      
      // Get unlock time from the map if available
      let unlockedAt: Date | undefined = undefined;
      if (isUnlocked && unlockTimes) {
        const unlockTime = unlockTimes.get(achievement.apiName);
        if (unlockTime) {
          unlockedAt = new Date(unlockTime * 1000); // Convert Unix timestamp to Date
        }
      }
      
      // Get global percentage if available
      const achievementWithPercentage: Achievement = {
        ...achievement,
        globalPercentage: globalPercentages?.get(achievement.apiName),
      };
      
      const userAchievement: UserAchievement = {
        userId,
        appId,
        achievement: achievementWithPercentage,
        unlocked: isUnlocked,
        unlockedAt,
      };
      achievementMap.set(achievement.apiName, userAchievement);
    });
  }

  async getUserAchievements(userId: string, appId: number): Promise<UserAchievement[]> {
    const appMap = this.userAchievements.get(userId);
    if (!appMap) {
      return [];
    }
    const achievementMap = appMap.get(appId);
    if (!achievementMap) {
      return [];
    }
    return Array.from(achievementMap.values());
  }

  async getAchievementLastSyncedAt(userId: string, appId: number): Promise<Date | null> {
    // In-memory doesn't track sync timestamps
    return null;
  }

  async clearUserAchievements(userId: string, appId: number): Promise<void> {
    const appMap = this.userAchievements.get(userId);
    if (appMap) {
      appMap.delete(appId);
    }
  }

  async getUserStatistics(userId: string): Promise<{ statistics: any; calculatedAt: Date } | null> {
    // In-memory doesn't cache statistics
    return null;
  }

  async saveUserStatistics(userId: string, statistics: any): Promise<void> {
    // In-memory doesn't cache statistics
  }
}

// Singleton instance - use globalThis to persist across module reloads
declare global {
  // eslint-disable-next-line no-var
  var __dunnit_dataAccess: DataAccess | undefined;
}

export function getDataAccess(): DataAccess {
  // Use Supabase if environment variables are set
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseDataAccess();
  }
  
  // Fallback to in-memory for local development
  console.warn('Supabase not configured, using in-memory data access. Data will not persist.');
  if (!globalThis.__dunnit_dataAccess) {
    globalThis.__dunnit_dataAccess = new InMemoryDataAccess();
  }
  return globalThis.__dunnit_dataAccess;
}
