import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSuspiciousSessions() {
  // Users to check
  const userIds = ['76561198024338178', '76561197964903395'];
  
  // Factorio app ID
  const factorioAppId = 427520;
  
  // Need to find StarRupture app ID - let's query for recent sessions for the first user
  console.log('Checking sessions for suspicious timestamps...\n');
  
  for (const userId of userIds) {
    console.log(`\n=== User ${userId} ===`);
    
    // Get all playtime sessions for this user from the last 7 days
    const { data: sessions, error } = await supabase
      .from('game_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'playtime')
      .gte('session_end', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('session_end', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error(`Error querying sessions for ${userId}:`, error);
      continue;
    }
    
    if (!sessions || sessions.length === 0) {
      console.log('No recent sessions found');
      continue;
    }
    
    console.log(`Found ${sessions.length} recent sessions:\n`);
    
    for (const session of sessions) {
      const sessionEnd = new Date(session.session_end);
      const createdAt = new Date(session.created_at);
      const now = new Date();
      const hoursSinceEnd = (now.getTime() - sessionEnd.getTime()) / (1000 * 60 * 60);
      const hoursSinceCreated = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      
      // Get game name
      const { data: game } = await supabase
        .from('user_games')
        .select('name')
        .eq('user_id', userId)
        .eq('app_id', session.app_id)
        .single();
      
      const gameName = game?.name || `App ID ${session.app_id}`;
      
      console.log(`  Game: ${gameName} (${session.app_id})`);
      console.log(`    Session End: ${sessionEnd.toISOString()} (${hoursSinceEnd.toFixed(1)} hours ago)`);
      console.log(`    Created At: ${createdAt.toISOString()} (${hoursSinceCreated.toFixed(1)} hours ago)`);
      console.log(`    Playtime Delta: ${session.playtime_delta}min`);
      console.log(`    Session Start: ${new Date(session.session_start).toISOString()}`);
      
      // Check if session_end is suspiciously recent (within last 2 hours)
      const isSuspicious = sessionEnd > new Date(now.getTime() - 2 * 60 * 60 * 1000);
      if (isSuspicious) {
        console.log(`    ⚠️  SUSPICIOUS: Session end is very recent (within 2 hours)`);
      }
      
      // Check if created_at is much older than session_end (legacy session)
      const timeDiff = createdAt.getTime() - sessionEnd.getTime();
      if (timeDiff > 24 * 60 * 60 * 1000) {
        console.log(`    ⚠️  LEGACY: Created ${(timeDiff / (1000 * 60 * 60)).toFixed(1)} hours AFTER session end (likely legacy session)`);
      }
      
      console.log('');
    }
  }
  
  // Also check for Factorio specifically
  console.log(`\n=== Factorio (427520) Sessions for ${userIds[1]} ===`);
  const { data: factorioSessions, error: factorioError } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('user_id', userIds[1])
    .eq('app_id', factorioAppId)
    .eq('type', 'playtime')
    .gte('session_end', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('session_end', { ascending: false });
  
  if (factorioError) {
    console.error('Error querying Factorio sessions:', factorioError);
  } else if (factorioSessions) {
    console.log(`Found ${factorioSessions.length} Factorio sessions in last 7 days`);
    for (const session of factorioSessions) {
      const sessionEnd = new Date(session.session_end);
      const createdAt = new Date(session.created_at);
      const now = new Date();
      const hoursSinceEnd = (now.getTime() - sessionEnd.getTime()) / (1000 * 60 * 60);
      
      console.log(`  Session End: ${sessionEnd.toISOString()} (${hoursSinceEnd.toFixed(1)} hours ago)`);
      console.log(`  Created At: ${createdAt.toISOString()}`);
      console.log(`  Playtime Delta: ${session.playtime_delta}min`);
      console.log('');
    }
  }
}

checkSuspiciousSessions()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
