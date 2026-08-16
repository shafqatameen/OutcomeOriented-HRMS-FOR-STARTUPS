import { cookies } from "next/headers";

// Same internal address session.ts uses: server-to-server, not the browser origin.
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://127.0.0.1:8000";

/**
 * Authenticated read from a Server Component, forwarding the caller's session
 * cookie. Returns null rather than throwing so a rail or header can degrade to
 * an empty state instead of taking the whole page down.
 */
async function serverFetch<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${INTERNAL_API_URL}${path}`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`serverFetch ${path}: failed to reach backend`, err);
    return null;
  }
}

export type CategorySummary = { id: number; name: string; default_points: number };
export type MilestoneSummary = { id: number; title: string };
export type GoalSummary = { id: number; title: string; milestones?: MilestoneSummary[] };

export async function getCategoriesServer(): Promise<CategorySummary[]> {
  return (await serverFetch<CategorySummary[]>("/categories")) ?? [];
}

export async function getGoalsServer(): Promise<GoalSummary[]> {
  return (await serverFetch<GoalSummary[]>("/goals")) ?? [];
}

export type PillarSummary = { id: number; name: string; slug: string };

/**
 * The pillars alone, without their functions — enough for the rail's sub-items
 * and for a sub-page to resolve its own heading before first paint. The nested
 * tree is a client-side read on the page that actually needs the functions.
 */
export async function getPillarsServer(): Promise<PillarSummary[]> {
  return (await serverFetch<PillarSummary[]>("/org/pillars")) ?? [];
}

/**
 * How many captures are still unclarified, for the rail's badge.
 *
 * The count and not the items: this runs in the shell layout on every page, and
 * an inbox is the most unguarded thing anybody puts in this app — there is no
 * reason for its text to be fetched by a route that never displays it.
 *
 * Zero on failure, which reads as "nothing waiting". That is the right way to be
 * wrong: an absent badge is quieter than a badge showing a number nobody can
 * explain, and the Inbox page itself surfaces the real error.
 */
export async function getInboxCountServer(): Promise<number> {
  return (await serverFetch<{ count: number }>("/inbox/count"))?.count ?? 0;
}
