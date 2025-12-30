import type { User, Game, UserGame, Achievement, UserAchievement } from './types';

/**
 * Data Access Layer - In-memory implementation
 * This can be easily swapped for a database implementation later
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
    unlockedAchievements: string[]
  ): Promise<void>;
  getUserAchievements(userId: string, appId: number): Promise<UserAchievement[]>;
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
    unlockedAchievements: string[]
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
      const userAchievement: UserAchievement = {
        userId,
        appId,
        achievement,
        unlocked: isUnlocked,
        unlockedAt: isUnlocked ? new Date() : undefined,
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
}

// Singleton instance - use globalThis to persist across module reloads
declare global {
  // eslint-disable-next-line no-var
  var __dunnit_dataAccess: DataAccess | undefined;
}

export function getDataAccess(): DataAccess {
  if (!globalThis.__dunnit_dataAccess) {
    globalThis.__dunnit_dataAccess = new InMemoryDataAccess();
  }
  return globalThis.__dunnit_dataAccess;
}
