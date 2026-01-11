import type { UserAchievement } from '@/lib/data/types';
import { getDataAccess } from '@/lib/data/access';
import type { GameSession } from '@/lib/data/types';

/**
 * Achievement session data ready to be written to game_sessions table
 */
export interface AchievementSessionData {
  userId: string;
  appId: number;
  sessionStart: Date;
  sessionEnd: Date;
  achievementCount: number;
}

/**
 * Detect newly unlocked achievements by comparing old and new achievement lists
 */
function detectNewUnlocks(
  oldAchievements: UserAchievement[],
  newAchievements: UserAchievement[]
): UserAchievement[] {
  const oldUnlockedSet = new Set(
    oldAchievements
      .filter(a => a.unlocked && a.unlockedAt)
      .map(a => a.apiName)
  );

  return newAchievements.filter(a => 
    a.unlocked && 
    a.unlockedAt && 
    !oldUnlockedSet.has(a.apiName)
  );
}

/**
 * Group achievements into sessions based on 4-hour time window
 * Same logic as groupAchievementsIntoSessions but for UserAchievement[]
 */
function groupAchievementsIntoSessions(
  achievements: UserAchievement[]
): UserAchievement[][] {
  if (achievements.length === 0) {
    return [];
  }

  // Sort by unlockedAt (oldest first)
  const sorted = [...achievements].sort((a, b) => {
    const timeA = a.unlockedAt?.getTime() ?? 0;
    const timeB = b.unlockedAt?.getTime() ?? 0;
    return timeA - timeB;
  });

  const sessions: UserAchievement[][] = [];
  let currentSession: UserAchievement[] = [];
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  for (const achievement of sorted) {
    if (!achievement.unlockedAt) continue;

    if (currentSession.length === 0) {
      currentSession = [achievement];
    } else {
      const lastAchievement = currentSession[currentSession.length - 1];
      const lastTime = lastAchievement.unlockedAt?.getTime() ?? 0;
      const currentTime = achievement.unlockedAt.getTime();
      const timeGap = currentTime - lastTime;

      // Same user + same game + within 4 hours = same session
      if (timeGap <= FOUR_HOURS_MS) {
        currentSession.push(achievement);
      } else {
        // End current session, start new one
        sessions.push(currentSession);
        currentSession = [achievement];
      }
    }
  }

  // Don't forget the last session
  if (currentSession.length > 0) {
    sessions.push(currentSession);
  }

  return sessions;
}

/**
 * Detect new achievement unlocks and group them into sessions
 */
export function detectNewAchievementSessions(
  oldAchievements: UserAchievement[],
  newAchievements: UserAchievement[],
  userId: string,
  appId: number
): AchievementSessionData[] {
  // Find newly unlocked achievements
  const newUnlocks = detectNewUnlocks(oldAchievements, newAchievements);

  if (newUnlocks.length === 0) {
    return [];
  }

  // Group into sessions (4-hour window)
  const achievementGroups = groupAchievementsIntoSessions(newUnlocks);

  // Convert to AchievementSessionData
  return achievementGroups.map(group => {
    const first = group[0];
    const last = group[group.length - 1];
    
    return {
      userId,
      appId,
      sessionStart: first.unlockedAt!,
      sessionEnd: last.unlockedAt!,
      achievementCount: group.length,
    };
  });
}

/**
 * Find overlapping playtime sessions for a given achievement session
 * Returns sessions that overlap with the time window
 */
async function findOverlappingPlaytimeSessions(
  userId: string,
  appId: number,
  sessionStart: Date,
  sessionEnd: Date
): Promise<GameSession[]> {
  const dataAccess = getDataAccess();
  
  // Get all playtime sessions for this user/game
  const allSessions = await dataAccess.getGameSessions([userId], 1000, 0, 14);
  
  return allSessions.filter(session => {
    // Only playtime sessions
    if (session.type !== 'playtime') return false;
    // Same app
    if (session.appId !== appId) return false;
    // Check time overlap: sessions overlap if one starts before the other ends
    return session.sessionEnd >= sessionStart && session.sessionStart <= sessionEnd;
  });
}

/**
 * Delete overlapping playtime sessions (achievement sessions take precedence)
 * Returns both the count of deleted sessions and the total playtimeDelta
 */
async function deleteOverlappingPlaytimeSessions(
  userId: string,
  appId: number,
  sessionStart: Date,
  sessionEnd: Date
): Promise<{ deletedCount: number; totalPlaytimeDelta: number }> {
  const dataAccess = getDataAccess();
  const overlappingSessions = await findOverlappingPlaytimeSessions(
    userId,
    appId,
    sessionStart,
    sessionEnd
  );

  let deletedCount = 0;
  let totalPlaytimeDelta = 0;
  for (const session of overlappingSessions) {
    if (session.id) {
      // Capture playtimeDelta before deleting
      totalPlaytimeDelta += session.playtimeDelta || 0;
      await dataAccess.deleteGameSession(session.id);
      deletedCount++;
      console.log(`[Achievement Sessions] Deleted overlapping playtime session ${session.id} for user ${userId}, game ${appId} (playtimeDelta: ${session.playtimeDelta}min)`);
    }
  }

  return { deletedCount, totalPlaytimeDelta };
}

/**
 * Write achievement sessions to game_sessions table
 * Handles cooldown merging and overlap with playtime sessions
 */
export async function writeAchievementSessions(
  userId: string,
  appId: number,
  sessions: AchievementSessionData[]
): Promise<void> {
  if (sessions.length === 0) {
    return;
  }

  const dataAccess = getDataAccess();
  let sessionsCreated = 0;
  let sessionsMerged = 0;
  let playtimeSessionsDeleted = 0;

  for (const sessionData of sessions) {
    // Delete overlapping playtime sessions and capture their playtimeDelta
    const { deletedCount, totalPlaytimeDelta } = await deleteOverlappingPlaytimeSessions(
      userId,
      appId,
      sessionData.sessionStart,
      sessionData.sessionEnd
    );
    playtimeSessionsDeleted += deletedCount;

    // Check for recent achievement session (within 30 minutes) for cooldown merging
    const recentSession = await dataAccess.getRecentGameSession(userId, appId, 30, 'achievement');
    
    if (recentSession) {
      // Merge: extend session_end to the later one, keep earlier session_start
      // Preserve playtimeDelta from recent session, add any new playtimeDelta from deleted sessions
      const mergedPlaytimeDelta = (recentSession.playtimeDelta || 0) + totalPlaytimeDelta;
      const mergedSession: GameSession = {
        id: recentSession.id,
        userId,
        appId,
        playtimeDelta: mergedPlaytimeDelta, // Use captured playtimeDelta
        sessionStart: sessionData.sessionStart < recentSession.sessionStart 
          ? sessionData.sessionStart 
          : recentSession.sessionStart, // Keep earlier start
        sessionEnd: sessionData.sessionEnd > recentSession.sessionEnd 
          ? sessionData.sessionEnd 
          : recentSession.sessionEnd, // Keep later end
        type: 'achievement',
      };
      await dataAccess.saveGameSession(mergedSession);
      sessionsMerged++;
      console.log(`[Achievement Sessions] Merged session for game ${appId}: extended to ${mergedSession.sessionEnd.toISOString()}, playtimeDelta: ${mergedPlaytimeDelta}min`);
    } else {
      // Create new achievement session with captured playtimeDelta
      const newSession: GameSession = {
        userId,
        appId,
        playtimeDelta: totalPlaytimeDelta, // Use captured playtimeDelta
        sessionStart: sessionData.sessionStart,
        sessionEnd: sessionData.sessionEnd,
        type: 'achievement',
      };
      await dataAccess.saveGameSession(newSession);
      sessionsCreated++;
      console.log(`[Achievement Sessions] Created new session for game ${appId}: ${sessionData.achievementCount} achievements, ${sessionData.sessionStart.toISOString()} to ${sessionData.sessionEnd.toISOString()}, playtimeDelta: ${totalPlaytimeDelta}min`);
    }
  }

  if (sessionsCreated > 0 || sessionsMerged > 0) {
    console.log(`[Achievement Sessions] Session writing complete: ${sessionsCreated} created, ${sessionsMerged} merged, ${playtimeSessionsDeleted} playtime sessions deleted`);
  }
}
