"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { useUserData } from "@/hooks/useUserData";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Navbar() {
  const router = useRouter();
  const { user } = useUserData(undefined, false); // Get logged-in user data, don't redirect on error

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  // Truncate username to 11 characters
  const displayUsername = user?.username 
    ? user.username.length > 11 
      ? `${user.username.slice(0, 11)}...` 
      : user.username
    : "Profile";

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex flex-col justify-center items-stretch overflow-hidden gap-2 px-4 md:px-8 py-3 bg-surface-low border-b border-border-weak">
      <div className="flex justify-between items-center">
        {/* Left side: Logo and Feed */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Logo - Link to Dashboard */}
          <Link href="/dashboard" className="flex-shrink-0">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-shrink-0"
              preserveAspectRatio="xMidYMid meet"
            >
              <circle cx="16" cy="16" r="16" fill="#FB64B6" />
            </svg>
          </Link>

          {/* Feed Link */}
          <Link href="/feed">
            <Button
              variant="ghost"
              size="sm"
              className="text-text-moderate"
            >
              Feed
            </Button>
          </Link>
        </div>

        {/* Right side: Profile Dropdown and Theme Toggle */}
        <div className="flex justify-center items-center gap-3">
          {/* Profile Dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-text-moderate"
                >
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="w-7 h-7 rounded-full object-cover border border-border-weak"
                    onError={(e) => {
                      // Show placeholder if image fails to load - gray circle with user icon
                      e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23666'/%3E%3Cpath d='M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 1c-2.21 0-4 1.79-4 4v1h8v-1c0-2.21-1.79-4-4-4z' fill='%23999'/%3E%3C/svg%3E";
                    }}
                  />
                  {displayUsername}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent 
                align="end"
                className="bg-surface-low border-border-weak text-text-strong min-w-[160px]"
              >
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="cursor-pointer">
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border-weak" />
                <DropdownMenuItem 
                  onClick={handleLogout}
                  className="cursor-pointer text-text-moderate"
                >
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
}
