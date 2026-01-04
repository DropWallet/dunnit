import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GameSortOption } from "@/lib/utils/sorting";

interface GameSortingControlsProps {
  sortBy: GameSortOption;
  onSortChange: (value: GameSortOption) => void;
  showUnplayed: boolean;
  onShowUnplayedChange: (checked: boolean) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function GameSortingControls({
  sortBy,
  onSortChange,
  showUnplayed,
  onShowUnplayedChange,
  onRefresh,
  isLoading = false,
}: GameSortingControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row flex-col-reverse justify-between items-start sm:items-center gap-4">
      {/* Sort Dropdown */}
      <div className="flex items-center gap-2">
        <Select value={sortBy} onValueChange={(value) => onSortChange(value as GameSortOption)}>
          <SelectTrigger className="w-[200px] border-border-strong bg-surface-low text-text-strong">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent className="bg-surface-low border-border-strong">
            <SelectItem value="last-played" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Date played
            </SelectItem>
            <SelectItem value="most-played" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Most played
            </SelectItem>
            <SelectItem value="least-played" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Least played
            </SelectItem>
            <SelectItem value="recent-playtime" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Recent playtime
            </SelectItem>
            <SelectItem value="name-asc" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Name (A-Z)
            </SelectItem>
            <SelectItem value="name-desc" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Name (Z-A)
            </SelectItem>
            <SelectItem value="achievement-progress" className="text-text-strong focus:bg-surface-mid focus:text-text-strong">
              Achievement progress
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Refresh Button and Show Unplayed Toggle */}
      <div className="flex items-center gap-2">
        {onRefresh && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onRefresh}
                  variant="outline"
                  size="sm"
                  className="w-9"
                  disabled={isLoading}
                >
                  <RefreshCw className="h-4 w-4" />
                  <span className="sr-only">Refresh games</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh games</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Switch
          id="show-unplayed"
          checked={showUnplayed}
          onCheckedChange={(checked) => onShowUnplayedChange(checked === true)}
        />
        <Label
          htmlFor="show-unplayed"
          className="text-sm text-text-strong cursor-pointer"
        >
          Show unplayed games
        </Label>
      </div>
    </div>
  );
}
