"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggleButton } from "@/components/theme-toggle-button";

export function Navbar() {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  return (
    <nav className="flex flex-col justify-center items-stretch overflow-hidden gap-2 px-4 md:px-8 py-3 bg-surface-low">
      <div className="flex justify-between items-center">
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

        {/* Right side: Logout and Theme Toggle */}
        <div className="flex justify-center items-center gap-4">
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
