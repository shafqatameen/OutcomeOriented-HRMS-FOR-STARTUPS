import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { can, type SessionUser } from "@/lib/access"

// Internal API URL for server-side requests
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://127.0.0.1:8000"

// `can` lives in ./access so Client Components can use it without dragging
// next/headers into the browser bundle. Re-exported here for Server Components.
export type CurrentUser = SessionUser;
export { can };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${INTERNAL_API_URL}/auth/me`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("getCurrentUser: failed to reach backend", err);
    return null;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Guard for the admin surfaces. Checked per page, not in a layout, so it
 *  re-runs on every navigation between sibling admin routes. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== "Admin") redirect("/login");
  return user;
}