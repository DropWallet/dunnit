"use client";

import Image from "next/image";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const SESSION_STORAGE_KEY = "privacy_modal_dismissed";

export function setPrivacyModalDismissed() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
  }
}

export function wasPrivacyModalDismissedThisSession(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SESSION_STORAGE_KEY) === "1";
}

interface SteamPrivacyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steamId: string;
}

export function SteamPrivacyModal({
  open,
  onOpenChange,
  steamId,
}: SteamPrivacyModalProps) {
  const handleDismiss = () => {
    setPrivacyModalDismissed();
    onOpenChange(false);
  };

  const handleOpenSteamSettings = () => {
    // Dismiss modal - user will refresh after updating settings
    setPrivacyModalDismissed();
    onOpenChange(false);
    // Open Steam settings in new tab
    window.open(
      `https://steamcommunity.com/profiles/${steamId}/edit/settings`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[544px] overflow-hidden p-0 border-0 gap-0 [&>button]:hidden">
        <div className="flex flex-col justify-start items-center overflow-hidden gap-6 p-6 rounded-lg bg-surface-low border border-border-weak">
          <div className="flex flex-col justify-start items-center flex-grow-0 flex-shrink-0 gap-6 w-full">
            {/* Title + body */}
            <div className="flex flex-col justify-start items-center self-stretch flex-grow-0 flex-shrink-0 relative gap-1">
              <p className="self-stretch flex-grow-0 flex-shrink-0 text-base font-semibold text-center text-text-strong">
                Welcome to Playd
              </p>
              <p className="self-stretch flex-grow-0 flex-shrink-0 text-sm text-center">
                <span className="text-sm text-center text-text-weak">
                  Your Steam account is set to private. To use Playd, you need to{" "}
                </span>
                <span className="text-sm text-center text-text-moderate">
                  make all Steam privacy settings public{" "}
                </span>
                <span className="text-sm text-center text-text-weak">
                  and then fully refresh this page. This applies to your friends
                  as well, if you want to see their details.
                </span>
              </p>
            </div>

            {/* Image */}
            <div className="flex flex-col justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-1 p-1 rounded-xl border-2 border-border-strong">
              <Image
                src="/steam-settings.png"
                alt="Steam privacy settings - set profile and game details to Public"
                width={512}
                height={347}
                className="flex-grow-0 flex-shrink-0 w-full h-auto rounded-lg object-cover"
              />
            </div>

            {/* Buttons */}
            <div className="flex flex-col justify-start items-end self-stretch flex-grow-0 flex-shrink-0 gap-2">
              <div className="flex justify-start items-start flex-grow-0 flex-shrink-0 gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDismiss}
                >
                  Understood
                </Button>
                <Button
                  type="button"
                  variant="default"
                  onClick={handleOpenSteamSettings}
                >
                  Open Steam settings
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
