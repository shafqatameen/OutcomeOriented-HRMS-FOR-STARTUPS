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
