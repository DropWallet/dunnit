import type {
  SteamPlayerSummary,
  SteamPlayerSummariesResponse,
  SteamOwnedGamesResponse,
  SteamPlayerAchievementsResponse,
  SteamGameSchemaResponse,
} from './types';

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_STORE_API = 'https://store.steampowered.com/api';

export class SteamAPIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Steam API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Get player summary (profile info)
   */
  async getPlayerSummary(steamId: string): Promise<SteamPlayerSummary | null> {
    try {
      const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v0002/?key=${this.apiKey}&steamids=${steamId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data: SteamPlayerSummariesResponse = await response.json();
      
      if (data.response.players && data.response.players.length > 0) {
        return data.response.players[0];
      }
      
      return null;
    } catch (error) {
      console.error('Error fetching player summary:', error);
      throw error;
    }
  }

  /**
   * Get list of games owned by a user
   * Note: include_played_free_games=1 is required to get rtime_last_played and playtime_2weeks
   */
  async getOwnedGames(steamId: string, includeAppInfo = true): Promise<SteamOwnedGamesResponse> {
    try {
      // Include include_played_free_games=1 to get rtime_last_played and playtime_2weeks
      const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/?key=${this.apiKey}&steamid=${steamId}&include_appinfo=${includeAppInfo ? 1 : 0}&include_played_free_games=1&format=json`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data: SteamOwnedGamesResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching owned games:', error);
      throw error;
    }
  }

  /**
   * Get recently played games (last 14 days) - more reliable for "Date Played" sorting
   * This endpoint always returns games played in the last 14 days with playtime_2weeks
   */
  async getRecentlyPlayedGames(steamId: string): Promise<SteamOwnedGamesResponse> {
    try {
      const url = `${STEAM_API_BASE}/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${this.apiKey}&steamid=${steamId}&format=json`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data: SteamOwnedGamesResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching recently played games:', error);
      throw error;
    }
  }

  /**
   * Get player achievements for a specific game
   */
  async getPlayerAchievements(
    steamId: string,
    appId: number
  ): Promise<SteamPlayerAchievementsResponse> {
    try {
      const url = `${STEAM_API_BASE}/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appId}&key=${this.apiKey}&steamid=${steamId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        // 400 is expected for games without achievements - don't log
        if (response.status !== 400) {
          console.error(`Unexpected error fetching player achievements (${response.status}):`, { steamId, appId });
        }
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data: SteamPlayerAchievementsResponse = await response.json();
      return data;
    } catch (error) {
      // Only log if it's not a 400 error (expected for games without achievements)
      if (error instanceof Error && !error.message.includes('400')) {
        console.error('Error fetching player achievements:', error);
      }
      throw error;
    }
  }

  /**
   * Get game schema (achievement definitions)
   */
  async getGameSchema(appId: number): Promise<SteamGameSchemaResponse> {
    try {
      const url = `${STEAM_API_BASE}/ISteamUserStats/GetSchemaForGame/v2/?appid=${appId}&key=${this.apiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data: SteamGameSchemaResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching game schema:', error);
      throw error;
    }
  }

  /**
   * Get game details from Steam Store API
   */
  async getGameDetails(appId: number): Promise<any> {
    try {
      const url = `${STEAM_STORE_API}/appdetails?appids=${appId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Steam Store API error: ${response.status}`);
      }

      const data = await response.json();
      return data[appId.toString()];
    } catch (error) {
      console.error('Error fetching game details:', error);
      throw error;
    }
  }

  /**
   * Get global achievement percentages for a game
   * Note: This endpoint doesn't require an API key
   */
  async getGlobalAchievementPercentages(appId: number): Promise<Map<string, number>> {
    try {
      const url = `${STEAM_API_BASE}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        // 403 is expected for many games - don't log
        if (response.status !== 403) {
          console.error(`Unexpected error fetching global achievement percentages (${response.status}):`, { appId });
        }
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data = await response.json();
      const percentages = new Map<string, number>();
      
      if (data.achievementpercentages?.achievements) {
        data.achievementpercentages.achievements.forEach((ach: { name: string; percent: number }) => {
          percentages.set(ach.name, ach.percent);
        });
      }
      
      return percentages;
    } catch (error) {
      // Only log if it's not a 403 error (expected for many games)
      if (error instanceof Error && !error.message.includes('403')) {
        console.error('Error fetching global achievement percentages:', error);
      }
      throw error;
    }
  }

  /**
   * Get player achievements from Steam's legacy XML API
   * This often includes descriptions for hidden achievements that the JSON API doesn't provide
   */
  async getPlayerAchievementsXML(
    steamId: string,
    appId: number
  ): Promise<Map<string, { description: string; unlocktime: number }>> {
    try {
      const url = `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/?xml=1`;
      const response = await fetch(url);
      
      if (!response.ok) {
        // 429 (rate limit) and 403 are expected - don't log
        if (response.status !== 429 && response.status !== 403) {
          console.error(`Unexpected error fetching achievements from XML API (${response.status}):`, { steamId, appId });
        }
        throw new Error(`Steam XML API error: ${response.status}`);
      }

      const xmlText = await response.text();
      const achievementMap = new Map<string, { description: string; unlocktime: number }>();
      
      // Parse XML to extract achievement data - use pattern that works with attributes
      const achievementRegex = /<achievement\s+[^>]*>[\s\S]*?<\/achievement>/g;
      const achievements = xmlText.match(achievementRegex) || [];
      
      // Helper function to extract CDATA or regular content
      function extractXmlValue(xml: string, tagName: string): string {
        const regex = new RegExp(`<${tagName}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tagName}>`, 'i');
        const match = xml.match(regex);
        if (match) {
          return (match[1] || match[2] || '').trim();
        }
        return '';
      }
      
      for (const achievementXml of achievements) {
        const apiname = extractXmlValue(achievementXml, 'apiname');
        const description = extractXmlValue(achievementXml, 'description');
        const unlockTimestampStr = extractXmlValue(achievementXml, 'unlockTimestamp');
        const unlocktime = unlockTimestampStr ? parseInt(unlockTimestampStr, 10) : 0;
        
        if (apiname && description) {
          achievementMap.set(apiname, { description, unlocktime });
        }
      }
      
      return achievementMap;
    } catch (error) {
      // Only log if it's not a rate limit or 403 error
      if (error instanceof Error && !error.message.includes('429') && !error.message.includes('403')) {
        console.error('Error fetching achievements from XML API:', error);
      }
      throw error;
    }
  }

  /**
   * Get friend list for a user
   */
  async getFriendList(steamId: string): Promise<string[]> {
    try {
      const url = `${STEAM_API_BASE}/ISteamUser/GetFriendList/v0001/?key=${this.apiKey}&steamid=${steamId}&relationship=friend`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.friendslist?.friends) {
        return data.friendslist.friends.map((friend: { steamid: string }) => friend.steamid);
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching friend list:', error);
      throw error;
    }
  }
}

// Singleton instance
let steamClient: SteamAPIClient | null = null;

export function getSteamClient(): SteamAPIClient {
  if (!steamClient) {
    const apiKey = process.env.STEAM_API_KEY;
    if (!apiKey) {
      throw new Error('STEAM_API_KEY environment variable is not set');
    }
    steamClient = new SteamAPIClient(apiKey);
  }
  return steamClient;
}
