#!/usr/bin/env tsx
/**
 * Script to clean up duplicate and overlapping playtime sessions
 * 
 * This script:
 * 1. Identifies duplicate/overlapping sessions (same user, game, overlapping time)
 * 2. Merges them intelligently (combines deltas, uses earliest start, latest end)
 * 3. Removes duplicates while preserving valid data
 * 4. Shows what will be deleted before doing it (dry-run mode)
 * 
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-sessions.ts [--dry-run]
 * 
 * Options:
 *   --dry-run: Show what would be deleted without actually deleting (default: true)
 *   --execute: Actually perform the deletions (requires explicit flag)
 */

// Load environment variables from .env.local
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getSupabaseAdmin } from '../lib/supabase/client';

interface Session {
  id: string;
  user_id: string;
  app_id: number;
  playtime_delta: number;
  session_start: string;
  session_end: string;
  type: string;
  created_at: string;
  updated_at: string;
}

interface SessionGroup {
  user_id: string;
  app_id: number;
  sessions: Session[];
}

interface MergePlan {
  keep: Session;
  delete: Session[];
  mergedDelta: number;
  mergedStart: Date;
  mergedEnd: Date;
  reason: string;
}

function sessionsOverlap(s1: Session, s2: Session): boolean {
  const start1 = new Date(s1.session_start);
  const end1 = new Date(s1.session_end);
  const start2 = new Date(s2.session_start);
  const end2 = new Date(s2.session_end);
  
  // Sessions overlap if one starts before the other ends
  return (start1 <= end2 && start2 <= end1);
}

function sessionContains(s1: Session, s2: Session): boolean {
  const start1 = new Date(s1.session_start);
  const end1 = new Date(s1.session_end);
  const start2 = new Date(s2.session_start);
  const end2 = new Date(s2.session_end);
  
  // s1 contains s2 if s2 is completely within s1
  return (start1 <= start2 && end1 >= end2);
}

function sessionsAreIdentical(s1: Session, s2: Session): boolean {
  return (
    s1.session_start === s2.session_start &&
    s1.session_end === s2.session_end &&
    s1.playtime_delta === s2.playtime_delta
  );
}

function isInvalidSession(session: Session): boolean {
  const start = new Date(session.session_start);
  const end = new Date(session.session_end);
  
  // Invalid if start equals end (zero duration)
  if (start.getTime() === end.getTime()) {
    return true;
  }
  
  // Invalid if end is before start
  if (end < start) {
    return true;
  }
  
  return false;
}

function createMergePlan(group: SessionGroup): MergePlan[] {
  const plans: MergePlan[] = [];
  const sessions = [...group.sessions];
  const processed = new Set<string>();
  
  // Pre-processing: Fix invalid sessions first
  // This ensures all sessions have valid start/end times before deduplication
  const invalidSessions = sessions.filter(s => isInvalidSession(s));
  const validSessions = sessions.filter(s => !isInvalidSession(s));
  
  if (invalidSessions.length > 0) {
    if (validSessions.length > 0) {
      // We have both valid and invalid sessions
      // Keep the best valid one, delete all invalid ones
      const best = validSessions.reduce((best, current) => 
        current.playtime_delta > best.playtime_delta ? current : best
      );
      plans.push({
        keep: best,
        delete: invalidSessions,
        mergedDelta: best.playtime_delta,
        mergedStart: new Date(best.session_start),
        mergedEnd: new Date(best.session_end),
        reason: 'Invalid sessions (start=end or end<start) - keeping valid session'
      });
      invalidSessions.forEach(s => processed.add(s.id));
      processed.add(best.id);
    } else {
      // All are invalid, keep the one with largest delta and fix it
      const best = invalidSessions.reduce((best, current) => 
        current.playtime_delta > best.playtime_delta ? current : best
      );
      
      // Fix invalid session: calculate proper end time from start + delta
      // Cap at 4 hours (240 minutes) to match achievement session logic
      const maxSessionMinutes = 4 * 60;
      const sessionMinutes = Math.min(best.playtime_delta, maxSessionMinutes);
      const fixedStart = new Date(best.session_start);
      const fixedEnd = new Date(fixedStart.getTime() + sessionMinutes * 60 * 1000);
      
      plans.push({
        keep: best,
        delete: invalidSessions.filter(s => s.id !== best.id),
        mergedDelta: best.playtime_delta,
        mergedStart: fixedStart,
        mergedEnd: fixedEnd,
        reason: 'All sessions invalid - fixing kept session (start + delta)'
      });
      invalidSessions.forEach(s => processed.add(s.id));
    }
  }
  
  // Second pass: Handle identical sessions
  const remaining = sessions.filter(s => !processed.has(s.id));
  const identicalGroups = new Map<string, Session[]>();
  
  remaining.forEach(session => {
    const key = `${session.session_start}-${session.session_end}-${session.playtime_delta}`;
    if (!identicalGroups.has(key)) {
      identicalGroups.set(key, []);
    }
    identicalGroups.get(key)!.push(session);
  });
  
  identicalGroups.forEach((identicalSessions, key) => {
    if (identicalSessions.length > 1) {
      // Keep the oldest one (first created), delete others
      const sorted = identicalSessions.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      plans.push({
        keep: sorted[0],
        delete: sorted.slice(1),
        mergedDelta: sorted[0].playtime_delta,
        mergedStart: new Date(sorted[0].session_start),
        mergedEnd: new Date(sorted[0].session_end),
        reason: 'Identical sessions (same start, end, delta)'
      });
      identicalSessions.forEach(s => processed.add(s.id));
    }
  });
  
  // Third pass: Handle subset sessions (one contains another)
  // Find the "top-level" containers (sessions that contain others but aren't contained themselves)
  const stillRemaining = sessions.filter(s => !processed.has(s.id));
  const subsetPlans = new Map<string, { container: Session; contained: Session[] }>();
  
  // First, find all containment relationships
  const containmentMap = new Map<string, { contains: Session[]; isContainedBy: Session | null }>();
  
  stillRemaining.forEach(session => {
    const contains: Session[] = [];
    let isContainedBy: Session | null = null;
    
    stillRemaining.forEach(other => {
      if (session.id === other.id) return;
      
      if (sessionContains(session, other)) {
        contains.push(other);
      } else if (sessionContains(other, session)) {
        isContainedBy = other;
      }
    });
    
    if (contains.length > 0 || isContainedBy) {
      containmentMap.set(session.id, { contains, isContainedBy });
    }
  });
  
  // Only create plans for top-level containers (not contained by anything)
  containmentMap.forEach((data, sessionId) => {
    if (data.isContainedBy === null && data.contains.length > 0) {
      const container = stillRemaining.find(s => s.id === sessionId)!;
      subsetPlans.set(sessionId, { container, contained: data.contains });
      processed.add(sessionId);
      data.contains.forEach(s => processed.add(s.id));
    }
  });
  
  subsetPlans.forEach(({ container, contained }) => {
    plans.push({
      keep: container,
      delete: contained,
      mergedDelta: container.playtime_delta,
      mergedStart: new Date(container.session_start),
      mergedEnd: new Date(container.session_end),
      reason: 'Subset sessions (one contains others)'
    });
  });
  
  // Fourth pass: Handle overlapping sessions (merge them)
  const finalRemaining = sessions.filter(s => !processed.has(s.id));
  const overlapGroups: Session[][] = [];
  const overlapProcessed = new Set<string>();
  
  finalRemaining.forEach(session => {
    if (overlapProcessed.has(session.id)) return;
    
    const group: Session[] = [session];
    overlapProcessed.add(session.id);
    
    finalRemaining.forEach(other => {
      if (overlapProcessed.has(other.id)) return;
      if (sessionsOverlap(session, other)) {
        group.push(other);
        overlapProcessed.add(other.id);
      }
    });
    
    if (group.length > 1) {
      overlapGroups.push(group);
    }
  });
  
  overlapGroups.forEach(group => {
    // Merge: combine deltas, use earliest start, latest end
    const mergedDelta = group.reduce((sum, s) => sum + s.playtime_delta, 0);
    const mergedStart = group.reduce((earliest, s) => {
      const start = new Date(s.session_start);
      return start < earliest ? start : earliest;
    }, new Date(group[0].session_start));
    const mergedEnd = group.reduce((latest, s) => {
      const end = new Date(s.session_end);
      return end > latest ? end : latest;
    }, new Date(group[0].session_end));
    
    // Keep the one with the largest delta, update it with merged values
    const best = group.reduce((best, current) => 
      current.playtime_delta > best.playtime_delta ? current : best
    );
    
    plans.push({
      keep: best,
      delete: group.filter(s => s.id !== best.id),
      mergedDelta,
      mergedStart,
      mergedEnd,
      reason: 'Overlapping sessions (merged)'
    });
  });
  
  return plans;
}

async function cleanupDuplicateSessions(dryRun: boolean = true) {
  const supabase = getSupabaseAdmin();
  
  console.log('🔍 Starting duplicate session cleanup...\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'EXECUTE (will delete sessions)'}\n`);
  
  // Step 1: Get all playtime sessions
  const { data: allSessions, error: queryError } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('type', 'playtime')
    .order('user_id')
    .order('app_id')
    .order('session_start');
  
  if (queryError) {
    console.error('❌ Error querying sessions:', queryError);
    process.exit(1);
  }
  
  if (!allSessions || allSessions.length === 0) {
    console.log('✅ No playtime sessions found. Nothing to clean up.');
    return;
  }
  
  console.log(`📊 Found ${allSessions.length} total playtime sessions\n`);
  
  // Step 2: Group by user_id and app_id
  const groups = new Map<string, SessionGroup>();
  
  allSessions.forEach((session: Session) => {
    const key = `${session.user_id}-${session.app_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        user_id: session.user_id,
        app_id: session.app_id,
        sessions: [],
      });
    }
    groups.get(key)!.sessions.push(session);
  });
  
  console.log(`📦 Grouped into ${groups.size} user-game combinations\n`);
  
  // Step 3: Find groups with multiple sessions (potential duplicates)
  const groupsWithDuplicates = Array.from(groups.values()).filter(
    g => g.sessions.length > 1
  );
  
  console.log(`🔍 Found ${groupsWithDuplicates.length} user-game combinations with multiple sessions\n`);
  
  if (groupsWithDuplicates.length === 0) {
    console.log('✅ No duplicate sessions found. Nothing to clean up.');
    return;
  }
  
  // Step 4: Create merge plans for each group
  const allPlans: MergePlan[] = [];
  let totalSessionsToDelete = 0;
  
  for (const group of groupsWithDuplicates) {
    const plans = createMergePlan(group);
    allPlans.push(...plans);
    plans.forEach(plan => {
      totalSessionsToDelete += plan.delete.length;
    });
  }
  
  console.log(`📋 Created ${allPlans.length} merge plans`);
  console.log(`🗑️  Total sessions to delete: ${totalSessionsToDelete}\n`);
  
  // Step 5: Show detailed breakdown
  console.log('📝 Detailed breakdown:\n');
  
  for (const plan of allPlans) {
    const gameName = `appId ${plan.keep.app_id}`;
    console.log(`\n${plan.reason}:`);
    console.log(`  User: ${plan.keep.user_id}`);
    console.log(`  Game: ${gameName}`);
    console.log(`  Keep: ${plan.keep.id}`);
    console.log(`    - Start: ${plan.keep.session_start}`);
    console.log(`    - End: ${plan.keep.session_end}`);
    console.log(`    - Delta: ${plan.keep.playtime_delta}min`);
    if (plan.mergedDelta !== plan.keep.playtime_delta || 
        plan.mergedStart.toISOString() !== plan.keep.session_start ||
        plan.mergedEnd.toISOString() !== plan.keep.session_end) {
      console.log(`  → Will update to:`);
      console.log(`    - Start: ${plan.mergedStart.toISOString()}`);
      console.log(`    - End: ${plan.mergedEnd.toISOString()}`);
      console.log(`    - Delta: ${plan.mergedDelta}min`);
    }
    console.log(`  Delete: ${plan.delete.length} session(s)`);
    plan.delete.forEach(s => {
      console.log(`    - ${s.id} (${s.session_start} to ${s.session_end}, ${s.playtime_delta}min)`);
    });
  }
  
  // Step 6: Validate plans (check for conflicts)
  const sessionsToKeep = new Set(allPlans.map(p => p.keep.id));
  const sessionsToDelete = new Set<string>();
  allPlans.forEach(plan => {
    plan.delete.forEach(s => sessionsToDelete.add(s.id));
  });
  
  // Check for conflicts (session marked both keep and delete)
  const conflicts = Array.from(sessionsToKeep).filter(id => sessionsToDelete.has(id));
  if (conflicts.length > 0) {
    console.error('\n❌ ERROR: Found conflicts in merge plans!');
    console.error(`   Sessions marked both keep and delete: ${conflicts.join(', ')}`);
    console.error('   This should not happen. Please review the script logic.');
    process.exit(1);
  }
  
  // Step 7: Execute or dry-run
  if (dryRun) {
    console.log('\n\n✅ DRY RUN COMPLETE');
    console.log(`📊 Summary:`);
    console.log(`   - Groups processed: ${groupsWithDuplicates.length}`);
    console.log(`   - Merge plans: ${allPlans.length}`);
    console.log(`   - Sessions to delete: ${totalSessionsToDelete}`);
    console.log(`   - Sessions to update: ${allPlans.filter(p => 
      p.mergedDelta !== p.keep.playtime_delta || 
      p.mergedStart.toISOString() !== p.keep.session_start ||
      p.mergedEnd.toISOString() !== p.keep.session_end
    ).length}`);
    console.log('\n💡 To actually perform the cleanup, run with --execute flag');
  } else {
    console.log('\n\n🚀 EXECUTING CLEANUP...\n');
    
    let deletedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    
    // Delete sessions first
    for (const plan of allPlans) {
      for (const sessionToDelete of plan.delete) {
        const { error: deleteError } = await supabase
          .from('game_sessions')
          .delete()
          .eq('id', sessionToDelete.id);
        
        if (deleteError) {
          console.error(`❌ Error deleting session ${sessionToDelete.id}:`, deleteError);
          errorCount++;
        } else {
          deletedCount++;
          if (deletedCount % 10 === 0) {
            console.log(`   Deleted ${deletedCount} sessions...`);
          }
        }
      }
    }
    
    // Then update kept sessions
    for (const plan of allPlans) {
      const needsUpdate = 
        plan.mergedDelta !== plan.keep.playtime_delta ||
        plan.mergedStart.toISOString() !== plan.keep.session_start ||
        plan.mergedEnd.toISOString() !== plan.keep.session_end;
      
      if (needsUpdate) {
        const { error: updateError } = await supabase
          .from('game_sessions')
          .update({
            playtime_delta: plan.mergedDelta,
            session_start: plan.mergedStart.toISOString(),
            session_end: plan.mergedEnd.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', plan.keep.id);
        
        if (updateError) {
          console.error(`❌ Error updating session ${plan.keep.id}:`, updateError);
          errorCount++;
        } else {
          updatedCount++;
        }
      }
    }
    
    console.log('\n✅ CLEANUP COMPLETE');
    console.log(`📊 Summary:`);
    console.log(`   ✅ Deleted: ${deletedCount} sessions`);
    console.log(`   ✅ Updated: ${updatedCount} sessions`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount}`);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

// Run the script
cleanupDuplicateSessions(dryRun)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
