import {
  Trophy,
  CheckSquare,
  Target,
  Settings,
  LayoutDashboard,
  Building2,
  Compass,
  ClipboardList,
  Flag,
  Tags,
  Tag,
  History,
  LayoutGrid,
  ListChecks,
  Layers,
  Milestone,
  Orbit,
  ShieldCheck,
  Users,
  Download,
  type LucideIcon,
} from "lucide-react";

export type DestinationId =
  | "universe"
  | "panel"
  | "company"
  | "pillars"
  | "leaderboard"
  | "tasks"
  | "goals"
  | "export"
  | "administration";

/**
 * One row in the rail, at any depth.
 *
 * The type is recursive rather than one type per level: nothing about a row
 * changes when it moves a level down, and a fixed two-level shape meant every
 * new tier needed a parallel type, a parallel permission filter and a parallel
 * branch in the renderer. Depth is a property of the tree, not of the row.
 *
 * The rail renders whatever depth it is handed, so a section can nest as far as
 * the domain actually nests — Goals › one goal › its milestones today.
 */
export type NavItem = {
  id: string;
  label: string;
  route: string;
  glyph: LucideIcon;
  /**
   * At the top level the row is rendered disabled when the session lacks this
   * key; below it the row is removed. The parent already communicates the
   * section, so a nested wall of locked rows is noise.
   */
  permission?: string;
  /** Shown nested in the rail while this row's branch is open. */
  children?: NavItem[];
  /** Count shown on the row. Hidden at zero — a badge reading 0 is not news. */
  badge?: number;
  /**
   * Extra routes that count as this section, beyond `route` and its descendants.
   * Needed when a child sits outside the parent's path — see isDestinationActive.
   */
  sectionRoutes?: string[];
};

/** Any row below the top level. Kept as a name because that is what it means. */
export type SubDestination = NavItem;

/** A top-level row. Only these have a fixed, known id. */
export type Destination = NavItem & { id: DestinationId };

/** Data the rail needs to build its dynamic sub-items. */
export type NavigationData = {
  categories: { id: number; name: string }[];
  /** Milestones ride along with the goal — they are the rail's third level. */
  goals: { id: number; title: string; milestones?: { id: number; title: string }[] }[];
  pillars: { id: number; name: string }[];
  /** Unclarified captures, for the Inbox badge. */
  inboxCount: number;
};

/**
 * The single source of truth for shell navigation. Order is fixed: destinations
 * are shown or disabled, never reordered, so position stays learnable.
 *
 * Tasks, Goals and Pillars derive their children from data, so a category, goal
 * or pillar added elsewhere in the app shows up here without a code change.
 */
export function buildDestinations({
  categories,
  goals,
  pillars,
  inboxCount,
}: NavigationData): Destination[] {
  return [
    // Above everything, including My Panel. The panel says where your effort
    // went; MyUniverse says what you have not decided about yet, and an
    // unprocessed inbox invalidates every other number on the rail — you cannot
    // trust a picture of your commitments while some of them are still
    // uncounted. Its badge is the one piece of nagging this app should do.
    //
    // The row was "Inbox" until MyUniverse existed. Capture is still where the
    // section starts, but it is no longer the whole of it: the same page now
    // holds the board every captured item ends up on and the day grid the dated
    // ones land in, so naming the row after one of its three panes would hide
    // the other two.
    //
    // Childless on purpose. The page itself is the switcher — inbox, planner and
    // board are three panes of one workspace, not three destinations — so a
    // sub-row per pane duplicated a control that already exists on the page and
    // implied a navigation where there is none. The lists a captured item gets
    // clarified into keep their own routes and are still recognised as this
    // section via sectionRoutes; they are reached from the capture flow rather
    // than from a permanent row each.
    {
      id: "universe",
      label: "MyUniverse",
      route: "/universe",
      glyph: Orbit,
      permission: "boards.write",
      badge: inboxCount,
      sectionRoutes: ["/inbox", "/waiting", "/someday", "/reference"],
    },
    // First of the reporting surfaces, and deliberately above the leaderboard:
    // this is the one page that is about the person reading it rather than
    // about the team.
    {
      id: "panel",
      label: "My Panel",
      route: "/panel",
      glyph: LayoutDashboard,
      permission: "panel.view",
    },
    // Directly under My Panel because it is the same rollup one level up: the
    // personal mix, then the mix those add up to.
    {
      id: "company",
      label: "Company Focus",
      route: "/company",
      glyph: Building2,
      permission: "panel.view.all",
    },
    // The same effort in the shape of the spreadsheet this whole taxonomy came
    // from. It sits under Company Focus because that page argues about the mix
    // and this one is the evidence: every function, including the ones nobody
    // touched. Opens for anyone with a panel — without `panel.view.all` it is
    // simply their own sheet.
    {
      id: "pillars",
      label: "Pillars",
      route: "/pillars",
      glyph: LayoutGrid,
      permission: "panel.view",
      children: [
        { id: "pillars-all", label: "All Pillars", route: "/pillars", glyph: Layers },
        ...pillars.map((pillar) => ({
          id: `pillar-${pillar.id}`,
          label: pillar.name,
          route: `/pillars/${pillar.id}`,
          glyph: Compass,
        })),
      ],
    },
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
          // The rail's third level, and the reason the tree is recursive: a goal
          // is a list of milestones, so the rail should say so once you are in
          // one. They are sections of the goal's page rather than pages of their
          // own, hence hash links — see isSubDestinationActive for what that
          // costs.
          children: (goal.milestones ?? []).map((milestone) => ({
            id: `goal-${goal.id}-milestone-${milestone.id}`,
            label: milestone.title,
            route: `/goals/${goal.id}#milestone-${milestone.id}`,
            glyph: Milestone,
          })),
        })),
      ],
    },
    {
      id: "export",
      label: "Export",
      route: "/export",
      glyph: Download,
      permission: "data.export",
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
          id: "admin-org", label: "Pillars & Functions", route: "/admin/org",
          glyph: Compass, permission: "admin.taxonomy",
        },
        {
          id: "admin-people", label: "People", route: "/admin/people",
          glyph: Users, permission: "admin.users",
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
  destination: NavItem,
  can: (key: string) => boolean,
): boolean {
  if (!destination.permission) return true;
  if (destination.permission !== "admin.any") return can(destination.permission);
  return (destination.children ?? []).some((child) => !child.permission || can(child.permission));
}

/**
 * Active state is derived from the route, never stored.
 *
 * A destination is normally active on its own route and anything beneath it.
 * MyUniverse is the exception: the lists a captured item gets clarified into live
 * at top-level paths (`/inbox`, `/waiting`) rather than under `/universe`, because
 * none of them is a sub-view of the board — they are where things go *instead* of
 * it. The rail gives them no row of their own, but standing on one of those pages
 * is still standing in this section, so a destination may name extra routes that
 * belong to it.
 */
export function isDestinationActive(
  destination: Pick<NavItem, "route" | "sectionRoutes">,
  pathname: string,
): boolean {
  const owns = (route: string) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`);
  return owns(destination.route) || (destination.sectionRoutes ?? []).some(owns);
}

/**
 * Exact match — a sub-destination is active only on its own route.
 *
 * A row linking into a page rather than to one is never active: `pathname`
 * carries no hash, so every milestone under the open goal would match equally
 * and the rail would highlight all of them. None of them is the honest answer,
 * and the goal above them is already marked.
 */
export function isSubDestinationActive(route: string, pathname: string): boolean {
  if (route.includes("#")) return false;
  return pathname === route;
}

/**
 * Whether a row's children should be showing.
 *
 * Open means "you are somewhere in here", which is true of the row itself and of
 * anything beneath it — so a goal's milestones appear once you open that goal,
 * without any row storing whether it is expanded. Recursion is what lets this
 * work at the fourth level as well as the second.
 */
export function isBranchOpen(item: NavItem, pathname: string): boolean {
  if (isDestinationActive(item, pathname)) return true;
  return (item.children ?? []).some((child) => isBranchOpen(child, pathname));
}
