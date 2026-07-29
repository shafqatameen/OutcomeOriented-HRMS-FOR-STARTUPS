import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Trophy, CheckSquare, Target, Settings } from "lucide-react";
import NavUser from "@/components/NavUser";

export const metadata: Metadata = {
  title: "Gamified Point System",
  description: "Leaderboard & Tasks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <div className="min-h-screen">
          <nav className="border-b p-4 flex flex-col sm:flex-row gap-4 sm:gap-6 items-center justify-center sm:justify-start" style={{ background: "var(--background)" }}>
            <a href="/" className="font-bold text-lg text-primary flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              Leaderboard
            </a>
            <a href="/tasks" className="font-medium text-foreground hover:text-primary flex items-center gap-2">
              <CheckSquare className="w-4 h-4" />
              Tasks
            </a>
            <a href="/goals" className="font-medium text-foreground hover:text-primary flex items-center gap-2">
              <Target className="w-4 h-4" />
              Goals
            </a>
            <a href="/admin" className="font-medium text-foreground hover:text-primary flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Admin
            </a>
            <div className="sm:ml-auto">
              <Suspense fallback={null}>
                <NavUser />
              </Suspense>
            </div>
          </nav>
          <main className="p-4 md:p-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
