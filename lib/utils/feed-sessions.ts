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
  type: 'multiple-unlocks' | 'rare-achievement' | 'first-time' | 'standard' | 'playtime-only';
  label: string;
  badgePath: string; // Path to badge SVG (e.g., '/bg-marathon.svg')
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
  minRarity?: AchievementRarity; // Optional for playtime-only sessions
  minRarityPercentage?: number;
  narrative?: Narrative;
  relativeTime: string;
  timestamp: string;
  // Progress bar data
  totalGameAchievements: number;
  unlockedGameAchievements: number;
  // Like data
  likeCount: number;
  isLiked: boolean;
  likedByUsers: Array<{ userId: string; avatarUrl: string }>;
  // Comment data
  commentCount: number;
  // Sync window metadata (for playtime sessions)
  syncWindowStart?: Date; // When the sync window started (playtimeLastSyncedAt)
  syncWindowEnd?: Date; // When the sync window ended (syncTime)
  isPlaytimeSession?: boolean; // Flag to distinguish playtime vs achievement sessions
}

/**
 * Group achievements into sessions based on 4-hour time window
 * Sessions are groups of achievements from the same user and game
 * where consecutive achievements are within 4 hours of each other
 */
export function groupAchievementsIntoSessions(
  achievements: AchievementRow[],
  playtimeDeltaMinutes?: number
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
  let isFirstSession = true; // Track if this is the first session to apply playtimeDelta

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
        // Apply playtimeDelta only to the first session
        const playtimeDelta = isFirstSession ? playtimeDeltaMinutes : undefined;
        sessions.push(createSessionFromAchievements(currentSession, playtimeDelta));
        isFirstSession = false;
        currentSession = [achievement];
      }
    }
  }

  // Don't forget the last session
  if (currentSession.length > 0) {
    const playtimeDelta = isFirstSession ? playtimeDeltaMinutes : undefined;
    sessions.push(createSessionFromAchievements(currentSession, playtimeDelta));
  }

  return sessions;
}

/**
 * Create a FeedSession from a group of achievements
 * @param playtimeDeltaMinutes Optional playtime delta in minutes. If provided, this will be used for duration instead of achievement unlock time span.
 */
function createSessionFromAchievements(
  achievements: AchievementRow[],
  playtimeDeltaMinutes?: number
): FeedSession {
  if (achievements.length === 0) {
    throw new Error('Cannot create session from empty achievements array');
  }

  const first = achievements[0];
  const last = achievements[achievements.length - 1];

  // Calculate session metadata
  let sessionStart = first.unlocked_at;
  const sessionEnd = last.unlocked_at;
  
  // Use playtimeDelta if provided, otherwise calculate from achievement unlock times
  let duration: number;
  if (playtimeDeltaMinutes !== undefined && playtimeDeltaMinutes > 0) {
    // Use actual playtime (convert minutes to milliseconds)
    duration = playtimeDeltaMinutes * 60 * 1000;
    // Adjust sessionStart to match the duration (sessionEnd - duration)
    const calculatedSessionStart = new Date(sessionEnd.getTime() - duration);
    // Use the earlier of: calculated start or first achievement unlock
    sessionStart = calculatedSessionStart < first.unlocked_at ? calculatedSessionStart : first.unlocked_at;
  } else {
    // Fallback to achievement unlock time span
    duration = sessionEnd.getTime() - sessionStart.getTime();
  }
  
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
    narrative: calculateNarrative(metadata, achievements.length, sessionId),
    relativeTime: getRelativeTime(sessionEnd),
    timestamp: sessionEnd.toISOString(),
    // Default values - will be populated by API
    totalGameAchievements: 0,
    unlockedGameAchievements: 0,
    likeCount: 0,
    isLiked: false,
    likedByUsers: [],
    commentCount: 0,
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
  
  // Minimum display time of 5 minutes
  const displayMinutes = Math.max(totalMinutes, 5);
  const hours = Math.floor(displayMinutes / 60);
  const minutes = displayMinutes % 60;

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
export function getRelativeTime(date: Date | string): string {
  const now = new Date();
  // Ensure date is a Date object
  const dateObj = date instanceof Date ? date : new Date(date);
  const diffMs = now.getTime() - dateObj.getTime();
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
    return dateObj.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: dateObj.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

/**
 * Seeded random number generator for consistent label selection
 * Uses sessionId as seed so the same session always gets the same label
 */
function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) / 2147483647; // Normalize to 0-1
}

/**
 * Select a random label from an array using seeded random
 */
function selectRandomLabel(labels: string[], seed: string): string {
  const random = seededRandom(seed);
  return labels[Math.floor(random * labels.length)];
}

/**
 * Calculate narrative label for an achievement session
 * Based on SESSION_LABEL_MATRIX.md decision logic
 */
function calculateNarrative(
  metadata: SessionMetadata,
  achievementCount: number,
  sessionId: string
): Narrative {
  // Rare = legendary, very-rare, or < 5% global percentage
  const isRare = metadata.minRarity === 'legendary' || 
                 metadata.minRarity === 'very-rare' || 
                 (metadata.minRarityPercentage !== undefined && metadata.minRarityPercentage < 5);

  // Decision logic in priority order (from SESSION_LABEL_MATRIX.md)
  
  // 1. Multiple Rare Achievements
  if (isRare && achievementCount > 1) {
    const labels = [
      'Rare collection',
      'Legendary streak',
      'Epic run',
      'Rare haul',
    ];
    return {
      type: 'rare-achievement',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-achievements.svg',
    };
  }

  // 2. Rare Achievement (single)
  if (isRare && achievementCount === 1) {
    const labels = [
      'Rare find',
      'Legendary unlock',
      'Epic achievement',
      'Rare trophy',
      'Legendary moment',
    ];
    return {
      type: 'rare-achievement',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-achievements.svg',
    };
  }

  // 3. Many Achievements (5+)
  if (achievementCount >= 5) {
    const labels = [
      'Achievement hunt',
      'Unlock marathon',
      'Trophy haul',
      'Achievement rush',
      'Unlock spree',
    ];
    return {
      type: 'multiple-unlocks',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-achievements.svg',
    };
  }

  // 4. Multiple Achievements (2-4)
  if (achievementCount > 1 && achievementCount < 5) {
    const labels = [
      'Achievement spree',
      'Unlock streak',
      'Trophy run',
      'Collection session',
      'Unlock binge',
    ];
    return {
      type: 'multiple-unlocks',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-achievements.svg',
    };
  }

  // 5. Single Achievement (fallback)
  const labels = [
    'Achievement unlocked',
    'Got one',
    'New trophy',
    'Nailed it',
  ];
  return {
    type: 'standard',
    label: selectRandomLabel(labels, sessionId),
    badgePath: '/bg-achievements.svg',
  };
}

/**
 * Calculate narrative label for a playtime-only session
 * Based on SESSION_LABEL_MATRIX.md decision logic
 */
function calculatePlaytimeNarrative(
  playtimeDeltaMinutes: number,
  syncWindowStart: Date,
  syncWindowEnd: Date,
  sessionId: string
): Narrative {
  // Calculate window duration
  const windowMs = syncWindowEnd.getTime() - syncWindowStart.getTime();
  const windowMinutes = windowMs / (1000 * 60);
  const windowHours = windowMinutes / 60;
  const windowDays = windowHours / 24;

  // Calculate intensity (playtime / window duration)
  const intensity = windowMinutes > 0 ? playtimeDeltaMinutes / windowMinutes : 0;

  // Decision logic in priority order (from SESSION_LABEL_MATRIX.md)
  
  // 1. Ultra Marathon (>= 8 hours)
  if (playtimeDeltaMinutes >= 480) {
    const labels = [
      'Absolute legend',
      'RSI king',
      'Ultra marathon',
      'Total commitment',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-ultra-marathon.svg',
    };
  }

  // 2. Marathon (> 5 hours in single day)
  if (playtimeDeltaMinutes >= 300 && windowDays < 1) {
    const labels = [
      'Marathon Session',
      'Staying power',
      "Retina's singed",
      'Iron bladder',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-marathon.svg',
    };
  }

  // 3. Zero Life Mode (>= 80% intensity)
  if (intensity >= 0.8) {
    const labels = [
      'Zero Life Mode',
      'No Distractions',
      'Fully Locked In',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-zero-life-mode.svg',
    };
  }

  // 4. High Intensity (>= 70% intensity, < 80%)
  if (intensity >= 0.7 && intensity < 0.8) {
    const labels = [
      'Grindset mindset',
      'In the zone',
      'Locked in',
      'Fully committed',
      'All in',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-high-intensity.svg',
    };
  }

  // 5. Long Window (7+ days)
  if (windowDays >= 7) {
    const labels = [
      'Slow burn',
      'The comeback',
      'Back at it',
      'The return',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-long-window.svg',
    };
  }

  // 6. Steady Progress (2-4 hours in 24h window)
  if (playtimeDeltaMinutes >= 120 && playtimeDeltaMinutes <= 240 && windowDays < 1.5) {
    const labels = [
      'Putting the hours in',
      'The usual',
      'Daily dose',
      'Regular grind',
      'The routine',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-steady-progress.svg',
    };
  }

  // 7. Casual (< 30% intensity, but >= 1 hour played)
  if (intensity < 0.3 && playtimeDeltaMinutes >= 60) {
    const labels = [
      'Casual vibes',
      'Taking it slow',
      'Chill session',
      'Easy does it',
      'Relaxed mode',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-casual.svg',
    };
  }

  // 8. Micro Session (< 15 min, high intensity >= 50%)
  if (playtimeDeltaMinutes < 15 && intensity >= 0.5) {
    const labels = [
      'Quick fix',
      'Speedrun',
      'Blink and miss',
      'Lightning round',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-zero-life-micro-session.svg',
    };
  }

  // 9. Short & Punchy (< 30 min) - fallback
  if (playtimeDeltaMinutes < 30) {
    const labels = [
      'Quick sesh',
      'Pop in',
      'Quick run',
      'Warm up',
      'Touch base',
      'Quick check',
    ];
    return {
      type: 'playtime-only',
      label: selectRandomLabel(labels, sessionId),
      badgePath: '/bg-short-and-punchy.svg',
    };
  }

  // Default fallback (shouldn't reach here, but just in case)
  return {
    type: 'playtime-only',
    label: 'Quick sesh',
    badgePath: '/bg-short-and-punchy.svg',
  };
}

/**
 * Create a FeedSession from playtime data (no achievements)
 * Uses sync window approach: sessionStart = syncWindowStart, sessionEnd = syncWindowEnd
 * Supports legacy sessions (when syncWindowStart/syncWindowEnd are old fake timestamps)
 */
export function createSessionFromPlaytime(
  userId: string,
  appId: number,
  playtimeDeltaMinutes: number,
  syncWindowStart: Date,
  syncWindowEnd: Date,
  user: {
    username: string;
    avatarUrl: string;
    profileUrl: string;
  },
  game: {
    name: string;
    coverImageUrl?: string;
    iconUrl?: string;
  }
): FeedSession {
  // Sync window: sessionStart = syncWindowStart, sessionEnd = syncWindowEnd
  // For legacy sessions, these are the old fake timestamps (still valid for display)
  const sessionStart = syncWindowStart;
  const sessionEnd = syncWindowEnd;
  const duration = sessionEnd.getTime() - sessionStart.getTime();

  // Detect legacy sessions: if duration is very small (< 1 minute) or very large (> 7 days),
  // it's likely a legacy session with fake timestamps
  // Legacy sessions: use old heuristic timestamps, not actual sync windows
  const isLegacySession = duration < 60 * 1000 || duration > 7 * 24 * 60 * 60 * 1000;

  // Generate session ID (include 'playtime' suffix to avoid collisions)
  const sessionId = `${userId}-${appId}-${sessionStart.getTime()}-playtime`;

  // Create session
  const session: FeedSession = {
    sessionId,
    user: {
      steamId: userId,
      username: user.username,
      avatarUrl: user.avatarUrl,
      profileUrl: user.profileUrl,
    },
    game: {
      appId,
      name: game.name,
      coverImageUrl: game.coverImageUrl,
      iconUrl: game.iconUrl,
    },
    sessionStart,
    sessionEnd,
    duration,
    durationFormatted: formatDuration(playtimeDeltaMinutes * 60 * 1000), // Use playtimeDelta for display
    achievementCount: 0,
    achievements: [],
    // minRarity and minRarityPercentage are undefined for playtime-only sessions
    narrative: calculatePlaytimeNarrative(playtimeDeltaMinutes, syncWindowStart, syncWindowEnd, sessionId),
    relativeTime: getRelativeTime(sessionEnd),
    timestamp: sessionEnd.toISOString(),
    // Default values - will be populated by API
    totalGameAchievements: 0,
    unlockedGameAchievements: 0,
    likeCount: 0,
    isLiked: false,
    likedByUsers: [],
    commentCount: 0,
    // Sync window metadata (only set for new sessions, not legacy)
    syncWindowStart: isLegacySession ? undefined : syncWindowStart,
    syncWindowEnd: isLegacySession ? undefined : syncWindowEnd,
    isPlaytimeSession: true, // Always true for playtime sessions (legacy or new)
  };

  return session;
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
