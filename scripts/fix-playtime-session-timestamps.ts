#!/usr/bin/env tsx
/**
 * Script to fix playtime session timestamps
 * 
 * This corrects sessions that were created with incorrect session_end timestamps
 * (set to sync time instead of actual playtime end)
 * 
 * Usage:
 *   npx tsx scripts/fix-playtime-session-timestamps.ts
 * 
 * Or with tsx directly:
 *   tsx scripts/fix-playtime-session-timestamps.ts
 */

// Load environment variables from .env.local
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getSupabaseAdmin } from '../lib/supabase/client';

async function fixPlaytimeSessionTimestamps() {
  const supabase = getSupabaseAdmin();
  
  console.log('🔧 Starting playtime session timestamp fix...\n');

  // Step 1: Find all playtime sessions that might have incorrect timestamps
  // (sessions created after 2026-01-09 with session_end that seems wrong)
  // We'll filter in JavaScript since Supabase doesn't support SQL expressions in queries
  const { data: allSessions, error: queryError } = await supabase
    .from('game_sessions')
    .select('id, user_id, app_id, session_start, session_end, playtime_delta, type')
    .eq('type', 'playtime')
    .gte('session_end', '2026-01-09T00:00:00Z')
    .order('session_end', { ascending: false });

  if (queryError) {
    console.error('❌ Error querying sessions:', queryError);
    process.exit(1);
  }

  console.log(`📊 Found ${allSessions?.length || 0} total playtime sessions after 2026-01-09\n`);

  // Filter sessions that likely have incorrect timestamps:
  // 1. session_end is more than 1 hour after session_start (suggests sync time was used)
  // 2. OR session_end matches a known sync time pattern (multiple sessions with same end time)
  const sessionEndCounts = new Map<string, number>();
  (allSessions || []).forEach(session => {
    const endTime = new Date(session.session_end).toISOString();
    sessionEndCounts.set(endTime, (sessionEndCounts.get(endTime) || 0) + 1);
  });

  // Find session_end times that appear multiple times (likely sync times)
  const suspiciousEndTimes = new Set<string>();
  sessionEndCounts.forEach((count, endTime) => {
    if (count > 1) {
      suspiciousEndTimes.add(endTime);
    }
  });

  const sessionsToFix = (allSessions || []).filter(session => {
    const start = new Date(session.session_start);
    const end = new Date(session.session_end);
    const hoursDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const endTimeStr = end.toISOString();
    
    // Include if:
    // 1. More than 30 minutes difference (suggests sync time was used instead of actual end)
    // 2. OR matches suspicious sync time pattern (multiple sessions with same end time)
    return hoursDiff > 0.5 || suspiciousEndTimes.has(endTimeStr);
  });

  if (suspiciousEndTimes.size > 0) {
    console.log(`🔍 Found ${suspiciousEndTimes.size} suspicious session_end timestamps (appearing multiple times):`);
    Array.from(suspiciousEndTimes).slice(0, 5).forEach(time => {
      console.log(`   - ${time} (${sessionEndCounts.get(time)} sessions)`);
    });
    if (suspiciousEndTimes.size > 5) {
      console.log(`   ... and ${suspiciousEndTimes.size - 5} more`);
    }
    console.log('');
  }

  if (queryError) {
    console.error('❌ Error querying sessions:', queryError);
    process.exit(1);
  }

  if (!sessionsToFix || sessionsToFix.length === 0) {
    console.log('✅ No sessions need fixing!');
    return;
  }

  console.log(`📊 Found ${sessionsToFix.length} playtime sessions that may need fixing\n`);

  // Step 2: Get user_games data for these sessions
  const userIds = [...new Set(sessionsToFix.map(s => s.user_id))];
  const appIds = [...new Set(sessionsToFix.map(s => s.app_id))];

  const { data: userGames, error: gamesError } = await supabase
    .from('user_games')
    .select('user_id, app_id, last_played, name')
    .in('user_id', userIds)
    .in('app_id', appIds)
    .not('last_played', 'is', null);

  if (gamesError) {
    console.error('❌ Error querying user_games:', gamesError);
    process.exit(1);
  }

  const gamesMap = new Map(
    (userGames || []).map(g => [`${g.user_id}-${g.app_id}`, g])
  );

  // Step 3: Fix each session
  let fixedCount = 0;
  let skippedCount = 0;

  for (const session of sessionsToFix) {
    const gameKey = `${session.user_id}-${session.app_id}`;
    const game = gamesMap.get(gameKey);
    
    const sessionStart = new Date(session.session_start);
    const sessionEnd = new Date(session.session_end);
    const lastPlayed = game?.last_played ? new Date(game.last_played) : null;

    let newSessionEnd: Date | null = null;
    let fixStrategy = '';

    // Strategy 1: Use last_played if it's recent and within 24 hours of session_start
    if (lastPlayed && lastPlayed >= sessionStart) {
      const hoursDiff = (lastPlayed.getTime() - sessionStart.getTime()) / (1000 * 60 * 60);
      if (hoursDiff <= 24) {
        newSessionEnd = lastPlayed;
        fixStrategy = 'last_played';
      }
    }

    // Strategy 2: If no valid last_played, calculate from session_start + playtime_delta
    // Cap at 4 hours (240 minutes) to match achievement session logic
    if (!newSessionEnd) {
      const deltaMinutes = Math.min(session.playtime_delta, 240); // Cap at 4 hours
      newSessionEnd = new Date(sessionStart.getTime() + deltaMinutes * 60 * 1000);
      fixStrategy = 'calculated';
      
      // Don't make it later than the current session_end
      if (newSessionEnd > sessionEnd) {
        newSessionEnd = sessionEnd;
        fixStrategy = 'no_change_needed';
      }
    }

    const gameName = game?.name || `appId ${session.app_id}`;
    const hoursDiff = (sessionEnd.getTime() - sessionStart.getTime()) / (1000 * 60 * 60);

    // Only update if the new timestamp is different and more reasonable
    if (newSessionEnd.getTime() !== sessionEnd.getTime() && newSessionEnd <= sessionEnd) {
      const { error: updateError } = await supabase
        .from('game_sessions')
        .update({
          session_end: newSessionEnd.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      if (updateError) {
        console.error(`❌ Error updating session ${session.id}:`, updateError);
      } else {
        fixedCount++;
        console.log(`✅ Fixed: ${gameName} (${session.user_id})`);
        console.log(`   Strategy: ${fixStrategy}`);
        console.log(`   Old: ${sessionEnd.toISOString()} (${hoursDiff.toFixed(1)}h after start)`);
        console.log(`   New: ${newSessionEnd.toISOString()}`);
      }
    } else {
      skippedCount++;
      const reason = newSessionEnd.getTime() === sessionEnd.getTime() 
        ? 'no change needed' 
        : 'calculated time would be after current end';
      console.log(`⏭️  Skipped: ${gameName} (${session.user_id}) - ${reason}`);
      console.log(`   Current: ${sessionEnd.toISOString()} (${hoursDiff.toFixed(1)}h after start)`);
      console.log(`   Calculated: ${newSessionEnd.toISOString()} (strategy: ${fixStrategy})`);
      if (lastPlayed) {
        console.log(`   last_played: ${lastPlayed.toISOString()}`);
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Fixed: ${fixedCount} sessions`);
  console.log(`   ⏭️  Skipped: ${skippedCount} sessions`);
  console.log(`   📝 Total processed: ${sessionsToFix.length} sessions`);
  console.log(`\n✨ Done!`);
}

// Run the script
fixPlaytimeSessionTimestamps()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
