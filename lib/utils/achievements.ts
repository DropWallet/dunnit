export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * Calculate achievement rarity based on global percentage
 * - < 1% = legendary
 * - < 10% = rare
 * - < 50% = uncommon
 * - >= 50% = common
 */
export function calculateRarity(percentage?: number): AchievementRarity {
  if (percentage === undefined || percentage === null) {
    return 'common'; // Default if percentage not available
  }
  
  if (percentage < 1) {
    return 'legendary';
  } else if (percentage < 10) {
    return 'rare';
  } else if (percentage < 50) {
    return 'uncommon';
  } else {
    return 'common';
  }
}

/**
 * Get Tailwind class for rarity border color
 */
export function getRarityBorderClass(rarity: AchievementRarity): string {
  switch (rarity) {
    case 'legendary':
      return 'border-rarity-legendary';
    case 'rare':
      return 'border-rarity-rare';
    case 'uncommon':
      return 'border-rarity-uncommon';
    case 'common':
      return 'border-rarity-common';
    default:
      return 'border-rarity-common';
  }
}

/**
 * Format unlock date to "UNLOCKED DD MMM @ HH:MMam/pm"
 */
export function formatUnlockDate(date: Date): string {
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  
  return `UNLOCKED ${day} ${month} @ ${displayHours}:${displayMinutes}${ampm}`;
}
