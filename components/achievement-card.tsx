"use client";

import { calculateRarity, formatUnlockDate, type AchievementRarity } from "@/lib/utils/achievements";

interface AchievementCardProps {
  name: string;
  description: string;
  iconUrl: string;
  unlockedAt?: Date;
  globalPercentage?: number;
  unlocked?: boolean;
}

function getRarityBgClass(rarity: AchievementRarity): string {
  switch (rarity) {
    case 'legendary':
      return 'bg-rarity-legendary';
    case 'very-rare':
      return 'bg-rarity-very-rare';
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
  unlocked = true,
}: AchievementCardProps) {
  const rarity = calculateRarity(globalPercentage);
  const rarityBgClass = getRarityBgClass(rarity);
  const percentage = typeof globalPercentage === 'number' 
    ? globalPercentage.toFixed(1) 
    : globalPercentage !== undefined && globalPercentage !== null
      ? String(globalPercentage)
      : 'N/A';

  return (
    <div className={`flex flex-col md:flex-row md:justify-start md:items-center self-stretch flex-grow-0 flex-shrink-0 relative overflow-hidden gap-3 p-3 md:p-2 rounded-lg bg-surface-low border border-border-strong ${unlocked ? '' : 'opacity-50'}`}>
      {/* Icon and Achievement Info Section */}
      <div className="flex justify-start items-center self-stretch md:flex-grow md:flex-shrink-0 gap-3">
        {/* Achievement Icon */}
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2 p-1 rounded bg-surface-mid md:z-10" style={{ boxShadow: '0px 4px 6px -1px rgba(0,0,0,0.1), 0px 2px 4px -1px rgba(0,0,0,0.06)' }}>
          <img 
            src={iconUrl} 
            alt="" 
            className={`flex-grow-0 flex-shrink-0 w-16 h-16 md:w-20 md:h-20 object-cover ${unlocked ? '' : 'grayscale'}`}
          />
        </div>

        {/* Achievement Details */}
        <div className="flex flex-col justify-start items-start flex-grow relative gap-2 md:gap-3 md:z-10">
          <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative">
            <p className="self-stretch flex-grow-0 flex-shrink-0 text-lg font-semibold text-left text-text-strong">
              {name}
            </p>
            <p className="self-stretch flex-grow-0 flex-shrink-0 text-sm text-left text-text-subdued">
              {description}
            </p>
          </div>
          {unlocked ? (
            unlockedAt && (
              <p className="self-stretch flex-grow-0 flex-shrink-0 text-xs text-left text-text-weak">
                {formatUnlockDate(unlockedAt)}
              </p>
            )
          ) : (
            <p className="self-stretch flex-grow-0 flex-shrink-0 text-xs text-left text-text-weak">
              LOCKED
            </p>
          )}
        </div>
      </div>

      {/* Rarity Badge and Percentage Section */}
      <div className="flex flex-col justify-start items-start md:justify-between md:items-end self-stretch flex-grow-0 flex-shrink-0 relative gap-1.5 pt-3 md:pt-1 md:py-1 border-t md:border-t-0 border-border-strong mb:rounded md:z-10">
        <div className={`flex justify-end items-start flex-grow-0 flex-shrink-0 relative gap-2 px-3 py-0.5 rounded-full ${rarityBgClass}`}>
          <p className="flex-grow-0 flex-shrink-0 text-xs font-bold text-left text-text-inverted-strong">
            {rarity.toUpperCase()}
          </p>
        </div>
        <p className="self-stretch md:flex-grow-0 md:leading-none flex-shrink-0 text-sm md:text-right font-semibold text-left">
          <span className="self-stretch md:flex-grow-0 md:leading-none flex-shrink-0 text-sm md:text-2xl font-semibold md:font-bold text-left md:text-right text-text-strong md:text-text-subdued">
            {percentage}%
          </span>
          <span className="self-stretch flex-grow-0 flex-shrink-0 text-sm md:hidden font-semibold text-left text-text-weak">
            {" "}of players have this
          </span>
          <br className="hidden md:block" />
          <span className="hidden md:inline flex-grow-0 flex-shrink-0 text-xs text-right text-text-weak">
            of players have this
          </span>
        </p>
      </div>
    </div>
  );
}
