import { cookies } from "next/headers"
import { redirect } from "next/navigation"

// Internal API URL for server-side requests
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://127.0.0.1:8000"

export type CurrentUser = { id: number; name: string; role: string };

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