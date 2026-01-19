import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getSteamClient } from '../lib/steam/client';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const steamClient = getSteamClient();

async function checkSteamLastPlayed() {
  // Users and games to check
  const checks = [
    { userId: '76561198024338178', appId: 1631270, gameName: 'StarRupture' },
    { userId: '76561197964903395', appId: 427520, gameName: 'Factorio' },
  ];
  
  console.log('Checking Steam API lastPlayed vs Database stored values...\n');
  
  for (const check of checks) {
    console.log(`\n=== ${check.gameName} (${check.appId}) for User ${check.userId} ===`);
    
    // 1. Check what's stored in database
    const { data: dbGame, error: dbError } = await supabase
      .from('user_games')
      .select('last_played, derived_last_played, previous_playtime_minutes, playtime_minutes')
      .eq('user_id', check.userId)
      .eq('app_id', check.appId)
      .single();
    
    if (dbError) {
      console.error(`Database error:`, dbError);
    } else if (dbGame) {
      console.log('Database stored values:');
      console.log(`  last_played: ${dbGame.last_played ? new Date(dbGame.last_played).toISOString() : 'NULL'}`);
      console.log(`  derived_last_played: ${dbGame.derived_last_played ? new Date(dbGame.derived_last_played).toISOString() : 'NULL'}`);
      console.log(`  previous_playtime_minutes: ${dbGame.previous_playtime_minutes}min`);
      console.log(`  playtime_minutes: ${dbGame.playtime_minutes}min`);
    } else {
      console.log('Game not found in database');
    }
    
    // 2. Check what Steam API returns
    try {
      const recentlyPlayedGames = await steamClient.getRecentlyPlayedGames(check.userId);
      const steamGame = Array.isArray(recentlyPlayedGames) 
        ? recentlyPlayedGames.find((g: any) => g.appid === check.appId)
        : null;
      
      if (steamGame) {
        console.log('\nSteam API (Recently Played) values:');
        console.log(`  appid: ${steamGame.appid}`);
        console.log(`  name: ${steamGame.name}`);
        console.log(`  rtime_last_played: ${steamGame.rtime_last_played ? new Date(steamGame.rtime_last_played * 1000).toISOString() : 'NULL'} (raw: ${steamGame.rtime_last_played || 'undefined'})`);
        console.log(`  playtime_2weeks: ${steamGame.playtime_2weeks}min`);
        console.log(`  playtime_forever: ${steamGame.playtime_forever}min`);
      } else {
        console.log('\nGame not in Steam Recently Played list (played >14 days ago or not in response)');
        
        // Try to get from full library
        try {
          const ownedGames = await steamClient.getOwnedGames(check.userId);
          const libraryGame = Array.isArray(ownedGames)
            ? ownedGames.find((g: any) => g.appid === check.appId)
            : null;
          
          if (libraryGame) {
            console.log('\nSteam API (Full Library) values:');
            console.log(`  appid: ${libraryGame.appid}`);
            console.log(`  name: ${libraryGame.name}`);
            console.log(`  rtime_last_played: ${libraryGame.rtime_last_played ? new Date(libraryGame.rtime_last_played * 1000).toISOString() : 'NULL'} (raw: ${libraryGame.rtime_last_played || 'undefined'})`);
            console.log(`  playtime_2weeks: ${libraryGame.playtime_2weeks}min`);
            console.log(`  playtime_forever: ${libraryGame.playtime_forever}min`);
          } else {
            console.log('Game not found in Steam library');
          }
        } catch (libraryError) {
          console.error('Error fetching full library:', libraryError);
        }
      }
    } catch (steamError) {
      console.error('Error fetching from Steam API:', steamError);
    }
    
    // 3. Check the most recent session
    const { data: recentSession, error: sessionError } = await supabase
      .from('game_sessions')
      .select('*')
      .eq('user_id', check.userId)
      .eq('app_id', check.appId)
      .eq('type', 'playtime')
      .order('session_end', { ascending: false })
      .limit(1)
      .single();
    
    if (!sessionError && recentSession) {
      console.log('\nMost recent session in database:');
      console.log(`  session_end: ${new Date(recentSession.session_end).toISOString()}`);
      console.log(`  session_start: ${new Date(recentSession.session_start).toISOString()}`);
      console.log(`  playtime_delta: ${recentSession.playtime_delta}min`);
      console.log(`  created_at: ${new Date(recentSession.created_at).toISOString()}`);
      
      const sessionEnd = new Date(recentSession.session_end);
      const now = new Date();
      const hoursAgo = (now.getTime() - sessionEnd.getTime()) / (1000 * 60 * 60);
      console.log(`  (${hoursAgo.toFixed(1)} hours ago)`);
    }
  }
}

checkSteamLastPlayed()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
