// Steam API response types

export interface SteamPlayerSummary {
  steamid: string;
  communityvisibilitystate: number;
  profilestate: number;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  avatarhash: string;
  lastlogoff?: number;
  personastate?: number;
  realname?: string;
  primaryclanid?: string;
  timecreated?: number;
  personastateflags?: number;
  loccountrycode?: string;
}

export interface SteamPlayerSummariesResponse {
  response: {
    players: SteamPlayerSummary[];
  };
}

export interface SteamGame {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url: string;
  img_logo_url: string;
  has_community_visible_stats?: boolean;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number; // Unix timestamp of last play time
}

export interface SteamOwnedGamesResponse {
  response: {
    game_count: number;
    games: SteamGame[];
  };
}

export interface SteamAchievement {
  apiname: string;
  achieved: number;
  unlocktime: number;
  name?: string;
  description?: string;
}

export interface SteamPlayerAchievementsResponse {
  playerstats: {
    steamID: string;
    gameName: string;
    achievements: SteamAchievement[];
    success: boolean;
  };
}

export interface SteamGameSchema {
  gameName: string;
  gameVersion: string;
  availableGameStats: {
    achievements: Array<{
      name: string;
      defaultvalue: number;
      displayName: string;
      hidden: number;
      description: string;
      icon: string;
      icongray: string;
    }>;
  };
}

export interface SteamGameSchemaResponse {
  game: SteamGameSchema;
}
