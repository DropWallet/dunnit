"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";

export function Navbar() {
  const router = useRouter();
  const { user } = useUserData(undefined, false); // Get logged-in user data, don't redirect on error

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  return (
    <nav className="flex flex-col justify-center items-stretch overflow-hidden gap-2 px-4 md:px-8 py-3 bg-surface-low">
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

        {/* Right side: Profile, Logout and Theme Toggle */}
        <div className="flex justify-center items-center gap-3">
          {/* Profile Link with Avatar */}
          {user && (
            <Link href="/dashboard">
              <button
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                  "h-9 rounded-md px-3",
                  "hover:bg-accent hover:text-accent-foreground text-text-moderate"
                )}
              >
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className="w-6 h-6 rounded-sm object-cover border border-[#1d293d]"
                  onError={(e) => {
                    // Show placeholder if image fails to load - gray circle with user icon
                    e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23666'/%3E%3Cpath d='M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 1c-2.21 0-4 1.79-4 4v1h8v-1c0-2.21-1.79-4-4-4z' fill='%23999'/%3E%3C/svg%3E";
                  }}
                />
                <span className="text-sm font-medium text-center text-text-moderate">
                  Profile
                </span>
              </button>
            </Link>
          )}

          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            className="text-text-moderate"
          >
            Log out
          </Button>
          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
}
