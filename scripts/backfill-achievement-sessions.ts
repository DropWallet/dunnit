/**
 * Backfill script to populate game_sessions table with existing achievement sessions
 * 
 * This script:
 * 1. Queries all unlocked achievements within the lookback period (14 days)
 * 2. Groups them by user_id and app_id
 * 3. Within each group, sorts by unlocked_at and groups into sessions (4-hour window)
 * 4. Writes each session to game_sessions with type: 'achievement'
 * 
 * The script is idempotent - it checks for existing sessions and skips duplicates.
 * Safe to run multiple times.
 * 
 * Run with: npm run backfill-achievements
 */

// Load environment variables from .env.local
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getDataAccess } from '@/lib/data/access';
import { getSupabaseAdmin } from '@/lib/supabase/client';
import { writeAchievementSessions } from '@/lib/utils/achievement-sessions';
import type { AchievementSessionData } from '@/lib/utils/achievement-sessions';

const MAX_LOOKBACK_DAYS = 14;

/**
 * Group achievements into sessions based on 4-hour time window
 * Same logic as in achievement-sessions.ts
 */
function groupAchievementsIntoSessions(
  achievements: Array<{ unlocked_at: Date }>
): Array<{ sessionStart: Date; sessionEnd: Date; achievementCount: number }> {
  if (achievements.length === 0) {
    return [];
  }

  // Sort by unlocked_at (oldest first)
  const sorted = [...achievements].sort((a, b) => 
    a.unlocked_at.getTime() - b.unlocked_at.getTime()
  );

  const sessions: Array<{ sessionStart: Date; sessionEnd: Date; achievementCount: number }> = [];
  let currentSession: Array<{ unlocked_at: Date }> = [];
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  for (const achievement of sorted) {
    if (currentSession.length === 0) {
      currentSession = [achievement];
    } else {
      const lastAchievement = currentSession[currentSession.length - 1];
      const timeGap = achievement.unlocked_at.getTime() - lastAchievement.unlocked_at.getTime();

      // Same user + same game + within 4 hours = same session
      if (timeGap <= FOUR_HOURS_MS) {
        currentSession.push(achievement);
      } else {
        // End current session, start new one
        const first = currentSession[0];
        const last = currentSession[currentSession.length - 1];
        sessions.push({
          sessionStart: first.unlocked_at,
          sessionEnd: last.unlocked_at,
          achievementCount: currentSession.length,
        });
        currentSession = [achievement];
      }
    }
  }

  // Don't forget the last session
  if (currentSession.length > 0) {
    const first = currentSession[0];
    const last = currentSession[currentSession.length - 1];
    sessions.push({
      sessionStart: first.unlocked_at,
      sessionEnd: last.unlocked_at,
      achievementCount: currentSession.length,
    });
  }

  return sessions;
}

async function backfillAchievementSessions() {
  const dataAccess = getDataAccess();
  const supabase = getSupabaseAdmin();
  
  const lookbackDate = new Date(Date.now() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  
  console.log(`[Backfill] Starting backfill for achievements unlocked after ${lookbackDate.toISOString()}`);
  console.log(`[Backfill] Lookback period: ${MAX_LOOKBACK_DAYS} days`);
  
  // Get all unlocked achievements within lookback period
  // We'll process in batches to avoid memory issues
  let offset = 0;
  const batchSize = 1000;
  let totalProcessed = 0;
  let totalSessionsCreated = 0;
  
  while (true) {
    const { data: achievementData, error } = await supabase
      .from('user_achievements')
      .select('user_id, app_id, achievement_api_name, unlocked_at')
      .eq('unlocked', true)
      .not('unlocked_at', 'is', null)
      .gte('unlocked_at', lookbackDate.toISOString())
      .order('user_id')
      .order('app_id')
      .order('unlocked_at')
      .range(offset, offset + batchSize - 1);
    
    if (error) {
      console.error('[Backfill] Error fetching achievements:', error);
      break;
    }
    
    if (!achievementData || achievementData.length === 0) {
      console.log('[Backfill] No more achievements to process');
      break;
    }
    
    console.log(`[Backfill] Processing batch: ${achievementData.length} achievements (offset: ${offset})`);
    totalProcessed += achievementData.length;
    
    // Group by user_id and app_id
    const groupedByUserGame = new Map<string, typeof achievementData>();
    
    for (const achievement of achievementData) {
      const key = `${achievement.user_id}-${achievement.app_id}`;
      if (!groupedByUserGame.has(key)) {
        groupedByUserGame.set(key, []);
      }
      groupedByUserGame.get(key)!.push(achievement);
    }
    
    console.log(`[Backfill] Grouped into ${groupedByUserGame.size} user/game combinations`);
    
    // Process each user/game combination
    for (const [key, achievements] of groupedByUserGame) {
      const [userId, appIdStr] = key.split('-');
      const appId = parseInt(appIdStr, 10);
      
      // Convert to format with Date objects
      const achievementsWithDates = achievements
        .filter(ach => ach.unlocked_at)
        .map(ach => ({
          unlocked_at: new Date(ach.unlocked_at),
        }));
      
      if (achievementsWithDates.length === 0) continue;
      
      // Group into sessions (4-hour window)
      const sessions = groupAchievementsIntoSessions(achievementsWithDates);
      
      if (sessions.length > 0) {
        // Check if sessions already exist for this user/game to avoid duplicates
        const existingSessions = await dataAccess.getGameSessions([userId], 1000, 0, MAX_LOOKBACK_DAYS);
        const existingAchievementSessions = existingSessions.filter(
          s => s.appId === appId && s.type === 'achievement'
        );
        
        // Filter out sessions that already exist (within 1 minute tolerance for timestamp differences)
        const newSessions = sessions.filter(session => {
          const exists = existingAchievementSessions.some(existing => {
            const timeDiff = Math.abs(
              existing.sessionStart.getTime() - session.sessionStart.getTime()
            );
            return timeDiff < 60 * 1000; // Within 1 minute
          });
          return !exists;
        });
        
        if (newSessions.length > 0) {
          // Convert to AchievementSessionData format
          const sessionData: AchievementSessionData[] = newSessions.map(session => ({
            userId,
            appId,
            sessionStart: session.sessionStart,
            sessionEnd: session.sessionEnd,
            achievementCount: session.achievementCount,
          }));
          
          // Write to database (will handle cooldown merging automatically)
          await writeAchievementSessions(userId, appId, sessionData);
          totalSessionsCreated += sessionData.length;
          
          console.log(`[Backfill] Created ${sessionData.length} new sessions for ${userId}/${appId} (${sessions.length - newSessions.length} already existed)`);
        } else {
          console.log(`[Backfill] Skipping ${userId}/${appId} - all ${sessions.length} sessions already exist`);
        }
      }
    }
    
    // Check if we've processed all data
    if (achievementData.length < batchSize) {
      break;
    }
    
    offset += batchSize;
  }
  
  console.log(`[Backfill] Complete!`);
  console.log(`[Backfill] Total achievements processed: ${totalProcessed}`);
  console.log(`[Backfill] Total sessions created: ${totalSessionsCreated}`);
}

// Run the backfill
backfillAchievementSessions()
  .then(() => {
    console.log('[Backfill] Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Backfill] Script failed:', error);
    process.exit(1);
  });
