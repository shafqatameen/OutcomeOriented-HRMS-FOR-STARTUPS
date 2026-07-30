import {
  Trophy,
  CheckSquare,
  Target,
  Settings,
  ClipboardList,
  Flag,
  Tags,
  Tag,
  History,
  ListChecks,
  Layers,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type DestinationId = "leaderboard" | "tasks" | "goals" | "administration";

export type SubDestination = {
  id: string;
  label: string;
  route: string;
  glyph: LucideIcon;
  /** Hidden when the session lacks this key. */
  permission?: string;
};

export type Destination = {
  id: DestinationId;
  label: string;
  route: string;
  glyph: LucideIcon;
  /** Rendered disabled — never removed — when the session lacks this key. */
  permission?: string;
  /** Shown nested in the rail while this destination is active. */
  children?: SubDestination[];
};

/** Data the rail needs to build its dynamic sub-items. */
export type NavigationData = {
  categories: { id: number; name: string }[];
  goals: { id: number; title: string }[];
};

/**
 * The single source of truth for shell navigation. Order is fixed: destinations
 * are shown or disabled, never reordered, so position stays learnable.
 *
 * Tasks and Goals derive their children from data, so a category or goal added
 * elsewhere in the app shows up here without a code change.
 */
export function buildDestinations({ categories, goals }: NavigationData): Destination[] {
  return [
    {
      id: "leaderboard",
      label: "Leaderboard",
      route: "/",
      glyph: Trophy,
      permission: "leaderboard.view",
    },
    {
      id: "tasks",
      label: "Tasks",
      route: "/tasks",
      glyph: CheckSquare,
      permission: "tasks.view",
      children: [
        { id: "tasks-all", label: "All Tasks", route: "/tasks", glyph: ListChecks },
        ...categories.map((category) => ({
          id: `tasks-category-${category.id}`,
          label: category.name,
          route: `/tasks/category/${category.id}`,
          glyph: Tag,
        })),
        { id: "tasks-history", label: "History", route: "/tasks/history", glyph: History },
      ],
    },
    {
      id: "goals",
      label: "Goals",
      route: "/goals",
      glyph: Target,
      permission: "goals.view",
      children: [
        { id: "goals-all", label: "All Goals", route: "/goals", glyph: Layers },
        ...goals.map((goal) => ({
          id: `goal-${goal.id}`,
          label: goal.title,
          route: `/goals/${goal.id}`,
          glyph: Flag,
        })),
      ],
    },
    {
      id: "administration",
      label: "Admin",
      route: "/admin",
      glyph: Settings,
      // Any one admin surface is enough to make the section reachable; the
      // children carry the specific keys.
      permission: "admin.any",
      // Each child owns one admin surface, so the workspace shows one at a time
      // instead of stacking every form on a single page.
      children: [
        {
          id: "admin-tasks", label: "Assign Task", route: "/admin/tasks",
          glyph: ClipboardList, permission: "admin.tasks",
        },
        {
          id: "admin-goals", label: "Goals & Milestones", route: "/admin/goals",
          glyph: Flag, permission: "admin.goals",
        },
        {
          id: "admin-categories", label: "Categories", route: "/admin/categories",
          glyph: Tags, permission: "admin.categories",
        },
        {
          id: "admin-access", label: "Access", route: "/admin/access",
          glyph: ShieldCheck, permission: "admin.users",
        },
      ],
    },
  ];
}

/**
 * Whether the rail should offer this destination.
 *
 * "admin.any" is a pseudo-key: the Admin section opens if any single admin
 * surface is permitted, so someone granted only Categories still gets in.
 */
export function isDestinationPermitted(
  destination: Destination,
  can: (key: string) => boolean,
): boolean {
  if (!destination.permission) return true;
  if (destination.permission !== "admin.any") return can(destination.permission);
  return (destination.children ?? []).some((child) => !child.permission || can(child.permission));
}

/** Active state is derived from the route, never stored. */
export function isDestinationActive(route: string, pathname: string): boolean {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Exact match — a sub-destination is active only on its own route. */
export function isSubDestinationActive(route: string, pathname: string): boolean {
  return pathname === route;
}
