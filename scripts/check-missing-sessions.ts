import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

import { getSupabaseAdmin } from '@/lib/supabase/client';

const USER_ID = '76561197964903395';
const ALBION_ONLINE_APP_ID = 761890; // Correct app ID
const ARMA_REFORGER_APP_ID = 1874880; // Correct app ID

async function checkMissingSessions() {
  const supabase = getSupabaseAdmin();

  console.log('='.repeat(80));
  console.log(`Checking database for user ${USER_ID}`);
  console.log(`Games: Albion Online (${ALBION_ONLINE_APP_ID}), Arma Reforger (${ARMA_REFORGER_APP_ID})`);
  console.log('='.repeat(80));
  console.log('');

  // 1. Check user sync status
  console.log('1. USER SYNC STATUS:');
  console.log('-'.repeat(80));
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('steam_id, username, last_sync_at, last_feed_sync_attempt, created_at')
    .eq('steam_id', USER_ID)
    .single();

  if (userError) {
    console.error('Error fetching user:', userError);
  } else if (user) {
    console.log(`User: ${user.username} (${user.steam_id})`);
    console.log(`Last sync: ${user.last_sync_at ? new Date(user.last_sync_at).toISOString() : 'NEVER'}`);
    console.log(`Last feed sync attempt: ${user.last_feed_sync_attempt ? new Date(user.last_feed_sync_attempt).toISOString() : 'NEVER'}`);
    console.log(`Created at: ${new Date(user.created_at).toISOString()}`);
  } else {
    console.log('❌ User not found in database');
  }
  console.log('');

  // 2. Check if games exist in user_games
  console.log('2. GAMES IN user_games TABLE:');
  console.log('-'.repeat(80));
  const { data: games, error: gamesError } = await supabase
    .from('user_games')
    .select('*')
    .eq('user_id', USER_ID)
    .in('app_id', [ALBION_ONLINE_APP_ID, ARMA_REFORGER_APP_ID]);

  if (gamesError) {
    console.error('Error fetching games:', gamesError);
  } else if (games && games.length > 0) {
    games.forEach(game => {
      console.log(`\nGame: ${game.name} (${game.app_id})`);
      console.log(`  Playtime: ${game.playtime_minutes} minutes`);
      console.log(`  Playtime 2 weeks: ${game.playtime_2weeks_minutes || 0} minutes`);
      console.log(`  Previous playtime: ${game.previous_playtime_minutes ?? 'NULL'}`);
      console.log(`  Last played: ${game.last_played ? new Date(game.last_played).toISOString() : 'NULL'}`);
      console.log(`  Derived last played: ${game.derived_last_played ? new Date(game.derived_last_played).toISOString() : 'NULL'}`);
      console.log(`  Playtime last synced: ${game.playtime_last_synced_at ? new Date(game.playtime_last_synced_at).toISOString() : 'NULL'}`);
      console.log(`  Updated at: ${new Date(game.updated_at).toISOString()}`);
      
      // Calculate playtime delta
      const previous = game.previous_playtime_minutes ?? 0;
      const current = game.playtime_minutes;
      const delta = current - previous;
      console.log(`  Playtime delta: ${delta} minutes ${delta >= 5 ? '✅ (>=5, should create session)' : '❌ (<5, won\'t create session)'}`);
    });
  } else {
    console.log('❌ No games found in user_games table');
  }
  console.log('');

  // 3. Check sessions in game_sessions
  console.log('3. SESSIONS IN game_sessions TABLE:');
  console.log('-'.repeat(80));
  const { data: sessions, error: sessionsError } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('user_id', USER_ID)
    .in('app_id', [ALBION_ONLINE_APP_ID, ARMA_REFORGER_APP_ID])
    .order('session_end', { ascending: false });

  if (sessionsError) {
    console.error('Error fetching sessions:', sessionsError);
  } else if (sessions && sessions.length > 0) {
    console.log(`Found ${sessions.length} session(s):`);
    sessions.forEach(session => {
      const sessionEnd = new Date(session.session_end);
      const sessionStart = new Date(session.session_start);
      const now = new Date();
      const daysAgo = (now.getTime() - sessionEnd.getTime()) / (1000 * 60 * 60 * 24);
      const within14Days = daysAgo <= 14;
      
      console.log(`\nSession ID: ${session.id}`);
      console.log(`  Type: ${session.type}`);
      console.log(`  App ID: ${session.app_id}`);
      console.log(`  Playtime delta: ${session.playtime_delta} minutes`);
      console.log(`  Session start: ${sessionStart.toISOString()}`);
      console.log(`  Session end: ${sessionEnd.toISOString()}`);
      console.log(`  Days ago: ${daysAgo.toFixed(2)} ${within14Days ? '✅ (within 14 days)' : '❌ (outside 14 days)'}`);
      console.log(`  Created at: ${new Date(session.created_at).toISOString()}`);
    });
  } else {
    console.log('❌ No sessions found in game_sessions table');
  }
  console.log('');

  // 4. Check all sessions for this user (to see what exists)
  console.log('4. ALL RECENT SESSIONS FOR THIS USER (last 14 days):');
  console.log('-'.repeat(80));
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const { data: allSessions, error: allSessionsError } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('user_id', USER_ID)
    .gte('session_end', fourteenDaysAgo.toISOString())
    .order('session_end', { ascending: false })
    .limit(20);

  if (allSessionsError) {
    console.error('Error fetching all sessions:', allSessionsError);
  } else if (allSessions && allSessions.length > 0) {
    console.log(`Found ${allSessions.length} session(s) in last 14 days:`);
    allSessions.forEach(session => {
      const sessionEnd = new Date(session.session_end);
      console.log(`  - ${session.type} session: app_id=${session.app_id}, end=${sessionEnd.toISOString()}, delta=${session.playtime_delta}min`);
    });
  } else {
    console.log('❌ No sessions found in last 14 days');
  }
  console.log('');

  // 5. Check achievements for these games
  console.log('5. ACHIEVEMENTS FOR THESE GAMES:');
  console.log('-'.repeat(80));
  const { data: achievements, error: achievementsError } = await supabase
    .from('user_achievements')
    .select('*')
    .eq('user_id', USER_ID)
    .in('app_id', [ALBION_ONLINE_APP_ID, ARMA_REFORGER_APP_ID])
    .eq('unlocked', true)
    .order('unlocked_at', { ascending: false })
    .limit(10);

  if (achievementsError) {
    console.error('Error fetching achievements:', achievementsError);
  } else if (achievements && achievements.length > 0) {
    console.log(`Found ${achievements.length} unlocked achievement(s):`);
    achievements.forEach(ach => {
      const unlockedAt = ach.unlocked_at ? new Date(ach.unlocked_at) : null;
      const daysAgo = unlockedAt ? (Date.now() - unlockedAt.getTime()) / (1000 * 60 * 60 * 24) : null;
      console.log(`  - App ${ach.app_id}: ${ach.achievement_api_name}, unlocked: ${unlockedAt ? unlockedAt.toISOString() : 'NULL'} ${daysAgo ? `(${daysAgo.toFixed(2)} days ago)` : ''}`);
    });
  } else {
    console.log('❌ No unlocked achievements found');
  }
  console.log('');

  // 6. Search for games by name
  console.log('6. SEARCHING FOR GAMES BY NAME:');
  console.log('-'.repeat(80));
  const { data: albionGames, error: albionError } = await supabase
    .from('user_games')
    .select('*')
    .eq('user_id', USER_ID)
    .ilike('name', '%albion%');

  const { data: armaGames, error: armaError } = await supabase
    .from('user_games')
    .select('*')
    .eq('user_id', USER_ID)
    .ilike('name', '%arma%');

  if (albionError) {
    console.error('Error searching for Albion:', albionError);
  } else if (albionGames && albionGames.length > 0) {
    console.log(`Found ${albionGames.length} game(s) matching "Albion":`);
    albionGames.forEach(game => {
      console.log(`  - ${game.name} (${game.app_id})`);
      console.log(`    Playtime: ${game.playtime_minutes} min, Last played: ${game.last_played ? new Date(game.last_played).toISOString() : 'NULL'}`);
    });
  } else {
    console.log('❌ No games found matching "Albion"');
  }

  if (armaError) {
    console.error('Error searching for Arma:', armaError);
  } else if (armaGames && armaGames.length > 0) {
    console.log(`Found ${armaGames.length} game(s) matching "Arma":`);
    armaGames.forEach(game => {
      console.log(`  - ${game.name} (${game.app_id})`);
      console.log(`    Playtime: ${game.playtime_minutes} min, Last played: ${game.last_played ? new Date(game.last_played).toISOString() : 'NULL'}`);
    });
  } else {
    console.log('❌ No games found matching "Arma"');
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(80));
}

checkMissingSessions().catch(console.error);
