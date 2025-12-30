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
   */
  async getOwnedGames(steamId: string, includeAppInfo = true): Promise<SteamOwnedGamesResponse> {
    try {
      const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/?key=${this.apiKey}&steamid=${steamId}&include_appinfo=${includeAppInfo ? 1 : 0}&format=json`;
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
        throw new Error(`Steam API error: ${response.status}`);
      }

      const data: SteamPlayerAchievementsResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching player achievements:', error);
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
