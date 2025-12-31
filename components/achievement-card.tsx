"use client";

import { calculateRarity, formatUnlockDate, type AchievementRarity } from "@/lib/utils/achievements";

interface AchievementCardProps {
  name: string;
  description: string;
  iconUrl: string;
  unlockedAt?: Date;
  globalPercentage?: number;
}

function getRarityBgClass(rarity: AchievementRarity): string {
  switch (rarity) {
    case 'legendary':
      return 'bg-rarity-legendary';
    case 'rare':
      return 'bg-rarity-rare';
    case 'uncommon':
      return 'bg-rarity-uncommon';
    case 'common':
      return 'bg-rarity-common';
    default:
      return 'bg-rarity-common';
  }
}

export function AchievementCard({
  name,
  description,
  iconUrl,
  unlockedAt,
  globalPercentage,
}: AchievementCardProps) {
  const rarity = calculateRarity(globalPercentage);
  const rarityBgClass = getRarityBgClass(rarity);
  const percentage = typeof globalPercentage === 'number' 
    ? globalPercentage.toFixed(1) 
    : globalPercentage !== undefined && globalPercentage !== null
      ? String(globalPercentage)
      : 'N/A';

  return (
    <div className="flex justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative overflow-hidden gap-3 p-2 rounded-lg bg-surface-low border border-strong">
      {/* Achievement Icon */}
      <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2 p-1 rounded bg-surface-mid z-10">
        <img 
          src={iconUrl} 
          alt="" 
          className="flex-grow-0 flex-shrink-0 w-20 h-20 object-cover" 
        />
      </div>

      {/* Achievement Details */}
      <div className="flex flex-col justify-start items-start flex-grow relative gap-3 z-10">
        <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative">
          <p className="self-stretch flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-strong">
            {name}
          </p>
          <p className="self-stretch flex-grow-0 flex-shrink-0 text-sm text-left text-text-subdued">
            {description}
          </p>
        </div>
        {unlockedAt && (
          <p className="self-stretch flex-grow-0 flex-shrink-0 text-xs text-left text-text-weak">
            {formatUnlockDate(unlockedAt)}
          </p>
        )}
      </div>

      {/* Rarity Badge */}
      <div className="flex flex-col justify-between items-end self-stretch flex-grow-0 flex-shrink-0 relative py-1 rounded z-10">
        <div className={`flex justify-end items-start flex-grow-0 flex-shrink-0 relative gap-2 px-3 py-0.5 rounded-full ${rarityBgClass}`}>
          <p className="flex-grow-0 flex-shrink-0 tracking-widest text-xs font-bold text-left text-text-inverted-strong">
            {rarity.toUpperCase()}
          </p>
        </div>
        <p className="flex-grow-0 leading-none flex-shrink-0 text-right text-text-subdued">
          <span className="flex-grow-0 leading-none flex-shrink-0 text-2xl font-bold text-right text-text-subdued">
            {percentage}%
          </span>
          <br />
          <span className="flex-grow-0 flex-shrink-0 text-xs text-right text-text-subdued">
            of players have this
          </span>
        </p>
      </div>
    </div>
  );
}
