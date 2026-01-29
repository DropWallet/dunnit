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
  isPrivate?: boolean; // Privacy flag: true when profile is private (401 from Steam API)
  createdAt: Date;
  updatedAt: Date;
  lastSyncAt?: Date;
  lastFeedSyncAttempt?: Date; // OPTIMIZATION #5: Prevents refresh spamming by tracking last sync attempt
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

export interface Comment {
  id: string;
  sessionId: string;
  userId: string;
  username: string;
  avatarUrl: string;
  content: string;
  isEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
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
  /** Batch fetch (total, unlocked) per (userId, appId). Excludes __zero_achievements__ placeholder. Key: `${userId}-${appId}` */
  getAchievementCountsBatch(keys: Array<{ userId: string; appId: number }>): Promise<Map<string, { total: number; unlocked: number }>>;
  clearUserAchievements(userId: string, appId: number): Promise<void>;
  getUserStatistics(userId: string): Promise<{ statistics: any; calculatedAt: Date } | null>;
  saveUserStatistics(userId: string, statistics: any): Promise<void>;
  calculateUserStatisticsFromDatabase(userId: string): Promise<any>; // Phase 2: SQL aggregation
  getUserFriendsCount(steamId: string): Promise<{ count: number; syncedAt: Date | null } | null>;
  saveUserFriendsCount(steamId: string, count: number): Promise<void>;
  // Like methods
  likeSession(sessionId: string, userId: string): Promise<void>;
  unlikeSession(sessionId: string, userId: string): Promise<void>;
  getLikeCounts(sessionIds: string[]): Promise<Map<string, number>>;
  getUserLikes(sessionIds: string[], userId: string): Promise<Set<string>>;
  getLikedByUsers(sessionId: string, limit?: number): Promise<Array<{ userId: string; avatarUrl: string }>>;
  // Comment methods
  createComment(sessionId: string, userId: string, content: string): Promise<Comment>;
  getComments(sessionId: string, limit?: number, offset?: number): Promise<{comments: Comment[], total: number}>;
  updateComment(commentId: string, userId: string, content: string): Promise<Comment>;
  deleteComment(commentId: string, userId: string): Promise<void>;
  getCommentCounts(sessionIds: string[]): Promise<Map<string, number>>;
  // Game session methods
  saveGameSession(session: GameSession): Promise<void>;
  getRecentGameSession(userId: string, appId: number, withinMinutes?: number, type?: 'playtime' | 'achievement'): Promise<GameSession | null>;
  getGameSessionByStartTime(userId: string, appId: number, sessionStart: Date, type?: 'playtime' | 'achievement'): Promise<GameSession | null>;
  getGameSessions(userIds: string[], limit?: number, offset?: number, lookbackDays?: number): Promise<GameSession[]>;
  getGameSessionCount(userIds: string[], lookbackDays?: number): Promise<number>;
  deleteGameSession(sessionId: string): Promise<void>;
  // Game baseline update method
  updateGameBaseline(userId: string, appId: number, currentPlaytimeMinutes: number): Promise<void>;
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
