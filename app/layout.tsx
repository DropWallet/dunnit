import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const dmSans = DM_Sans({ 
  subsets: ["latin"],
  variable: "--font-sans",
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Playd - Your Steam community, at a glance. See your friends' achievements and progress (or lack of).",
  description: "Your Steam community, at a glance. See your friends' achievements and progress (or lack of).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={dmSans.variable}>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

