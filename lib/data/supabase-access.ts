import { getSupabaseAdmin } from '@/lib/supabase/client';
import type { DataAccess } from './access';
import type { User, Game, Achievement, UserAchievement } from './types';
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
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
        last_sync_at: user.lastSyncAt?.toISOString(),
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
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      lastSyncAt: data.last_sync_at ? new Date(data.last_sync_at) : undefined,
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
    if (updates.lastSyncAt) updateData.last_sync_at = updates.lastSyncAt.toISOString();

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
    const userAchievementRecords = achievements.map(ach => {
      const isUnlocked = unlockedAchievements.includes(ach.apiName);
      const unlockTime = unlockTimes?.get(ach.apiName);
      
      return {
        user_id: userId,
        app_id: appId,
        achievement_api_name: ach.apiName,
        unlocked: isUnlocked,
        unlocked_at: unlockTime ? new Date(unlockTime * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      };
    });

    const { error: userAchievementsError } = await this.supabase
      .from('user_achievements')
      .upsert(userAchievementRecords, { onConflict: 'user_id,app_id,achievement_api_name' });

    if (userAchievementsError) {
      console.error('Error saving user achievements:', userAchievementsError);
      throw userAchievementsError;
    }
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

    // Get all achievement API names
    const achievementApiNames = userAchievementsData.map(ua => ua.achievement_api_name);

    // Fetch achievement definitions
    const { data: achievementsData, error: achievementsError } = await this.supabase
      .from('achievements')
      .select('*')
      .eq('app_id', appId)
      .in('api_name', achievementApiNames);

    if (achievementsError) {
      console.error('Error getting achievements:', achievementsError);
      return [];
    }

    // Create a map of achievement definitions
    const achievementsMap = new Map(
      (achievementsData || []).map(ach => [ach.api_name, ach])
    );

    // Combine user achievements with achievement definitions
    return userAchievementsData.map(row => {
      const achievement = achievementsMap.get(row.achievement_api_name);
      
      if (!achievement) {
        // If achievement definition is missing, return a minimal structure
        return {
          userId: row.user_id,
          appId: row.app_id,
          achievement: {
            appId,
            apiName: row.achievement_api_name,
            name: row.achievement_api_name,
            description: '',
            iconUrl: '',
            iconGrayUrl: '',
            hidden: false,
            globalPercentage: null,
          },
          unlocked: row.unlocked,
          unlockedAt: row.unlocked_at ? new Date(row.unlocked_at) : undefined,
        };
      }

      return {
        userId: row.user_id,
        appId: row.app_id,
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
}
