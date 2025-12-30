import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

// Initialize with English locale (server-side only)
if (typeof window === 'undefined') {
  countries.registerLocale(enLocale);
}

/**
 * Get country name from ISO 3166-1 alpha-2 country code
 * Server-side only (uses i18n-iso-countries)
 */
export function getCountryName(countryCode: string): string | undefined {
  if (typeof window !== 'undefined') return undefined; // Client-side, return undefined
  if (!countryCode) return undefined;
  return countries.getName(countryCode, 'en');
}

/**
 * Get country flag emoji from ISO 3166-1 alpha-2 country code
 * Uses regional indicator symbols to create flag emojis
 * Works on both client and server
 */
export function getCountryFlag(countryCode: string): string | undefined {
  if (!countryCode || countryCode.length !== 2) return undefined;
  
  // Convert country code to flag emoji using regional indicator symbols
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  
  return String.fromCodePoint(...codePoints);
}
