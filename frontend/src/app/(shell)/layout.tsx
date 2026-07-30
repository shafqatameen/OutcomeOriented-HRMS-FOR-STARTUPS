import { getCurrentUser } from "@/lib/session";
import { getCategoriesServer, getGoalsServer } from "@/lib/server-api";
import NavigationRail from "@/components/NavigationRail";

/**
 * Authenticated app shell. The rail is mounted here so it persists across
 * navigation instead of remounting per route. Pages keep their own access
 * guards; this layout only needs the session and the rail's sub-item data.
 */
export default async function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, categories, goals] = await Promise.all([
    getCurrentUser(),
    getCategoriesServer(),
    getGoalsServer(),
  ]);

  return (
    <div className="flex min-h-svh">
      <NavigationRail user={user} data={{ categories, goals }} />
      {/* Sole scroll and growth owner. The content cap lives here, not on the
          viewport, so the rail cannot starve the content column. */}
      <main className="min-w-0 flex-1 pt-14 md:pt-0">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
