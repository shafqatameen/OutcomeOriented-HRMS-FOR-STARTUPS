import type { Metadata } from "next";
import "./globals.css";

/**
 * No webfont is loaded. The type stack is Verdana (see `--font-sans` in
 * globals.css), which every target platform already has, so the app renders
 * its final typeface on the first paint with no swap and no network round
 * trip for the font.
 */

export const metadata: Metadata = {
  title: {
    default: "OutcomeOriented",
    template: "%s · OutcomeOriented",
  },
  description:
    "Task board, point ledger and goal tracking for a small team. Completed work earns points that drive the leaderboard.",
  applicationName: "OutcomeOriented",
  openGraph: {
    title: "OutcomeOriented",
    description:
      "Task board, point ledger and goal tracking for a small team. Completed work earns points that drive the leaderboard.",
    type: "website",
  },
  // The app sits behind a login; there is nothing here for a crawler.
  robots: { index: false, follow: false },
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
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
