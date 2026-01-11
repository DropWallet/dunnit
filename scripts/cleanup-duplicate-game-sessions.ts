#!/usr/bin/env tsx
/**
 * Script to clean up duplicate GameSession records in the game_sessions table.
 * 
 * This script identifies playtime sessions for the same user and game that have
 * the same session_start timestamp (rounded to nearest second) and keeps only
 * the one with the largest playtime_delta.
 * 
 * It uses the same deduplication logic as the feed route to ensure consistency.
 * 
 * Usage:
 *   # Dry run (default - shows what would be done)
 *   npx tsx scripts/cleanup-duplicate-game-sessions.ts
 * 
 *   # Actually execute the cleanup
 *   npx tsx scripts/cleanup-duplicate-game-sessions.ts --execute
 */

// Load environment variables from .env.local
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getSupabaseAdmin } from '../lib/supabase/client';

interface GameSession {
  id: string;
  user_id: string;
  app_id: number;
  session_start: string;
  session_end: string;
  playtime_delta: number;
  type: 'playtime' | 'achievement';
}

interface DuplicateGroup {
  key: string; // `${userId}-${appId}-${sessionStartTime}`
  sessions: GameSession[];
  keep: GameSession;
  delete: GameSession[];
}

async function cleanupDuplicateGameSessions() {
  const supabase = getSupabaseAdmin();
  
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log('🔍 Starting duplicate GameSession cleanup...\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'EXECUTE (will delete sessions)'}\n`);

  // Step 1: Fetch all playtime sessions
  const { data: allPlaytimeSessions, error: queryError } = await supabase
    .from('game_sessions')
    .select('id, user_id, app_id, session_start, session_end, playtime_delta, type')
    .eq('type', 'playtime')
    .order('session_start', { ascending: true });

  if (queryError) {
    console.error('❌ Error querying sessions:', queryError);
    process.exit(1);
  }

  if (!allPlaytimeSessions || allPlaytimeSessions.length === 0) {
    console.log('✅ No playtime sessions found. Nothing to clean up.');
    return;
  }

  console.log(`📊 Found ${allPlaytimeSessions.length} total playtime sessions\n`);

  // Step 2: Group sessions by (userId, appId, sessionStart rounded to nearest second)
  // This matches the deduplication logic in the feed route
  const sessionMap = new Map<string, GameSession[]>();
  
  allPlaytimeSessions.forEach(session => {
    // Round session_start to nearest second (same as feed deduplication)
    const sessionStartTime = Math.floor(new Date(session.session_start).getTime() / 1000) * 1000;
    const key = `${session.user_id}-${session.app_id}-${sessionStartTime}`;
    
    if (!sessionMap.has(key)) {
      sessionMap.set(key, []);
    }
    sessionMap.get(key)!.push(session);
  });

  // Step 3: Find groups with duplicates (more than 1 session)
  const duplicateGroups: DuplicateGroup[] = [];
  
  sessionMap.forEach((sessions, key) => {
    if (sessions.length > 1) {
      // Sort by:
      // 1. playtime_delta descending (prefer larger delta)
      // 2. Valid timestamps (start != end) over invalid ones
      // 3. Most recent end time (prefer most up-to-date)
      const sorted = [...sessions].sort((a, b) => {
        // First: compare by playtime_delta
        if (b.playtime_delta !== a.playtime_delta) {
          return b.playtime_delta - a.playtime_delta;
        }
        
        // Second: prefer valid timestamps (start != end)
        const aStart = new Date(a.session_start).getTime();
        const aEnd = new Date(a.session_end).getTime();
        const bStart = new Date(b.session_start).getTime();
        const bEnd = new Date(b.session_end).getTime();
        const aIsValid = aStart !== aEnd;
        const bIsValid = bStart !== bEnd;
        if (aIsValid !== bIsValid) {
          return aIsValid ? -1 : 1; // Valid comes first
        }
        
        // Third: prefer most recent end time
        return bEnd - aEnd;
      });
      
      const keep = sorted[0];
      const delete_ = sorted.slice(1);
      
      duplicateGroups.push({
        key,
        sessions,
        keep,
        delete: delete_,
      });
    }
  });

  if (duplicateGroups.length === 0) {
    console.log('✅ No duplicate GameSession records found. Nothing to clean up.');
    return;
  }

  console.log(`🔍 Found ${duplicateGroups.length} groups with duplicate GameSession records\n`);

  // Step 4: Show detailed breakdown
  let totalToDelete = 0;
  duplicateGroups.forEach(group => {
    totalToDelete += group.delete.length;
    
    const [userId, appId, sessionStartTime] = group.key.split('-');
    const sessionStart = new Date(parseInt(sessionStartTime));
    
    console.log(`\nDuplicate group: ${group.key}`);
    console.log(`  User: ${userId}`);
    console.log(`  Game: appId ${appId}`);
    console.log(`  Session Start: ${sessionStart.toISOString()}`);
    console.log(`  Keep: ${group.keep.id} (delta: ${group.keep.playtime_delta}min)`);
    console.log(`    - Start: ${group.keep.session_start}`);
    console.log(`    - End: ${group.keep.session_end}`);
    console.log(`  Delete: ${group.delete.length} session(s)`);
    group.delete.forEach(s => {
      console.log(`    - ${s.id} (delta: ${s.playtime_delta}min, start: ${s.session_start}, end: ${s.session_end})`);
    });
  });

  console.log(`\n📊 Summary:`);
  console.log(`   - Duplicate groups: ${duplicateGroups.length}`);
  console.log(`   - Sessions to delete: ${totalToDelete}`);
  console.log(`   - Sessions to keep: ${duplicateGroups.length}`);

  // Step 5: Execute or dry-run
  if (dryRun) {
    console.log('\n\n✅ DRY RUN COMPLETE');
    console.log(`💡 To actually perform the cleanup, run with --execute flag`);
  } else {
    console.log('\n\n🚀 EXECUTING CLEANUP...\n');
    
    let deletedCount = 0;
    let errorCount = 0;
    
    // Delete duplicate sessions
    for (const group of duplicateGroups) {
      for (const sessionToDelete of group.delete) {
        const { error: deleteError } = await supabase
          .from('game_sessions')
          .delete()
          .eq('id', sessionToDelete.id);

        if (deleteError) {
          console.error(`❌ Error deleting session ${sessionToDelete.id}:`, deleteError);
          errorCount++;
        } else {
          deletedCount++;
        }
      }
    }
    
    console.log('\n\n✅ CLEANUP COMPLETE');
    console.log(`📊 Summary:`);
    console.log(`   ✅ Deleted: ${deletedCount} duplicate sessions`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount}`);
    }
    console.log(`   📝 Kept: ${duplicateGroups.length} unique sessions (one per duplicate group)`);
  }
}

// Run the script
cleanupDuplicateGameSessions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
