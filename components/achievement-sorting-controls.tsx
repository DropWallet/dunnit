import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AchievementSortOption } from "@/lib/utils/sorting";

interface AchievementSortingControlsProps {
  sortBy: AchievementSortOption;
  onSortChange: (value: AchievementSortOption) => void;
}

export function AchievementSortingControls({
  sortBy,
  onSortChange,
}: AchievementSortingControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row flex-col-reverse justify-between items-start sm:items-center gap-4">
      <div className="flex items-center gap-2">
        <Select value={sortBy} onValueChange={(value) => onSortChange(value as AchievementSortOption)}>
          <SelectTrigger className="w-[200px] border-border-strong bg-surface-low text-text-strong">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent className="bg-surface-low border-border-strong">
            <SelectItem value="rarity" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Rarity
            </SelectItem>
            <SelectItem value="unlock-date" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Unlock date
            </SelectItem>
            <SelectItem value="name" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Name
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
