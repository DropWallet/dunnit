"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ThemeToggleButton } from "@/components/theme-toggle-button";

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
      <div className="relative min-h-screen flex items-center justify-center">
        {/* Background Image */}
        <div 
          className="fixed inset-0 w-full h-full z-0"
          style={{
            backgroundImage: 'url(/login-background.webp)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        
        {/* Gradient Overlay */}
        <div 
          className="fixed inset-0 w-full h-full z-10"
          style={{
            background: 'var(--gradient-login-overlay)',
          }}
        />
        
        <div className="relative z-20 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col justify-start items-center w-full min-h-screen gap-6 md:gap-0 py-4 md:p-0">
      {/* Background Image */}
      <div 
        className="fixed inset-0 w-full h-full z-0"
        style={{
          backgroundImage: 'url(/login-background.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      
      {/* Gradient Overlay */}
      <div 
        className="fixed inset-0 w-full h-full z-10"
        style={{
          background: 'var(--gradient-login-overlay)',
        }}
      />
      
      {/* Header with Logo and Theme Toggle - Fixed at top */}
      <div className="fixed md:invisible top-0 left-0 right-0 flex justify-between items-center flex-grow-0 flex-shrink-0 px-8 py-4 z-30">
        <svg
          width="107"
          height="24"
          viewBox="0 0 107 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="flex-grow-0 flex-shrink-0 w-[106.84px] h-6 text-inverted-strong"
        >
          <path d="M95.3374 18.9945V16.5067H92.7617V7.52105H95.3374V5.00391H104.235V7.52105H106.84V11.4724H103.094V8.9845H96.4789V15.0139H103.094V12.4968H106.84V16.5067H104.235V18.9945H95.3374Z" fill="#00A6F4"/>
          <path d="M79.8071 18.9945V16.5067H77.2314V7.52105H79.8071V5.00391H88.7049V7.52105H91.3099V11.4724H87.5634V8.9845H80.9486V15.0139H87.5634V12.4968H91.3099V16.5067H88.7049V18.9945H79.8071Z" fill="#00A6F4"/>
          <path d="M71.1624 18.6729V14.6631H74.8795V18.6729H71.1624Z" fill="#00A6F4"/>
          <path d="M57.3218 18.9956V16.5078H54.7461V7.52215H57.3218V5.00501H65.1073V0H68.8538V16.5078H66.2196V18.9956H57.3218ZM58.4633 15.015H65.0781V8.9856H58.4633V15.015Z" fill="currentColor"/>
          <path d="M41.4773 23.9995V21.5117H38.9016V17.5311H42.6188V20.0189H49.2629V16.5067H41.4773V13.9895H38.9016V5.00391H42.6188V12.4968H49.2629V5.00391H52.98V21.5117H50.4044V23.9995H41.4773Z" fill="currentColor"/>
          <path d="M24.4893 18.9945V16.5067H21.9136V7.52105H24.4893V5.00391H33.387V7.52105H35.992V15.0139H38.5969V18.9945H34.8505V16.5067H33.387V18.9945H24.4893ZM25.6307 15.0139H32.2456V8.9845H25.6307V15.0139Z" fill="currentColor"/>
          <path d="M16.4163 18.9956V0H20.1334V18.9956H16.4163Z" fill="currentColor"/>
          <path d="M0 23.8532V7.52105H2.57568V5.00391H11.4735V7.52105H14.0784V16.5067H11.4735V18.9945H3.71717V23.8532H0ZM3.71717 15.0139H10.332V8.9845H3.71717V15.0139Z" fill="currentColor"/>
        </svg>
        <div className="flex justify-center items-center flex-grow-0 flex-shrink-0 relative gap-2 p-2 rounded-md">
          <ThemeToggleButton />
        </div>
      </div>
      
      {/* Content Container */}
      <div className="relative z-20 flex flex-col md:flex-row-reverse justify-start items-center w-full md:items-stretch gap-6 md:gap-0 pt-20 md:p-0 md:h-screen ">
      {/* Login Card */}
      <div className="flex flex-col justify-start md:justify-center items-start md:items-center self-stretch md:w-1/2 md:h-full gap-2 px-4 pt-44 md:pt-4">
      <div className="flex flex-col justify-center items-center self-stretch md:self-auto md:max-w-md w-full overflow-hidden gap-6 pt-6 rounded-lg bg-surface-low border border-border">
          <div className="flex flex-col justify-start items-center flex-grow-0 flex-shrink-0 gap-5">
            <div className="flex flex-col justify-start items-center flex-grow-0 flex-shrink-0 relative gap-0.5">
              <p className="flex-grow-0 flex-shrink-0 text-xl font-bold text-left text-foreground">
                Welcome to playd
              </p>
              <p className="flex-grow-0 flex-shrink-0 text-sm text-center text-muted-foreground">
                Log in or sign up with steam to continue
              </p>
            </div>
            <Button
              onClick={handleSteamLogin}
              disabled={isLoading}
              className="flex justify-center items-center gap-2 px-4 py-2 rounded-md font-medium"
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
              <span className="flex-grow-0 flex-shrink-0 text-sm font-medium text-left">
                {isLoading ? "Connecting..." : "Login with Steam"}
              </span>
            </Button>
          </div>
          {/* Info Box */}
          <div className="flex justify-start items-start self-stretch flex-grow-0 flex-shrink-0 relative gap-2 p-4 bg-surface-mid">
            <Image
              src="/ic-info.svg"
              alt="Info"
              width={20}
              height={20}
              className="flex-grow-0 flex-shrink-0 w-5 h-5 relative"
            />
            <p className="flex-grow text-sm text-left text-muted-foreground">
              For the best experience, set your Steam profile to public.
            </p>
          </div>
        </div>
      </div>

      {/* Feature Section */}
      <div className="flex flex-col justify-center items-center self-stretch md:w-1/2 md:h-full md:py-4 gap-2 px-4 md:px-4 rounded-2xl">
        <div className="flex flex-col justify-center items-center w-full md:h-full relative gap-5 md:gap-6 px-5 py-6 rounded-lg bg-surface-low border border-border">
          {/* Logo and Theme Toggle - Absolutely positioned at top, visible on MD+ */}
          <div className="hidden md:flex justify-between items-center flex-grow-0 flex-shrink-0 w-full absolute left-0 top-0 p-4 z-10">
            <svg
              width="107"
              height="24"
              viewBox="0 0 107 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-grow-0 flex-shrink-0 w-[106.84px] h-6 text-inverted-strong"
            >
              <path d="M95.3374 18.9945V16.5067H92.7617V7.52105H95.3374V5.00391H104.235V7.52105H106.84V11.4724H103.094V8.9845H96.4789V15.0139H103.094V12.4968H106.84V16.5067H104.235V18.9945H95.3374Z" fill="#00A6F4"/>
              <path d="M79.8071 18.9945V16.5067H77.2314V7.52105H79.8071V5.00391H88.7049V7.52105H91.3099V11.4724H87.5634V8.9845H80.9486V15.0139H87.5634V12.4968H91.3099V16.5067H88.7049V18.9945H79.8071Z" fill="#00A6F4"/>
              <path d="M71.1624 18.6729V14.6631H74.8795V18.6729H71.1624Z" fill="#00A6F4"/>
              <path d="M57.3218 18.9956V16.5078H54.7461V7.52215H57.3218V5.00501H65.1073V0H68.8538V16.5078H66.2196V18.9956H57.3218ZM58.4633 15.015H65.0781V8.9856H58.4633V15.015Z" fill="currentColor"/>
              <path d="M41.4773 23.9995V21.5117H38.9016V17.5311H42.6188V20.0189H49.2629V16.5067H41.4773V13.9895H38.9016V5.00391H42.6188V12.4968H49.2629V5.00391H52.98V21.5117H50.4044V23.9995H41.4773Z" fill="currentColor"/>
              <path d="M24.4893 18.9945V16.5067H21.9136V7.52105H24.4893V5.00391H33.387V7.52105H35.992V15.0139H38.5969V18.9945H34.8505V16.5067H33.387V18.9945H24.4893ZM25.6307 15.0139H32.2456V8.9845H25.6307V15.0139Z" fill="currentColor"/>
              <path d="M16.4163 18.9956V0H20.1334V18.9956H16.4163Z" fill="currentColor"/>
              <path d="M0 23.8532V7.52105H2.57568V5.00391H11.4735V7.52105H14.0784V16.5067H11.4735V18.9945H3.71717V23.8532H0ZM3.71717 15.0139H10.332V8.9845H3.71717V15.0139Z" fill="currentColor"/>
            </svg>
            <div className="flex justify-center items-center flex-grow-0 flex-shrink-0 relative gap-2 p-2 rounded-md">
              <ThemeToggleButton />
            </div>
          </div>
          {/* Placeholder for screenshot/mockup */}
          <div className="flex flex-col justify-center items-center self-stretch md:max-w-lg md:mx-auto relative ">
            <p className="self-stretch flex-grow-0 flex-shrink-0 w-full text-xl md:text-3xl font-semibold text-left text-foreground">
              Your Steam community, at a glance.
            </p>
            <p className="self-stretch flex-grow-0 flex-shrink-0 w-full leading-tight text-xl md:text-3xl font-semibold text-left text-muted-foreground">
              See your friends' achievements and progress (or lack of).
            </p>
          </div>
          <div className="flex flex-col justify-center items-center self-stretch md:max-w-lg md:mx-auto relative">
            <p className="self-stretch flex-grow-0 flex-shrink-0 w-full text-md md:text-xl font-semibold text-left text-muted-foreground">
              No suggestions, no noise, no ads. Just a simple feed of what your friends are actually
              playing. That's it.
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
