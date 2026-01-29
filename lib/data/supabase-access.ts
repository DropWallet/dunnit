import { getSupabaseAdmin } from '@/lib/supabase/client';
import type { DataAccess } from './access';
import type { User, Game, Achievement, UserAchievement, GameSession, Comment } from './access';
import type { SupabaseClient } from '@supabase/supabase-js';

export class SupabaseDataAccess implements DataAccess {
  private _supabase: SupabaseClient | null = null;

  // Lazy initialization - only create client when needed
  private get supabase(): SupabaseClient {
    if (!this._supabase) {
      this._supabase = getSupabaseAdmin();
    }
    return this._supabase;
  }

  async saveUser(user: User): Promise<void> {
    const { error } = await this.supabase
      .from('users')
      .upsert({
        steam_id: user.steamId,
        username: user.username,
        avatar_url: user.avatarUrl,
        profile_url: user.profileUrl,
        country_code: user.countryCode,
        country_name: user.countryName,
        join_date: user.joinDate?.toISOString(),
        community_visibility_state: user.communityVisibilityState,
        is_private: user.isPrivate ?? false,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
        last_sync_at: user.lastSyncAt?.toISOString(),
        last_feed_sync_attempt: user.lastFeedSyncAttempt?.toISOString(),
      });

    if (error) {
      console.error('Error saving user:', error);
      throw error;
    }
  }

  async getUser(steamId: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('steam_id', steamId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Error getting user:', error);
      return null;
    }

    if (!data) return null;

    return {
      steamId: data.steam_id,
      username: data.username,
      avatarUrl: data.avatar_url,
      profileUrl: data.profile_url,
      countryCode: data.country_code,
      countryName: data.country_name,
      joinDate: data.join_date ? new Date(data.join_date) : undefined,
      communityVisibilityState: data.community_visibility_state,
      isPrivate: data.is_private ?? false,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      lastSyncAt: data.last_sync_at ? new Date(data.last_sync_at) : undefined,
      lastFeedSyncAttempt: data.last_feed_sync_attempt ? new Date(data.last_feed_sync_attempt) : undefined,
    };
  }

  async updateUser(steamId: string, updates: Partial<User>): Promise<void> {
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.username) updateData.username = updates.username;
    if (updates.avatarUrl) updateData.avatar_url = updates.avatarUrl;
    if (updates.profileUrl) updateData.profile_url = updates.profileUrl;
    if (updates.countryCode) updateData.country_code = updates.countryCode;
    if (updates.countryName) updateData.country_name = updates.countryName;
    if (updates.joinDate) updateData.join_date = updates.joinDate.toISOString();
    if (updates.communityVisibilityState !== undefined) updateData.community_visibility_state = updates.communityVisibilityState;
    if (updates.isPrivate !== undefined) updateData.is_private = updates.isPrivate;
    if (updates.lastSyncAt) updateData.last_sync_at = updates.lastSyncAt.toISOString();
    if (updates.lastFeedSyncAttempt) updateData.last_feed_sync_attempt = updates.lastFeedSyncAttempt.toISOString();

    const { error } = await this.supabase
      .from('users')
      .update(updateData)
      .eq('steam_id', steamId);

    if (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async saveUserGames(userId: string, games: Game[]): Promise<void> {
    const gameRecords = games.map(game => ({
      user_id: userId,
      app_id: game.appId,
      name: game.name,
      playtime_minutes: game.playtimeMinutes,
      playtime_2weeks_minutes: game.playtime2WeeksMinutes,
      icon_url: game.iconUrl,
      logo_url: game.logoUrl,
      cover_image_url: game.coverImageUrl,
      last_played: game.lastPlayed?.toISOString(),
      derived_last_played: game.derivedLastPlayed?.toISOString(),
      derived_last_played_calculated_at: game.derivedLastPlayedCalculatedAt?.toISOString(),
      previous_playtime_minutes: game.previousPlaytimeMinutes,
      playtime_last_synced_at: game.playtimeLastSyncedAt?.toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await this.supabase
      .from('user_games')
      .upsert(gameRecords, { onConflict: 'user_id,app_id' });

    if (error) {
      console.error('Error saving user games:', error);
      throw error;
    }
  }

  async getUserGames(userId: string): Promise<Game[]> {
    const { data, error } = await this.supabase
      .from('user_games')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.error('Error getting user games:', error);
      return [];
    }

    if (!data) return [];

    return data.map(row => ({
      appId: row.app_id,
      name: row.name,
      playtimeMinutes: row.playtime_minutes,
      playtime2WeeksMinutes: row.playtime_2weeks_minutes,
      iconUrl: row.icon_url,
      logoUrl: row.logo_url,
      coverImageUrl: row.cover_image_url,
      lastPlayed: row.last_played ? new Date(row.last_played) : undefined,
      derivedLastPlayed: row.derived_last_played ? new Date(row.derived_last_played) : undefined,
      derivedLastPlayedCalculatedAt: row.derived_last_played_calculated_at ? new Date(row.derived_last_played_calculated_at) : undefined,
      previousPlaytimeMinutes: row.previous_playtime_minutes,
      playtimeLastSyncedAt: row.playtime_last_synced_at ? new Date(row.playtime_last_synced_at) : undefined,
    }));
  }

  async getUserGame(userId: string, appId: number): Promise<Game | null> {
    const { data, error } = await this.supabase
      .from('user_games')
      .select('*')
      .eq('user_id', userId)
      .eq('app_id', appId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Error getting user game:', error);
      return null;
    }

    if (!data) return null;

    return {
      appId: data.app_id,
      name: data.name,
      playtimeMinutes: data.playtime_minutes,
      playtime2WeeksMinutes: data.playtime_2weeks_minutes,
      iconUrl: data.icon_url,
      logoUrl: data.logo_url,
      coverImageUrl: data.cover_image_url,
      lastPlayed: data.last_played ? new Date(data.last_played) : undefined,
      derivedLastPlayed: data.derived_last_played ? new Date(data.derived_last_played) : undefined,
      derivedLastPlayedCalculatedAt: data.derived_last_played_calculated_at ? new Date(data.derived_last_played_calculated_at) : undefined,
      previousPlaytimeMinutes: data.previous_playtime_minutes,
      playtimeLastSyncedAt: data.playtime_last_synced_at ? new Date(data.playtime_last_synced_at) : undefined,
    };
  }

  async saveUserAchievements(
    userId: string,
    appId: number,
    achievements: Achievement[],
    unlockedAchievements: string[],
    unlockTimes?: Map<string, number>,
    globalPercentages?: Map<string, number>
  ): Promise<void> {
    // First, upsert achievement definitions
    const achievementRecords = achievements.map(ach => ({
      app_id: appId,
      api_name: ach.apiName,
      name: ach.name,
      description: ach.description,
      icon_url: ach.iconUrl,
      icon_gray_url: ach.iconGrayUrl,
      hidden: ach.hidden,
      global_percentage: globalPercentages?.get(ach.apiName) ?? ach.globalPercentage ?? null,
    }));

    const { error: achievementsError } = await this.supabase
      .from('achievements')
      .upsert(achievementRecords, { onConflict: 'app_id,api_name' });

    if (achievementsError) {
      console.error('Error saving achievements:', achievementsError);
      throw achievementsError;
    }

    // Then, upsert user achievements
    const now = new Date().toISOString();
    const userAchievementRecords = achievements.map(ach => {
      const isUnlocked = unlockedAchievements.includes(ach.apiName);
      const unlockTime = unlockTimes?.get(ach.apiName);
      
      const record: any = {
        user_id: userId,
        app_id: appId,
        achievement_api_name: ach.apiName,
        unlocked: isUnlocked,
        unlocked_at: unlockTime ? new Date(unlockTime * 1000).toISOString() : null,
        updated_at: now,
      };
      
      // Try to include last_synced_at (will work after migration)
      // If column doesn't exist, we'll retry without it
      record.last_synced_at = now;
      
      return record;
    });

    let { error: userAchievementsError } = await this.supabase
      .from('user_achievements')
      .upsert(userAchievementRecords, { onConflict: 'user_id,app_id,achievement_api_name' });

    // If error is about missing last_synced_at column, retry without it
    if (userAchievementsError && (
      userAchievementsError.message?.includes('last_synced_at') ||
      userAchievementsError.code === 'PGRST204'
    )) {
      console.warn('last_synced_at column not found - migration may be needed. Retrying without it.');
      
      // Retry without last_synced_at
      const recordsWithoutLastSynced = userAchievementRecords.map(({ last_synced_at, ...rest }) => rest);
      
      const { error: retryError } = await this.supabase
        .from('user_achievements')
        .upsert(recordsWithoutLastSynced, { onConflict: 'user_id,app_id,achievement_api_name' });

      if (retryError) {
        console.error('Error saving user achievements (retry without last_synced_at):', retryError);
        throw retryError;
      }
    } else if (userAchievementsError) {
      console.error('Error saving user achievements:', userAchievementsError);
      throw userAchievementsError;
    }

    // If achievements array is empty (game has 0 achievements), create a placeholder row
    // so we can track that this game was synced
    if (achievements.length === 0) {
      // First, create the placeholder achievement in the achievements table
      // This is required because of the foreign key constraint
      const placeholderAchievement = {
        app_id: appId,
        api_name: '__zero_achievements__',
        name: 'No achievements',
        description: 'This game does not have achievements on Steam',
        icon_url: '',
        icon_gray_url: '',
        hidden: false,
        global_percentage: null,
      };

      try {
        // Upsert the placeholder achievement first
        const { error: achievementError } = await this.supabase
          .from('achievements')
          .upsert(placeholderAchievement, { onConflict: 'app_id,api_name' });

        if (achievementError) {
          return; // Can't create placeholder if achievement definition fails
        }

        // Now create the placeholder in user_achievements
        const placeholderRecord: any = {
          user_id: userId,
          app_id: appId,
          achievement_api_name: '__zero_achievements__',
          unlocked: false,
          unlocked_at: null,
          updated_at: now,
        };
        
        // Try to include last_synced_at (will work after migration)
        placeholderRecord.last_synced_at = now;

        const { error: placeholderError } = await this.supabase
          .from('user_achievements')
          .upsert(placeholderRecord, { onConflict: 'user_id,app_id,achievement_api_name' });

        // If error is about missing last_synced_at column, retry without it
        if (placeholderError && (
          placeholderError.message?.includes('last_synced_at') ||
          placeholderError.code === 'PGRST204'
        )) {
          const { last_synced_at, ...recordWithoutLastSynced } = placeholderRecord;
          const { error: retryError } = await this.supabase
            .from('user_achievements')
            .upsert(recordWithoutLastSynced, { onConflict: 'user_id,app_id,achievement_api_name' });
          
          // Retry succeeded or failed - no action needed
        }
      } catch (error) {
        // Silently fail - placeholder creation is optional for tracking
      }
    }
  }

  async getAchievementLastSyncedAt(userId: string, appId: number): Promise<Date | null> {
    try {
      const { data, error } = await this.supabase
        .from('user_achievements')
        .select('last_synced_at')
        .eq('user_id', userId)
        .eq('app_id', appId)
        .not('last_synced_at', 'is', null)
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // If column doesn't exist, return null (migration not run yet)
      if (error && (
        error.message?.includes('last_synced_at') ||
        error.code === 'PGRST204'
      )) {
        return null;
      }

      if (error || !data || !data.last_synced_at) {
        return null;
      }

      return new Date(data.last_synced_at);
    } catch (error: any) {
      // Column doesn't exist yet - migration not run
      if (error?.message?.includes('last_synced_at') || error?.code === 'PGRST204') {
        return null;
      }
      return null;
    }
  }

  async getAllAchievementMetadataForUser(userId: string): Promise<Map<number, { hasAchievements: boolean; lastSyncedAt: Date | null }>> {
    const metadataMap = new Map<number, { hasAchievements: boolean; lastSyncedAt: Date | null }>();
    
    let viewReturnedData = false;
    
    try {
      // Query the view which groups achievements by app_id
      // This returns one row per game instead of one row per achievement
      // This avoids the 1000-row limit and is much more efficient
      const { data, error } = await this.supabase
        .from('user_sync_summary')
        .select('app_id, last_synced_at, has_achievements')
        .eq('user_id', userId);

      if (error) {
        // If view doesn't exist yet (migration not run), fall back to old method
        if (error.message?.includes('user_sync_summary') || error.code === 'PGRST204') {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[METADATA WARN] user_sync_summary view doesn't exist yet. Falling back to direct query. Run migration: add-user-sync-summary-view.sql`);
          }
          // Fall back to direct query method
          return this.getAllAchievementMetadataForUserDirect(userId);
        }
        if (process.env.NODE_ENV === 'development') {
          console.error(`[METADATA ERROR] View query failed:`, error);
        }
        // Continue to fallback - don't return empty map
      } else if (data && data.length > 0) {
        // Build the result map from the view data
        for (const row of data) {
          metadataMap.set(row.app_id, {
            hasAchievements: row.has_achievements ?? false,
            lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
          });
        }
        viewReturnedData = true;
      }
      
      // Debug logging

      // CRITICAL FIX: If view returned 0 rows, always fall back to direct query
      // This handles RLS issues, view caching problems, or read-after-write consistency
      if (!viewReturnedData || metadataMap.size === 0) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[METADATA WARN] View returned 0 rows, falling back to direct query for userId: ${userId}`);
        }
        const directMetadata = await this.getAllAchievementMetadataForUserDirect(userId);
        // Merge direct query results into existing map
        for (const [appId, metadata] of directMetadata) {
          if (!metadataMap.has(appId)) {
            metadataMap.set(appId, metadata);
          } else {
            // Update lastSyncedAt if direct query has a newer one
            const existing = metadataMap.get(appId)!;
            if (metadata.lastSyncedAt && (!existing.lastSyncedAt || metadata.lastSyncedAt > existing.lastSyncedAt)) {
              existing.lastSyncedAt = metadata.lastSyncedAt;
            }
          }
        }
        
        // If direct query also returned 0, query placeholders directly as a last resort
        // This handles read-after-write consistency where placeholders were just created
        if (metadataMap.size === 0) {
          // Retry up to 3 times with increasing delays to handle read-after-write consistency
          // This is a workaround for database write visibility issues
          for (let attempt = 0; attempt < 3 && metadataMap.size === 0; attempt++) {
            const delay = 1000 * (attempt + 1); // 1s, 2s, 3s
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
              const { data: allPlaceholders, error: placeholderError } = await this.supabase
                .from('user_achievements')
                .select('app_id, last_synced_at')
                .eq('user_id', userId)
                .eq('achievement_api_name', '__zero_achievements__')
                .limit(1000);
              
              if (!placeholderError && allPlaceholders && allPlaceholders.length > 0) {
                for (const placeholder of allPlaceholders) {
                  if (!metadataMap.has(placeholder.app_id)) {
                    metadataMap.set(placeholder.app_id, {
                      hasAchievements: false,
                      lastSyncedAt: placeholder.last_synced_at ? new Date(placeholder.last_synced_at) : null,
                    });
                  }
                }
                // Found placeholders, exit retry loop
                if (metadataMap.size > 0) {
                  break;
                }
              }
            } catch (placeholderError) {
              if (process.env.NODE_ENV === 'development') {
                console.warn(`[METADATA WARN] Error in last resort placeholder query (attempt ${attempt + 1}):`, placeholderError);
              }
            }
          }
        }
      } else {
        // View returned data, but still query for recently updated placeholders as safety net
        const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
        try {
          const { data: recentPlaceholders, error: recentError } = await this.supabase
            .from('user_achievements')
            .select('app_id, last_synced_at, updated_at')
            .eq('user_id', userId)
            .eq('achievement_api_name', '__zero_achievements__')
            .gte('updated_at', thirtySecondsAgo);

          if (recentError) {
            if (process.env.NODE_ENV === 'development') {
              console.warn(`[METADATA WARN] Error querying recent placeholders:`, recentError);
            }
          } else if (recentPlaceholders && recentPlaceholders.length > 0) {
            let addedCount = 0;
            for (const placeholder of recentPlaceholders) {
              if (!metadataMap.has(placeholder.app_id)) {
                metadataMap.set(placeholder.app_id, {
                  hasAchievements: false,
                  lastSyncedAt: placeholder.last_synced_at ? new Date(placeholder.last_synced_at) : null,
                });
                addedCount++;
              }
            }
          }
          
          // FINAL FALLBACK: If we still have a reasonable number of games but might be missing placeholders,
          // query ALL placeholders for this user (not just recent ones) to ensure we catch everything
          // This handles cases where placeholders were created >30 seconds ago but view hasn't updated
          // Always run this when view returned data (it's a safety net, and the limit prevents huge queries)
          if (viewReturnedData && metadataMap.size > 0) {
            // Only do this expensive query if we have some data (view worked) but might be missing some
            try {
              // Add a small delay to allow database writes to become visible
              // This is a workaround for read-after-write consistency issues
              await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
              
              const { data: allPlaceholders, error: allPlaceholdersError } = await this.supabase
                .from('user_achievements')
                .select('app_id, last_synced_at')
                .eq('user_id', userId)
                .eq('achievement_api_name', '__zero_achievements__')
                .limit(1000); // Limit to avoid huge queries, but should cover most cases
              
              if (!allPlaceholdersError && allPlaceholders) {
                for (const placeholder of allPlaceholders) {
                  if (!metadataMap.has(placeholder.app_id)) {
                    metadataMap.set(placeholder.app_id, {
                      hasAchievements: false,
                      lastSyncedAt: placeholder.last_synced_at ? new Date(placeholder.last_synced_at) : null,
                    });
                  }
                }
              }
            } catch (fallbackError) {
              // Silently fail - this is just a safety net
              if (process.env.NODE_ENV === 'development') {
                console.warn(`[METADATA WARN] Error in full placeholder fallback query:`, fallbackError);
              }
            }
          }
        } catch (recentError) {
          // Silently fail - this is just a safety net
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[METADATA WARN] Error in recent placeholders query:`, recentError);
          }
        }
      }
    } catch (error: any) {
      // View doesn't exist yet - migration not run, or other error
      if (error?.message?.includes('user_sync_summary')) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[METADATA WARN] user_sync_summary view error. Falling back to direct query. Run migration: add-user-sync-summary-view.sql`);
        }
      } else {
        console.error('Error getting achievement metadata:', error);
      }
      // Fall back to direct query
      const directMetadata = await this.getAllAchievementMetadataForUserDirect(userId);
      for (const [appId, metadata] of directMetadata) {
        metadataMap.set(appId, metadata);
      }
    }

    return metadataMap;
  }

  // Direct query method that queries user_achievements table directly
  // This is used as a fallback when the view fails or returns 0 rows
  private async getAllAchievementMetadataForUserDirect(userId: string): Promise<Map<number, { hasAchievements: boolean; lastSyncedAt: Date | null }>> {
    const metadataMap = new Map<number, { hasAchievements: boolean; lastSyncedAt: Date | null }>();
    
    try {
      // Query ALL user_achievements for this user with pagination
      // Group by app_id to get one row per game
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;
      const seenAppIds = new Set<number>();

      while (hasMore) {
        const { data, error } = await this.supabase
          .from('user_achievements')
          .select('app_id, last_synced_at, achievement_api_name')
          .eq('user_id', userId)
          .range(from, from + pageSize - 1)
          .order('app_id', { ascending: true });

        if (error) {
          if (process.env.NODE_ENV === 'development') {
            console.error(`[METADATA ERROR] Direct query failed (page ${from}-${from + pageSize - 1}):`, error);
          }
          break;
        }

        if (data && data.length > 0) {
          // Process this page of data
          for (const row of data) {
            if (!seenAppIds.has(row.app_id)) {
              seenAppIds.add(row.app_id);
              const isPlaceholder = row.achievement_api_name === '__zero_achievements__';
              
              // If we already have this app_id, update it if this row has a newer last_synced_at
              if (metadataMap.has(row.app_id)) {
                const existing = metadataMap.get(row.app_id)!;
                const rowLastSynced = row.last_synced_at ? new Date(row.last_synced_at) : null;
                if (rowLastSynced && (!existing.lastSyncedAt || rowLastSynced > existing.lastSyncedAt)) {
                  existing.lastSyncedAt = rowLastSynced;
                }
                // Update hasAchievements if this row is not a placeholder
                if (!isPlaceholder) {
                  existing.hasAchievements = true;
                }
              } else {
                // New app_id - add it
                metadataMap.set(row.app_id, {
                  hasAchievements: !isPlaceholder,
                  lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
                });
              }
            } else {
              // We've seen this app_id before in this page, update metadata
              const existing = metadataMap.get(row.app_id)!;
              const isPlaceholder = row.achievement_api_name === '__zero_achievements__';
              if (!isPlaceholder) {
                existing.hasAchievements = true;
              }
              const rowLastSynced = row.last_synced_at ? new Date(row.last_synced_at) : null;
              if (rowLastSynced && (!existing.lastSyncedAt || rowLastSynced > existing.lastSyncedAt)) {
                existing.lastSyncedAt = rowLastSynced;
              }
            }
          }
          
          from += pageSize;
          hasMore = data.length === pageSize;
        } else {
          hasMore = false;
        }
      }

    } catch (error) {
      console.error('Error in direct query fallback:', error);
    }

    return metadataMap;
  }

  // Legacy method as fallback (keeps old logic for backwards compatibility)
  private async getAllAchievementMetadataForUserLegacy(userId: string): Promise<Map<number, { hasAchievements: boolean; lastSyncedAt: Date | null }>> {
    const metadataMap = new Map<number, { hasAchievements: boolean; lastSyncedAt: Date | null }>();
    
    try {
      const { data, error } = await this.supabase
        .from('user_achievements')
        .select('app_id, last_synced_at, achievement_api_name')
        .eq('user_id', userId)
        .limit(1000); // Explicit limit to avoid confusion

      if (error) {
        if (error.message?.includes('last_synced_at') || error.code === 'PGRST204') {
          return metadataMap;
        }
        console.error('Error getting achievement metadata (legacy):', error);
        return metadataMap;
      }

      const appIdMap = new Map<number, Date | null>();
      const appIdsWithRealAchievements = new Set<number>();
      
      if (data) {
        for (const row of data) {
          const appId = row.app_id;
          const lastSyncedAt = row.last_synced_at ? new Date(row.last_synced_at) : null;
          
          if (row.achievement_api_name !== '__zero_achievements__') {
            appIdsWithRealAchievements.add(appId);
          }
          
          const existing = appIdMap.get(appId);
          if (!existing || (lastSyncedAt && (!existing || lastSyncedAt > existing))) {
            appIdMap.set(appId, lastSyncedAt);
          }
        }
      }

      for (const [appId, lastSyncedAt] of appIdMap.entries()) {
        metadataMap.set(appId, {
          hasAchievements: appIdsWithRealAchievements.has(appId),
          lastSyncedAt,
        });
      }
    } catch (error: any) {
      if (error?.message?.includes('last_synced_at') || error?.code === 'PGRST204') {
        return metadataMap;
      }
      console.error('Error getting achievement metadata (legacy):', error);
    }

    return metadataMap;
  }

  async getUserAchievements(userId: string, appId: number): Promise<UserAchievement[]> {
    // First get user achievements
    const { data: userAchievementsData, error: userAchievementsError } = await this.supabase
      .from('user_achievements')
      .select('*')
      .eq('user_id', userId)
      .eq('app_id', appId);

    if (userAchievementsError) {
      console.error('Error getting user achievements:', userAchievementsError);
      return [];
    }

    if (!userAchievementsData || userAchievementsData.length === 0) {
      return [];
    }

    // Filter out placeholder rows for games with 0 achievements
    const realUserAchievements = userAchievementsData.filter(
      ua => ua.achievement_api_name !== '__zero_achievements__'
    );

    if (realUserAchievements.length === 0) {
      return [];
    }

    // Get all achievement API names
    const achievementApiNames = realUserAchievements.map(ua => ua.achievement_api_name);

    // Fetch achievement definitions
    const { data: achievementsData, error: achievementsError } = await this.supabase
      .from('achievements')
      .select('*')
      .eq('app_id', appId)
      .in('api_name', achievementApiNames);

    if (achievementsError) {
      // Only log unexpected errors (not HeadersOverflowError which is expected for some Steam responses)
      const errorMessage = achievementsError instanceof Error 
        ? achievementsError.message 
        : (achievementsError as any)?.message || String(achievementsError);
      
      if (!errorMessage.includes('HeadersOverflowError')) {
        console.error('Error getting achievements:', achievementsError);
      }
      return [];
    }

    // Create a map of achievement definitions
    const achievementsMap = new Map(
      (achievementsData || []).map(ach => [ach.api_name, ach])
    );

    // Combine user achievements with achievement definitions
    return realUserAchievements.map(row => {
      const achievement = achievementsMap.get(row.achievement_api_name);
      
      if (!achievement) {
        // If achievement definition is missing, return a minimal structure
        return {
          userId: row.user_id,
          appId: row.app_id,
          apiName: row.achievement_api_name, // For backward compatibility
          achievement: {
            appId,
            apiName: row.achievement_api_name,
            name: row.achievement_api_name,
            description: '',
            iconUrl: '',
            iconGrayUrl: '',
            hidden: false,
            globalPercentage: undefined,
          },
          unlocked: row.unlocked,
          unlockedAt: row.unlocked_at ? new Date(row.unlocked_at) : undefined,
        };
      }

      return {
        userId: row.user_id,
        appId: row.app_id,
        apiName: achievement.api_name, // For backward compatibility
        achievement: {
          appId: achievement.app_id,
          apiName: achievement.api_name,
          name: achievement.name,
          description: achievement.description,
          iconUrl: achievement.icon_url,
          iconGrayUrl: achievement.icon_gray_url,
          hidden: achievement.hidden,
          globalPercentage: achievement.global_percentage,
        },
        unlocked: row.unlocked,
        unlockedAt: row.unlocked_at ? new Date(row.unlocked_at) : undefined,
        globalPercentage: achievement.global_percentage,
      };
    });
  }

  async clearUserAchievements(userId: string, appId: number): Promise<void> {
    const { error } = await this.supabase
      .from('user_achievements')
      .delete()
      .eq('user_id', userId)
      .eq('app_id', appId);

    if (error) {
      console.error('Error clearing user achievements:', error);
      throw error;
    }
  }

  async getUserStatistics(userId: string): Promise<{ statistics: any; calculatedAt: Date } | null> {
    const { data, error } = await this.supabase
      .from('user_statistics')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Error getting user statistics:', error);
      return null;
    }

    if (!data) return null;

    return {
      statistics: {
        totalGames: data.total_games,
        startedGames: data.started_games,
        totalAchievements: data.total_achievements,
        unlockedAchievements: data.unlocked_achievements,
        averageCompletionRate: data.average_completion_rate,
      },
      calculatedAt: new Date(data.calculated_at),
    };
  }

  async saveUserStatistics(userId: string, statistics: any): Promise<void> {
    const { error } = await this.supabase
      .from('user_statistics')
      .upsert({
        user_id: userId,
        total_games: statistics.totalGames,
        started_games: statistics.startedGames,
        total_achievements: statistics.totalAchievements,
        unlocked_achievements: statistics.unlockedAchievements,
        average_completion_rate: statistics.averageCompletionRate,
        calculated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('Error saving user statistics:', error);
      throw error;
    }
  }

  /**
   * PERFORMANCE: Calculate statistics using SQL aggregation (Phase 2)
   * This replaces fetching all achievements and calculating in memory
   * Expected improvement: 100x faster (10s → 100ms)
   */
  async calculateUserStatisticsFromDatabase(userId: string): Promise<any> {
    try {
      // Get total games and started games from user_games
      const { data: gamesData, error: gamesError} = await this.supabase
        .from('user_games')
        .select('playtime_minutes')
        .eq('user_id', userId);

      if (gamesError) {
        throw gamesError;
      }

      const totalGames = gamesData?.length || 0;
      const startedGames = gamesData?.filter(g => g.playtime_minutes > 0).length || 0;

      // Get games with at least one unlocked achievement
      const { data: gamesWithUnlocked } = await this.supabase
        .from('user_achievements')
        .select('app_id')
        .eq('user_id', userId)
        .eq('unlocked', true);

      const appIdsWithUnlocked = [...new Set(gamesWithUnlocked?.map(a => a.app_id) || [])];

      if (appIdsWithUnlocked.length === 0) {
        // No achievements unlocked
        return {
          totalGames,
          startedGames,
          totalAchievements: 0,
          unlockedAchievements: 0,
          averageCompletionRate: 0,
        };
      }

      // Get total achievements from games with unlocked achievements
      const { count: totalAchievements } = await this.supabase
        .from('user_achievements')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('app_id', appIdsWithUnlocked);

      // Get unlocked achievements count
      const { count: unlockedAchievements } = await this.supabase
        .from('user_achievements')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('unlocked', true);

      const averageCompletionRate = totalAchievements && totalAchievements > 0
        ? Math.round(((unlockedAchievements || 0) / totalAchievements) * 1000) / 10
        : 0;

      return {
        totalGames,
        startedGames,
        totalAchievements: totalAchievements || 0,
        unlockedAchievements: unlockedAchievements || 0,
        averageCompletionRate,
      };
    } catch (error) {
      console.error('[Perf] Phase 2: SQL aggregation failed:', error);
      throw error;
    }
  }

  async getUserFriendsCount(steamId: string): Promise<{ count: number; syncedAt: Date | null } | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('friends_count, friends_count_synced_at')
      .eq('steam_id', steamId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Error getting friends count:', error);
      return null;
    }

    if (!data) return null;

    return {
      count: data.friends_count || 0,
      syncedAt: data.friends_count_synced_at ? new Date(data.friends_count_synced_at) : null,
    };
  }

  async saveUserFriendsCount(steamId: string, count: number): Promise<void> {
    const { error } = await this.supabase
      .from('users')
      .update({
        friends_count: count,
        friends_count_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('steam_id', steamId);

    if (error) {
      console.error('Error saving friends count:', error);
      throw error;
    }
  }

  async likeSession(sessionId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('feed_likes')
      .upsert({
        session_id: sessionId,
        user_id: userId,
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'session_id,user_id',
      });

    if (error) {
      console.error('Error liking session:', error);
      throw error;
    }
  }

  async unlikeSession(sessionId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('feed_likes')
      .delete()
      .eq('session_id', sessionId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error unliking session:', error);
      throw error;
    }
  }

  async getLikeCounts(sessionIds: string[]): Promise<Map<string, number>> {
    if (sessionIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from('feed_likes')
      .select('session_id')
      .in('session_id', sessionIds);

    if (error) {
      console.error('Error getting like counts:', error);
      throw error;
    }

    // Count likes per session
    const counts = new Map<string, number>();
    sessionIds.forEach(id => counts.set(id, 0)); // Initialize all to 0
    
    (data || []).forEach((row: any) => {
      const current = counts.get(row.session_id) || 0;
      counts.set(row.session_id, current + 1);
    });

    return counts;
  }

  async getUserLikes(sessionIds: string[], userId: string): Promise<Set<string>> {
    if (sessionIds.length === 0) {
      return new Set();
    }

    const { data, error } = await this.supabase
      .from('feed_likes')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('user_id', userId);

    if (error) {
      console.error('Error getting user likes:', error);
      throw error;
    }

    return new Set((data || []).map((row: any) => row.session_id));
  }

  async getLikedByUsers(sessionId: string, limit: number = 3): Promise<Array<{ userId: string; avatarUrl: string }>> {
    // Query feed_likes and join with users table
    const { data, error } = await this.supabase
      .from('feed_likes')
      .select(`
        user_id,
        users (
          avatar_url
        )
      `)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error getting liked by users:', error);
      throw error;
    }

    return (data || []).map((row: any) => ({
      userId: row.user_id,
      avatarUrl: (row.users as any)?.avatar_url || '',
    }));
  }

  async saveGameSession(session: GameSession): Promise<void> {
    const { error } = await this.supabase
      .from('game_sessions')
      .upsert({
        id: session.id,
        user_id: session.userId,
        app_id: session.appId,
        playtime_delta: session.playtimeDelta,
        session_start: session.sessionStart.toISOString(),
        session_end: session.sessionEnd.toISOString(),
        type: session.type,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id',
      });

    if (error) {
      console.error('Error saving game session:', error);
      throw error;
    }
  }

  async getRecentGameSession(userId: string, appId: number, withinMinutes: number = 30, type?: 'playtime' | 'achievement'): Promise<GameSession | null> {
    const cutoffTime = new Date(Date.now() - withinMinutes * 60 * 1000);

    let query = this.supabase
      .from('game_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('app_id', appId)
      .gte('session_end', cutoffTime.toISOString())
      .order('session_end', { ascending: false })
      .limit(1);

    // Filter by type if specified (for backward compatibility, default to 'playtime' if not specified)
    if (type) {
      query = query.eq('type', type);
    } else {
      // Default to 'playtime' for backward compatibility
      query = query.eq('type', 'playtime');
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Error getting recent game session:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      userId: data.user_id,
      appId: data.app_id,
      playtimeDelta: data.playtime_delta,
      sessionStart: new Date(data.session_start),
      sessionEnd: new Date(data.session_end),
      type: data.type as 'playtime' | 'achievement',
      createdAt: data.created_at ? new Date(data.created_at) : undefined,
      updatedAt: data.updated_at ? new Date(data.updated_at) : undefined,
    };
  }

  async getGameSessionByStartTime(userId: string, appId: number, sessionStart: Date, type?: 'playtime' | 'achievement'): Promise<GameSession | null> {
    // Round sessionStart to nearest second (matching deduplication logic)
    const sessionStartRounded = new Date(Math.floor(sessionStart.getTime() / 1000) * 1000);
    const sessionStartRoundedPlusOne = new Date(sessionStartRounded.getTime() + 1000); // Add 1 second for range query

    let query = this.supabase
      .from('game_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('app_id', appId)
      .gte('session_start', sessionStartRounded.toISOString())
      .lt('session_start', sessionStartRoundedPlusOne.toISOString())
      .order('session_end', { ascending: false })
      .limit(1);

    // Filter by type if specified (for backward compatibility, default to 'playtime' if not specified)
    if (type) {
      query = query.eq('type', type);
    } else {
      // Default to 'playtime' for backward compatibility
      query = query.eq('type', 'playtime');
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Error getting game session by start time:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      userId: data.user_id,
      appId: data.app_id,
      playtimeDelta: data.playtime_delta,
      sessionStart: new Date(data.session_start),
      sessionEnd: new Date(data.session_end),
      type: data.type as 'playtime' | 'achievement',
      createdAt: data.created_at ? new Date(data.created_at) : undefined,
      updatedAt: data.updated_at ? new Date(data.updated_at) : undefined,
    };
  }

  async getGameSessions(userIds: string[], limit: number = 50, offset: number = 0, lookbackDays: number = 14): Promise<GameSession[]> {
    const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('game_sessions')
      .select('*')
      .in('user_id', userIds)
      .gte('session_end', lookbackDate.toISOString())
      .order('session_end', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error getting game sessions:', error);
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      appId: row.app_id,
      playtimeDelta: row.playtime_delta,
      sessionStart: new Date(row.session_start),
      sessionEnd: new Date(row.session_end),
      type: row.type as 'playtime' | 'achievement',
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    }));
  }

  async getGameSessionCount(userIds: string[], lookbackDays: number = 14): Promise<number> {
    const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const { count, error } = await this.supabase
      .from('game_sessions')
      .select('id', { count: 'exact', head: true })
      .in('user_id', userIds)
      .gte('session_end', lookbackDate.toISOString());

    if (error) {
      console.error('Error getting game session count:', error);
      throw error;
    }

    return count || 0;
  }

  async deleteGameSession(sessionId: string): Promise<void> {
    const { error } = await this.supabase
      .from('game_sessions')
      .delete()
      .eq('id', sessionId);

    if (error) {
      console.error('Error deleting game session:', error);
      throw error;
    }
  }

  async updateGameBaseline(userId: string, appId: number, currentPlaytimeMinutes: number): Promise<void> {
    const { error } = await this.supabase
      .from('user_games')
      .update({
        previous_playtime_minutes: currentPlaytimeMinutes,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('app_id', appId);

    if (error) {
      console.error('Error updating game baseline:', error);
      throw error;
    }
  }

  async createComment(sessionId: string, userId: string, content: string): Promise<Comment> {
    // First, try to get user data from users table (if they've signed up)
    const { data: userData } = await this.supabase
      .from('users')
      .select('username, avatar_url')
      .eq('steam_id', userId)
      .single();

    // Insert comment
    const { data, error } = await this.supabase
      .from('feed_comments')
      .insert({
        session_id: sessionId,
        user_id: userId,
        content: content.trim(),
        is_edited: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating comment:', error);
      throw error;
    }

    // Return comment with user data (or empty if user doesn't exist in users table)
    return {
      id: data.id,
      sessionId: data.session_id,
      userId: data.user_id,
      username: userData?.username || '',
      avatarUrl: userData?.avatar_url || '',
      content: data.content,
      isEdited: data.is_edited,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  async getComments(sessionId: string, limit: number = 20, offset: number = 0): Promise<{comments: Comment[], total: number}> {
    // Get total count
    const { count, error: countError } = await this.supabase
      .from('feed_comments')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    if (countError) {
      console.error('Error getting comment count:', countError);
      throw countError;
    }

    // Get comments (no FK relationship, so fetch user data separately)
    const { data, error } = await this.supabase
      .from('feed_comments')
      .select(`
        id,
        session_id,
        user_id,
        content,
        is_edited,
        created_at,
        updated_at
      `)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error getting comments:', error);
      throw error;
    }

    // Fetch user data separately for all unique user IDs
    const userIds = [...new Set((data || []).map((row: any) => row.user_id))];
    const usersMap = new Map<string, { username: string; avatarUrl: string }>();
    
    if (userIds.length > 0) {
      const { data: usersData } = await this.supabase
        .from('users')
        .select('steam_id, username, avatar_url')
        .in('steam_id', userIds);
      
      if (usersData) {
        usersData.forEach((user: any) => {
          usersMap.set(user.steam_id, {
            username: user.username || '',
            avatarUrl: user.avatar_url || '',
          });
        });
      }
    }

    const comments: Comment[] = (data || []).map((row: any) => {
      const userData = usersMap.get(row.user_id) || { username: '', avatarUrl: '' };
      return {
        id: row.id,
        sessionId: row.session_id,
        userId: row.user_id,
        username: userData.username,
        avatarUrl: userData.avatarUrl,
        content: row.content,
        isEdited: row.is_edited,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    });

    return {
      comments,
      total: count || 0,
    };
  }

  async updateComment(commentId: string, userId: string, content: string): Promise<Comment> {
    // First verify the comment exists and belongs to the user
    const { data: existingComment, error: fetchError } = await this.supabase
      .from('feed_comments')
      .select('user_id, session_id')
      .eq('id', commentId)
      .single();

    if (fetchError) {
      console.error('Error fetching comment:', fetchError);
      throw fetchError;
    }

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    if (existingComment.user_id !== userId) {
      throw new Error('Not authorized to edit this comment');
    }

    // Get user data
    const { data: userData } = await this.supabase
      .from('users')
      .select('username, avatar_url')
      .eq('steam_id', userId)
      .single();

    // Update comment
    const { data, error } = await this.supabase
      .from('feed_comments')
      .update({
        content: content.trim(),
        is_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', commentId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating comment:', error);
      throw error;
    }

    return {
      id: data.id,
      sessionId: data.session_id,
      userId: data.user_id,
      username: userData?.username || '',
      avatarUrl: userData?.avatar_url || '',
      content: data.content,
      isEdited: data.is_edited,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  async deleteComment(commentId: string, userId: string): Promise<void> {
    // First verify the comment exists and belongs to the user
    const { data: existingComment, error: fetchError } = await this.supabase
      .from('feed_comments')
      .select('user_id')
      .eq('id', commentId)
      .single();

    if (fetchError) {
      console.error('Error fetching comment:', fetchError);
      throw fetchError;
    }

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    if (existingComment.user_id !== userId) {
      throw new Error('Not authorized to delete this comment');
    }

    // Delete comment
    const { error } = await this.supabase
      .from('feed_comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting comment:', error);
      throw error;
    }
  }

  async getCommentCounts(sessionIds: string[]): Promise<Map<string, number>> {
    if (sessionIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from('feed_comments')
      .select('session_id')
      .in('session_id', sessionIds);

    if (error) {
      console.error('Error getting comment counts:', error);
      throw error;
    }

    // Count comments per session
    const counts = new Map<string, number>();
    sessionIds.forEach(id => counts.set(id, 0)); // Initialize all to 0
    
    (data || []).forEach((row: any) => {
      const sessionId = row.session_id;
      counts.set(sessionId, (counts.get(sessionId) || 0) + 1);
    });

    return counts;
  }
}
