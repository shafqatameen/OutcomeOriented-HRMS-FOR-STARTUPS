/**
 * Panel payload types and the pillar colour rule.
 *
 * Shapes mirror backend/app/modules/panel/schemas.py. Kept in one file so the
 * page, its components and the admin forms all read the same contract.
 */

export type Measured = {
  points: number;
  minutes: number;
  /** Percentage of the window, computed on whichever `unit` the panel reports. */
  share: number;
};

export type TrackRow = Measured & {
  track_id: number;
  name: string;
  default_points: number;
};

export type PillarRow = Measured & {
  pillar_id: number;
  name: string;
  slug: string;
  color_hex: string;
  is_company: boolean;
};

export type FunctionRow = Measured & {
  function_id: number;
  name: string;
  purpose: string | null;
  color_hex: string;
  pillar_id: number;
  pillar_name: string;
  pillar_slug: string;
  open_tasks: number;
  completed_tasks: number;
};

export type MatrixCell = Measured & { track_id: number; pillar_id: number };

export type Seat = {
  function_id: number;
  function_name: string;
  purpose: string | null;
  color_hex: string;
  pillar_id: number | null;
  pillar_name: string | null;
  pillar_slug: string | null;
};

export type OpenTask = {
  task_id: number;
  title: string;
  track_name: string;
  function_name: string;
  pillar_name: string;
  pillar_slug: string;
  color_hex: string;
  points: number;
};

export type Panel = {
  user: { id: number; name: string; role: string };
  seat: Seat | null;
  /** "minutes" only when every entry in the window is timed, else "points". */
  unit: "points" | "minutes";
  totals: {
    points: number;
    minutes: number;
    open_tasks: number;
    completed_tasks: number;
    entries: number;
    entries_with_minutes: number;
  };
  headline: {
    core_share: number;
    product_share_of_build_sell: number;
    customer_share_of_build_sell: number;
    has_build_sell: boolean;
    on_seat_share: number | null;
  };
  tracks: TrackRow[];
  pillars: PillarRow[];
  functions: FunctionRow[];
  matrix: MatrixCell[];
  open_work: OpenTask[];
};

/** A function row on the company rollup, which also knows how many people touched it. */
export type CompanyFunctionRow = FunctionRow & { contributors: number };

export type PersonRow = Measured & {
  user_id: number;
  name: string;
  role: string;
  seat_function_id: number | null;
  seat_function_name: string | null;
  seat_pillar_name: string | null;
  seat_pillar_slug: string | null;
  open_tasks: number;
  /** Of *their own* effort, not the company's. Null when they have no seat or logged nothing. */
  on_seat_share: number | null;
};

/** One person's effort in one pillar. `share` is of that person, not the company. */
export type PersonPillarCell = Measured & { user_id: number; pillar_id: number };

export type CompanyPanel = {
  unit: "points" | "minutes";
  totals: {
    points: number;
    minutes: number;
    open_tasks: number;
    completed_tasks: number;
    entries: number;
    entries_with_minutes: number;
    people: number;
    seated_people: number;
  };
  headline: {
    core_share: number;
    product_share_of_build_sell: number;
    customer_share_of_build_sell: number;
    has_build_sell: boolean;
    on_seat_share: number | null;
    untagged_share: number;
    top_pillar_name: string | null;
    top_pillar_slug: string | null;
    top_pillar_share: number | null;
    top_function_name: string | null;
    top_function_pillar_slug: string | null;
    top_function_share: number | null;
  };
  tracks: TrackRow[];
  pillars: PillarRow[];
  functions: CompanyFunctionRow[];
  matrix: MatrixCell[];
  people: PersonRow[];
  people_mix: PersonPillarCell[];
};

/**
 * The parts of a panel that the cross-tab and the coverage note actually read.
 *
 * Both figures are identical whether the rows came from one person or from the
 * whole company, so they take this structural slice rather than a `Panel` — one
 * component, one behaviour, and no second copy to drift out of sync.
 */
export type MixSource = Pick<Panel, "tracks" | "pillars" | "matrix" | "unit" | "totals">;

/**
 * The parts of a panel the pillar sheet reads.
 *
 * One person's panel and the company rollup both satisfy it, which is what lets
 * a single table answer "where did the company point" and "where did this one
 * person point" — the same rows, the same denominator rule, no second component
 * to drift away from this one.
 */
export type SheetSource = Pick<Panel, "unit" | "pillars" | "functions" | "totals">;

export type OrgFunction = {
  id: number;
  pillar_id: number;
  name: string;
  purpose: string | null;
  color_hex: string;
  position: number;
};

export type OrgPillar = {
  id: number;
  name: string;
  slug: string;
  color_hex: string;
  position: number;
  is_company: boolean;
  functions: OrgFunction[];
};

/**
 * Slugs with a designed pair of colour tokens in globals.css.
 *
 * A pillar added from the admin panel will not be in here, which is deliberate:
 * it falls back to `unassigned` grey rather than to an undefined CSS variable,
 * so an unstyled pillar is merely plain instead of invisible.
 */
const KNOWN_SLUGS = new Set([
  "ceo",
  "product",
  "customer",
  "business",
  "life",
  "unassigned",
]);

const resolveSlug = (slug: string | null | undefined) =>
  slug && KNOWN_SLUGS.has(slug) ? slug : "unassigned";

/**
 * The spreadsheet's own cell colour. Only for shapes big enough to read it —
 * a swatch or a bar segment — never a card fill or a button.
 */
export const pillarFill = (slug: string | null | undefined) =>
  `var(--pillar-${resolveSlug(slug)}-fill)`;

/**
 * The legible variant, for 3px rules and label text. Differs from the fill
 * because Customer's pale yellow vanishes as a hairline on white and CEO's grey
 * vanishes on the dark card.
 */
export const pillarInk = (slug: string | null | undefined) =>
  `var(--pillar-${resolveSlug(slug)}-ink)`;

/** "4h 25m" from minutes, or "13 pts" — whichever unit the panel is reporting. */
export function formatAmount(row: Measured, unit: Panel["unit"]): string {
  if (unit === "points") return `${row.points} ${row.points === 1 ? "pt" : "pts"}`;
  const hours = Math.floor(row.minutes / 60);
  const minutes = row.minutes % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** One decimal, but no trailing ".0" — 26.5% and 22%, not 22.0%. */
export const formatShare = (share: number) =>
  `${Number.isInteger(share) ? share : share.toFixed(1)}%`;
