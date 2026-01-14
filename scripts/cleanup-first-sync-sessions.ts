#!/usr/bin/env tsx
/**
 * Script to clean up incorrect playtime sessions created during first sync.
 * 
 * When a user first signs up, their entire lifetime playtime gets treated as
 * a single session because there's no baseline to compare against. This script
 * removes those false sessions.
 * 
 * Strategy:
 * - Delete playtime sessions where session_end is before user.created_at
 *   (user couldn't have played before signing up)
 * - Also delete sessions with unrealistic deltas (>1000 minutes = ~16 hours)
 * 
 * Usage:
 *   # Dry run (default - shows what would be deleted)
 *   npx tsx scripts/cleanup-first-sync-sessions.ts 76561198044893261
 * 
 *   # Actually execute the cleanup
 *   npx tsx scripts/cleanup-first-sync-sessions.ts 76561198044893261 --execute
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

interface User {
  steam_id: string;
  created_at: string;
  last_sync_at: string | null;
}

async function cleanupFirstSyncSessions(userId: string) {
  const supabase = getSupabaseAdmin();
  
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log('🔍 Starting first-sync session cleanup...\n');
  console.log(`User ID: ${userId}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'EXECUTE (will delete sessions)'}\n`);

  // Get user's account creation date
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('steam_id, created_at, last_sync_at')
    .eq('steam_id', userId)
    .single();

  if (userError || !userData) {
    console.error(`❌ Error fetching user: ${userError?.message || 'User not found'}`);
    process.exit(1);
  }

  const user: User = userData;
  const accountCreatedAt = new Date(user.created_at);
  const firstSyncAt = user.last_sync_at ? new Date(user.last_sync_at) : accountCreatedAt;

  console.log(`📅 User account created: ${accountCreatedAt.toISOString()}`);
  console.log(`📅 First sync: ${firstSyncAt.toISOString()}\n`);

  // Get all playtime sessions for this user
  const { data: sessions, error: sessionsError } = await supabase
    .from('game_sessions')
    .select('id, user_id, app_id, session_start, session_end, playtime_delta, type')
    .eq('user_id', userId)
    .eq('type', 'playtime')
    .order('session_end', { ascending: false });

  if (sessionsError) {
    console.error(`❌ Error fetching sessions: ${sessionsError.message}`);
    process.exit(1);
  }

  if (!sessions || sessions.length === 0) {
    console.log('✅ No playtime sessions found for this user.');
    return;
  }

  console.log(`📊 Found ${sessions.length} total playtime sessions\n`);

  // Identify sessions to delete
  const sessionsToDelete: GameSession[] = [];
  const sessionsToKeep: GameSession[] = [];
  
  for (const session of sessions as GameSession[]) {
    const sessionEnd = new Date(session.session_end);
    const isBeforeAccountCreation = sessionEnd < accountCreatedAt;
    const hasUnrealisticDelta = session.playtime_delta > 1000; // >16 hours
    
    if (isBeforeAccountCreation || hasUnrealisticDelta) {
      sessionsToDelete.push(session);
    } else {
      sessionsToKeep.push(session);
    }
  }

  if (sessionsToDelete.length === 0) {
    console.log('✅ No incorrect sessions found. All sessions look valid.');
    return;
  }

  // Show detailed breakdown
  console.log(`🔍 Found ${sessionsToDelete.length} incorrect sessions to delete:\n`);
  
  let beforeAccountCreationCount = 0;
  let unrealisticDeltaCount = 0;
  
  sessionsToDelete.forEach(session => {
    const sessionEnd = new Date(session.session_end);
    const isBeforeAccountCreation = sessionEnd < accountCreatedAt;
    const hasUnrealisticDelta = session.playtime_delta > 1000;
    
    if (isBeforeAccountCreation) beforeAccountCreationCount++;
    if (hasUnrealisticDelta) unrealisticDeltaCount++;
    
    const reason = isBeforeAccountCreation 
      ? `session_end (${sessionEnd.toISOString()}) is before account creation`
      : `unrealistic delta (${session.playtime_delta}min = ${(session.playtime_delta / 60).toFixed(1)}h)`;
    
    console.log(`  🗑️  ${session.id}`);
    console.log(`     Game: appId ${session.app_id}, Delta: ${session.playtime_delta}min`);
    console.log(`     Reason: ${reason}`);
    console.log(`     Session end: ${sessionEnd.toISOString()}\n`);
  });

  console.log(`\n📊 Summary:`);
  console.log(`   Total sessions: ${sessions.length}`);
  console.log(`   Sessions to delete: ${sessionsToDelete.length}`);
  console.log(`     - Before account creation: ${beforeAccountCreationCount}`);
  console.log(`     - Unrealistic delta (>1000min): ${unrealisticDeltaCount}`);
  console.log(`   Sessions to keep: ${sessionsToKeep.length}`);

  // Execute or dry-run
  if (dryRun) {
    console.log('\n\n✅ DRY RUN COMPLETE');
    console.log(`💡 To actually perform the cleanup, run with --execute flag`);
  } else {
    console.log('\n\n🚀 EXECUTING CLEANUP...\n');
    
    const sessionIds = sessionsToDelete.map(s => s.id);
    
    const { error: deleteError } = await supabase
      .from('game_sessions')
      .delete()
      .in('id', sessionIds);

    if (deleteError) {
      console.error(`❌ Error deleting sessions: ${deleteError.message}`);
      process.exit(1);
    }

    console.log('\n\n✅ CLEANUP COMPLETE');
    console.log(`📊 Summary:`);
    console.log(`   ✅ Deleted: ${sessionsToDelete.length} incorrect sessions`);
    console.log(`   📝 Kept: ${sessionsToKeep.length} valid sessions`);
  }
}

// Get user ID from command line args
const userId = process.argv[2];

if (!userId) {
  console.error('❌ Error: User ID required');
  console.error('Usage: npx tsx scripts/cleanup-first-sync-sessions.ts <userId> [--execute]');
  process.exit(1);
}

// Run the script
cleanupFirstSyncSessions(userId)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
