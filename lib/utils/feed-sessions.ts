import { calculateRarity, type AchievementRarity } from './achievements';

/**
 * Raw achievement row from database query
 */
export interface AchievementRow {
  user_id: string;
  app_id: number;
  achievement_api_name: string;
  unlocked_at: Date;
  username: string;
  avatar_url: string;
  profile_url: string;
  game_name: string;
  cover_image_url?: string;
  icon_url?: string;
  achievement_name: string;
  description: string;
  achievement_icon_url: string;
  achievement_icon_gray_url: string;
  global_percentage?: number;
  hidden: boolean;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  sessionStart: Date;
  sessionEnd: Date;
  duration: number;
  achievementCount: number;
  minRarity: AchievementRarity;
  minRarityPercentage?: number;
}

/**
 * Narrative label for a session
 */
export interface Narrative {
  type: 'multiple-unlocks' | 'rare-achievement' | 'first-time' | 'standard';
  label: string;
}

/**
 * Complete feed session
 */
export interface FeedSession {
  sessionId: string;
  user: {
    steamId: string;
    username: string;
    avatarUrl: string;
    profileUrl: string;
  };
  game: {
    appId: number;
    name: string;
    coverImageUrl?: string;
    iconUrl?: string;
  };
  sessionStart: Date;
  sessionEnd: Date;
  duration: number;
  durationFormatted: string;
  achievementCount: number;
  achievements: Array<{
    apiName: string;
    name: string;
    description: string;
    iconUrl: string;
    iconGrayUrl: string;
    unlockedAt: Date;
    globalPercentage?: number;
    rarity: AchievementRarity;
    hidden: boolean;
  }>;
  minRarity: AchievementRarity;
  minRarityPercentage?: number;
  narrative?: Narrative;
  relativeTime: string;
  timestamp: string;
  // Progress bar data
  totalGameAchievements: number;
  unlockedGameAchievements: number;
}

/**
 * Group achievements into sessions based on 4-hour time window
 * Sessions are groups of achievements from the same user and game
 * where consecutive achievements are within 4 hours of each other
 */
export function groupAchievementsIntoSessions(
  achievements: AchievementRow[]
): FeedSession[] {
  if (achievements.length === 0) {
    return [];
  }

  // Sort by unlocked_at (oldest first) for proper grouping
  const sorted = [...achievements].sort((a, b) => 
    a.unlocked_at.getTime() - b.unlocked_at.getTime()
  );

  const sessions: FeedSession[] = [];
  let currentSession: AchievementRow[] = [];
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  for (const achievement of sorted) {
    if (currentSession.length === 0) {
      // Start new session
      currentSession = [achievement];
    } else {
      const lastAchievement = currentSession[currentSession.length - 1];
      const timeGap = achievement.unlocked_at.getTime() - 
                      lastAchievement.unlocked_at.getTime();

      // Same user + same game + within 4 hours = same session
      if (
        achievement.user_id === lastAchievement.user_id &&
        achievement.app_id === lastAchievement.app_id &&
        timeGap <= FOUR_HOURS_MS
      ) {
        currentSession.push(achievement);
      } else {
        // End current session, start new one
        sessions.push(createSessionFromAchievements(currentSession));
        currentSession = [achievement];
      }
    }
  }

  // Don't forget the last session
  if (currentSession.length > 0) {
    sessions.push(createSessionFromAchievements(currentSession));
  }

  return sessions;
}

/**
 * Create a FeedSession from a group of achievements
 */
function createSessionFromAchievements(
  achievements: AchievementRow[]
): FeedSession {
  if (achievements.length === 0) {
    throw new Error('Cannot create session from empty achievements array');
  }

  const first = achievements[0];
  const last = achievements[achievements.length - 1];

  // Calculate session metadata
  const sessionStart = first.unlocked_at;
  const sessionEnd = last.unlocked_at;
  const duration = sessionEnd.getTime() - sessionStart.getTime();
  const metadata = calculateSessionMetadata(achievements);

  // Build achievement details
  const achievementDetails = achievements.map(ach => ({
    apiName: ach.achievement_api_name,
    name: ach.achievement_name,
    description: ach.description,
    iconUrl: ach.achievement_icon_url,
    iconGrayUrl: ach.achievement_icon_gray_url,
    unlockedAt: ach.unlocked_at,
    globalPercentage: ach.global_percentage,
    rarity: calculateRarity(ach.global_percentage),
    hidden: ach.hidden,
  }));

  // Generate session ID
  const sessionId = `${first.user_id}-${first.app_id}-${sessionStart.getTime()}`;

  // Create session
  const session: FeedSession = {
    sessionId,
    user: {
      steamId: first.user_id,
      username: first.username,
      avatarUrl: first.avatar_url,
      profileUrl: first.profile_url,
    },
    game: {
      appId: first.app_id,
      name: first.game_name,
      coverImageUrl: first.cover_image_url,
      iconUrl: first.icon_url,
    },
    sessionStart,
    sessionEnd,
    duration,
    durationFormatted: formatDuration(duration),
    achievementCount: achievements.length,
    achievements: achievementDetails,
    minRarity: metadata.minRarity,
    minRarityPercentage: metadata.minRarityPercentage,
    narrative: calculateNarrative(metadata, achievements.length),
    relativeTime: getRelativeTime(sessionEnd),
    timestamp: sessionEnd.toISOString(),
    // Default values - will be populated by API
    totalGameAchievements: 0,
    unlockedGameAchievements: 0,
  };

  return session;
}

/**
 * Calculate session metadata
 */
function calculateSessionMetadata(
  achievements: AchievementRow[]
): SessionMetadata {
  const sessionStart = achievements[0].unlocked_at;
  const sessionEnd = achievements[achievements.length - 1].unlocked_at;
  const duration = sessionEnd.getTime() - sessionStart.getTime();

  // Find minimum rarity (lowest percentage = rarest)
  let minRarity: AchievementRarity = 'common';
  let minRarityPercentage: number | undefined = undefined;

  for (const ach of achievements) {
    if (ach.global_percentage !== null && ach.global_percentage !== undefined) {
      if (minRarityPercentage === undefined || ach.global_percentage < minRarityPercentage) {
        minRarityPercentage = ach.global_percentage;
        minRarity = calculateRarity(ach.global_percentage);
      }
    }
  }

  return {
    sessionStart,
    sessionEnd,
    duration,
    achievementCount: achievements.length,
    minRarity,
    minRarityPercentage,
  };
}

/**
 * Format duration in milliseconds to human-readable string
 * Examples: "2h 15m", "45m", "5m"
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Get relative time string
 * Examples: "2 hours ago", "Yesterday", "3 days ago"
 */
export function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    // For older dates, show actual date
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

/**
 * Calculate narrative label for a session
 */
function calculateNarrative(
  metadata: SessionMetadata,
  achievementCount: number
): Narrative {
  // Multiple unlocks narrative
  if (achievementCount > 3) {
    return {
      type: 'multiple-unlocks',
      label: `Unlocked ${achievementCount} achievements`,
    };
  }

  // Rare achievement narrative
  if (metadata.minRarityPercentage !== undefined && metadata.minRarityPercentage < 5) {
    return {
      type: 'rare-achievement',
      label: 'Rare achievement unlocked',
    };
  }

  // Standard narrative (no special label)
  return {
    type: 'standard',
    label: `Unlocked ${achievementCount} ${achievementCount === 1 ? 'achievement' : 'achievements'}`,
  };
}

/**
 * Filter sessions by cooldown period
 * Only returns sessions where sessionEnd is at least cooldownMinutes ago
 */
export function filterSessionsByCooldown(
  sessions: FeedSession[],
  cooldownMinutes: number = 30
): FeedSession[] {
  const now = new Date();
  const cooldownMs = cooldownMinutes * 60 * 1000;

  return sessions.filter(session => {
    const timeSinceEnd = now.getTime() - session.sessionEnd.getTime();
    return timeSinceEnd >= cooldownMs;
  });
}
