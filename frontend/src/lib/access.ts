/**
 * Pure permission helpers, safe on both sides of the client boundary.
 *
 * Deliberately free of `next/headers` and any other server-only import, because
 * the navigation rail is a Client Component and needs this logic too.
 */

export type SessionUser = {
  id: number;
  name: string;
  role: string;
  /** Effective feature keys. Admins receive the whole catalogue. */
  permissions?: string[];
};

/**
 * Whether this session may use a feature. Presentation only — the API enforces
 * the same check, so hiding a control is convenience, never security.
 */
export function can(user: SessionUser | null | undefined, permissionKey: string): boolean {
  if (!user) return false;
  if (user.role === "Admin") return true;
  return (user.permissions ?? []).includes(permissionKey);
}
