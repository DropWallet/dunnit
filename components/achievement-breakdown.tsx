"use client";

interface RarityCounts {
  legendary: number;
  'very-rare': number;
  rare: number;
  uncommon: number;
  common: number;
}

interface AchievementBreakdownProps {
  unlockedCount: number;
  rarityCounts: RarityCounts;
}

export function AchievementBreakdown({
  unlockedCount,
  rarityCounts,
}: AchievementBreakdownProps) {
  return (
    <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-4 mb-4">
      <p className="flex-grow-0 flex-shrink-0 text-2xl font-semibold text-center">
        <span className="flex-grow-0 flex-shrink-0 text-2xl font-semibold text-center text-text-weak">
          Total:
        </span>
        <span className="flex-grow-0 flex-shrink-0 text-2xl font-semibold text-center text-text-strong">
          {" "}{unlockedCount.toLocaleString()}
        </span>
      </p>
      <div className="grid grid-cols-2 md:flex md:flex-wrap justify-start items-start flex-grow-0 flex-shrink-0 gap-6 gap-y-3">
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
          <div className="flex-grow-0 flex-shrink-0 w-4 h-4 rounded-sm bg-rarity-legendary"></div>
          <p className="flex-grow-0 flex-shrink-0 text-base text-left">
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-weak">
              Legendary:
            </span>
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-strong">
              {" "}{rarityCounts.legendary.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
          <div className="flex-grow-0 flex-shrink-0 w-4 h-4 rounded-sm bg-rarity-very-rare"></div>
          <p className="flex-grow-0 flex-shrink-0 text-base text-left">
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-weak">
              Very rare:
            </span>
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-strong">
              {" "}{rarityCounts['very-rare'].toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
          <div className="flex-grow-0 flex-shrink-0 w-4 h-4 rounded-sm bg-rarity-rare"></div>
          <p className="flex-grow-0 flex-shrink-0 text-base text-left">
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-weak">
              Rare:
            </span>
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-strong">
              {" "}{rarityCounts.rare.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
          <div className="flex-grow-0 flex-shrink-0 w-4 h-4 rounded-sm bg-rarity-uncommon"></div>
          <p className="flex-grow-0 flex-shrink-0 text-base text-left">
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-subdued">
              Uncommon:
            </span>
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-strong">
              {" "}{rarityCounts.uncommon.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex justify-start items-center flex-grow-0 flex-shrink-0 relative gap-2">
          <div className="flex-grow-0 flex-shrink-0 w-4 h-4 rounded-sm bg-rarity-common"></div>
          <p className="flex-grow-0 flex-shrink-0 text-base text-left">
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-weak">
              Common:
            </span>
            <span className="flex-grow-0 flex-shrink-0 text-base text-left text-text-strong">
              {" "}{rarityCounts.common.toLocaleString()}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
