"use client";

import { type AchievementRarity } from "@/lib/utils/achievements";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUnlockDate } from "@/lib/utils/achievements";

interface TrophyProps {
  rarity: AchievementRarity;
  percentage: number;
  iconUrl: string;
  name: string;
  unlockedAt?: Date;
  unlocked?: boolean;
}

const rarityConfig: Record<AchievementRarity, { 
  borderColor: string; 
  bgColor: string; 
  label: string;
  shadowOpacity: string;
}> = {
  legendary: {
    borderColor: "border-rarity-legendary",
    bgColor: "bg-rarity-legendary",
    label: "LEGENDARY",
    shadowOpacity: "0.62",
  },
  "very-rare": {
    borderColor: "border-rarity-very-rare",
    bgColor: "bg-rarity-very-rare",
    label: "VERY RARE",
    shadowOpacity: "0.6",
  },
  rare: {
    borderColor: "border-rarity-rare",
    bgColor: "bg-rarity-rare",
    label: "RARE",
    shadowOpacity: "0.6",
  },
  uncommon: {
    borderColor: "border-rarity-uncommon",
    bgColor: "bg-rarity-uncommon",
    label: "UNCOMMON",
    shadowOpacity: "0.6",
  },
  common: {
    borderColor: "border-rarity-common",
    bgColor: "bg-rarity-common",
    label: "COMMON",
    shadowOpacity: "0.6",
  },
};

export function Trophy({
  rarity,
  percentage,
  iconUrl,
  name,
  unlockedAt,
  unlocked = true,
}: TrophyProps) {
  const config = rarityConfig[rarity];
  const percentageText = percentage.toFixed(1);
  
  const tooltipContent = unlocked && unlockedAt 
    ? `${name}\n${formatUnlockDate(unlockedAt)}`
    : name;

  // Get shadow color - use HSL with CSS variable
  const getShadowStyle = () => {
    // Map rarity to CSS variable name
    const varName = rarity === "very-rare" ? "very-rare" : rarity;
    return {
      boxShadow: `0px 0px 24px 0 hsl(var(--color-rarity-${varName}) / ${config.shadowOpacity})`,
    };
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col justify-start items-center flex-grow-0 flex-shrink-0 relative space-y-[-1px] cursor-pointer">
            <p className="flex-grow-0 flex-shrink-0 text-2xl font-black text-center text-text-subdued/20 mb-[-8px]">
              {percentageText}%
            </p>
            <div className="flex flex-col justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-0">
              <div
                className={`flex flex-col justify-start items-start flex-grow-0 flex-shrink-0 h-20 w-20 gap-1.5 p-0.5 bg-background border-2 ${config.borderColor}`}
                style={getShadowStyle()}
              >
                <div className="flex flex-col justify-center items-center self-stretch flex-grow relative gap-1 p-1 bg-background">
                  <img
                    src={iconUrl}
                    alt=""
                    className={`self-stretch flex-grow-0 flex-shrink-0 object-cover ${unlocked ? '' : 'grayscale opacity-50'}`}
                  />
                </div>
              </div>
              {/* Small colored bar between image and label */}
              <div className={`flex-grow-0 flex-shrink-0 w-1 h-1.5 ${config.bgColor}`}></div>
              <div
                className={`flex justify-center items-center flex-grow-0 flex-shrink-0 w-24 relative gap-2 px-2.5 py-0.5 rounded-tl rounded-tr ${config.bgColor}`}
              >
                <p className="flex-grow-0 flex-shrink-0 text-xs font-bold text-left text-text-inverted-strong">
                  {config.label}
                </p>
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="whitespace-pre-line">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
