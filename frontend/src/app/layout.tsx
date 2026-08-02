import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gamified Point System",
  description: "Leaderboard & Tasks",
};

/**
 * Document shell only. Navigation lives in the (shell) layout so that (gate)
 * routes can opt out of it entirely.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Browser extensions inject attributes onto body before hydration
          (ColorZilla's cz-shortcut-listen, Grammarly's data-gr-*), which React
          reports as a mismatch. Suppression covers only this element's own
          attributes, not the tree below it. */}
      <body className={inter.className} suppressHydrationWarning>{children}</body>
    </html>
  );
}
