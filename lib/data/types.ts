// Internal data types for the application

export interface User {
  steamId: string;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  countryCode?: string; // ISO 3166-1 alpha-2 country code (e.g., "GB")
  countryName?: string; // Full country name (e.g., "United Kingdom")
  joinDate?: Date; // Steam account creation date
  communityVisibilityState?: number; // 1 = Private, 3 = Public
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
  derivedLastPlayed?: Date; // Latest achievement unlock time (fallback when lastPlayed is unavailable)
  derivedLastPlayedCalculatedAt?: Date; // When derived_last_played was calculated
}

export interface UserGame {
  userId: string;
  game: Game;
  addedAt: Date;
  updatedAt: Date;
}

export interface Achievement {
  appId: number;
  apiName: string;
  name: string;
  description: string;
  iconUrl: string;
  iconGrayUrl: string;
  hidden: boolean;
  globalPercentage?: number;
}

export interface UserAchievement {
  userId: string;
  appId: number;
  achievement: Achievement;
  unlocked: boolean;
  unlockedAt?: Date;
}
