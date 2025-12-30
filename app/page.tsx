"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    fetch("/api/user")
      .then((res) => {
        if (res.ok) {
          router.push("/dashboard");
        } else {
          setIsChecking(false);
        }
      })
      .catch(() => {
        setIsChecking(false);
      });
  }, [router]);

  const handleSteamLogin = () => {
    setIsLoading(true);
    window.location.href = "/api/auth/steam";
  };

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-center items-center min-h-screen w-full overflow-hidden bg-background">
      <div className="flex flex-col justify-center items-center flex-grow overflow-hidden gap-10 px-8 py-10 w-full max-w-md">
        <div className="flex flex-col justify-center items-center flex-grow-0 flex-shrink-0 gap-6 p-6 rounded-lg bg-card border border-border w-full">
          <div className="flex flex-col justify-start items-center flex-grow-0 flex-shrink-0 relative gap-0.5">
            <p className="flex-grow-0 flex-shrink-0 text-2xl font-semibold text-center text-foreground">
              Welcome to Dunnit
            </p>
            <p className="flex-grow-0 flex-shrink-0 text-sm text-center text-muted-foreground">
              Log in with steam to continue
            </p>
          </div>
          <Button
            onClick={handleSteamLogin}
            disabled={isLoading}
            className="w-full justify-center gap-2"
            size="lg"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-grow-0 flex-shrink-0 w-6 h-6 relative"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                d="M12 2C13.3132 2 14.6136 2.25866 15.8268 2.7612C17.0401 3.26375 18.1425 4.00035 19.0711 4.92893C19.9997 5.85752 20.7362 6.95991 21.2388 8.17317C21.7413 9.38642 22 10.6868 22 12C22 14.6522 20.9464 17.1957 19.0711 19.0711C17.1957 20.9464 14.6522 22 12 22C7.4 22 3.55 18.92 2.36 14.73L6.19 16.31C6.32124 16.9506 6.66949 17.5262 7.17597 17.9398C7.68245 18.3534 8.31612 18.5795 8.97 18.58C10.53 18.58 11.8 17.31 11.8 15.75V15.62L15.2 13.19H15.28C17.36 13.19 19.05 11.5 19.05 9.42C19.05 7.34 17.36 5.65 15.28 5.65C13.2 5.65 11.5 7.34 11.5 9.42V9.47L9.13 12.93L8.97 12.92C8.38 12.92 7.83 13.1 7.38 13.41L2 11.2C2.43 6.05 6.73 2 12 2ZM8.28 17.17C9.08 17.5 10 17.13 10.33 16.33C10.66 15.53 10.28 14.62 9.5 14.29L8.22 13.76C8.71 13.58 9.26 13.57 9.78 13.79C10.31 14 10.72 14.41 10.93 14.94C11.15 15.46 11.15 16.04 10.93 16.56C10.5 17.64 9.23 18.16 8.15 17.71C7.65 17.5 7.27 17.12 7.06 16.67L8.28 17.17ZM17.8 9.42C17.8 10.81 16.67 11.94 15.28 11.94C14.6134 11.9374 13.975 11.6707 13.5046 11.1984C13.0341 10.7261 12.77 10.0866 12.77 9.42C12.7687 9.09001 12.8327 8.76303 12.9584 8.4579C13.084 8.15278 13.2689 7.87555 13.5022 7.64221C13.7356 7.40887 14.0128 7.22404 14.3179 7.09837C14.623 6.9727 14.95 6.90868 15.28 6.91C15.9466 6.90999 16.5861 7.17412 17.0584 7.64455C17.5307 8.11498 17.7974 8.75339 17.8 9.42ZM13.4 9.42C13.4 10.46 14.24 11.31 15.29 11.31C16.33 11.31 17.17 10.46 17.17 9.42C17.17 8.38 16.33 7.53 15.29 7.53C14.24 7.53 13.4 8.38 13.4 9.42Z"
                fill="currentColor"
              />
            </svg>
            <span className="text-sm font-medium">
              {isLoading ? "Connecting..." : "Login with Steam"}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
