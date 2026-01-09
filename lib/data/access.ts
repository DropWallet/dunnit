import { SupabaseDataAccess } from './supabase-access';

// Type definitions
export interface User {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string;
  countryName?: string;
  joinDate?: Date;
  communityVisibilityState?: number;
  createdAt: Date;
  updatedAt: Date;
  lastSyncAt?: Date;
}

export interface Game {
  appId: number;
  name: string;
  playtimeMinutes: number;
  playtime2WeeksMinutes?: number;
  iconUrl?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  lastPlayed?: Date;
  derivedLastPlayed?: Date;
  derivedLastPlayedCalculatedAt?: Date;
  previousPlaytimeMinutes?: number;
  playtimeLastSyncedAt?: Date;
}

export interface Achievement {
  appId: number;
  apiName: string;
  name: string;
  description: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  hidden: boolean;
  globalPercentage?: number;
}

export interface UserAchievement {
  userId?: string;
  appId: number;
  achievement?: Achievement;
  unlocked?: boolean;
  unlockedAt?: Date;
  globalPercentage?: number;
  // For backward compatibility
  apiName?: string;
}

export interface GameSession {
  id?: string;
  userId: string;
  appId: number;
  playtimeDelta: number;
  sessionStart: Date;
  sessionEnd: Date;
  type: 'playtime' | 'achievement';
  createdAt?: Date;
  updatedAt?: Date;
}

// DataAccess interface - defines all methods that data access implementations must provide
export interface DataAccess {
  saveUser(user: User): Promise<void>;
  getUser(steamId: string): Promise<User | null>;
  updateUser(steamId: string, updates: Partial<User>): Promise<void>;
  saveUserGames(userId: string, games: Game[]): Promise<void>;
  getUserGames(userId: string): Promise<Game[]>;
  getUserGame(userId: string, appId: number): Promise<Game | null>;
  saveUserAchievements(
    userId: string,
    appId: number,
    achievements: Achievement[],
    unlockedAchievements: string[],
    unlockTimes?: Map<string, number>,
    globalPercentages?: Map<string, number>
  ): Promise<void>;
  getAchievementLastSyncedAt(userId: string, appId: number): Promise<Date | null>;
  getAllAchievementMetadataForUser(userId: string): Promise<Map<number, { hasAchievements: boolean; lastSyncedAt: Date | null }>>;
  getUserAchievements(userId: string, appId: number): Promise<UserAchievement[]>;
  clearUserAchievements(userId: string, appId: number): Promise<void>;
  getUserStatistics(userId: string): Promise<{ statistics: any; calculatedAt: Date } | null>;
  saveUserStatistics(userId: string, statistics: any): Promise<void>;
  getUserFriendsCount(steamId: string): Promise<{ count: number; syncedAt: Date | null } | null>;
  saveUserFriendsCount(steamId: string, count: number): Promise<void>;
  // Like methods
  likeSession(sessionId: string, userId: string): Promise<void>;
  unlikeSession(sessionId: string, userId: string): Promise<void>;
  getLikeCounts(sessionIds: string[]): Promise<Map<string, number>>;
  getUserLikes(sessionIds: string[], userId: string): Promise<Set<string>>;
  getLikedByUsers(sessionId: string, limit?: number): Promise<Array<{ userId: string; avatarUrl: string }>>;
  // Game session methods
  saveGameSession(session: GameSession): Promise<void>;
  getRecentGameSession(userId: string, appId: number, withinMinutes?: number, type?: 'playtime' | 'achievement'): Promise<GameSession | null>;
  getGameSessions(userIds: string[], limit?: number, offset?: number, lookbackDays?: number): Promise<GameSession[]>;
  getGameSessionCount(userIds: string[], lookbackDays?: number): Promise<number>;
  deleteGameSession(sessionId: string): Promise<void>;
}

// Singleton instance
let dataAccessInstance: DataAccess | null = null;

/**
 * Get the data access instance (singleton pattern)
 * Currently returns SupabaseDataAccess, but could be swapped for in-memory or other implementations
 */
export function getDataAccess(): DataAccess {
  if (!dataAccessInstance) {
    dataAccessInstance = new SupabaseDataAccess();
  }
  return dataAccessInstance;
}
