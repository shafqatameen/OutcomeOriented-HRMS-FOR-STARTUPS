/**
 * The geometry of MyUniverse's three panes.
 *
 * All of it is here rather than in the component, and none of it touches the
 * DOM, because the awkward cases are arithmetic and deserve to be readable: a
 * pane dragged under the width at which it stops being usable, a row too narrow
 * to hold three of them at once, a stored preference written on a wide monitor
 * and read back on a laptop.
 *
 * Widths are stored as *shares* — proportions of the row, summing to one —
 * rather than pixels. A pixel preference is a lie the moment the window is
 * resized or the navigation rail is collapsed; a proportion survives both, and
 * the minimums below are what stop a proportion from being taken literally on a
 * screen where it would leave a pane too thin to read.
 */

export type Pane = "inbox" | "planner" | "board";

/** Left to right, always. The switcher and the row both read the order from here. */
export const PANE_ORDER: readonly Pane[] = ["inbox", "planner", "board"];

/**
 * The narrowest each pane may be dragged to, in pixels.
 *
 * These are the widths below which the pane stops doing its job rather than
 * round numbers: the Planner has a 48px hour gutter before its first day column,
 * so under ~280px three days cannot hold a legible heading; the Board's list
 * columns are a fixed 256px and one of them plus its gap is the floor. The Inbox
 * is the most forgiving, being a single column of wrapped text.
 */
export const PANE_MIN_WIDTH: Record<Pane, number> = {
  inbox: 200,
  planner: 280,
  board: 272,
};

/** The width of one divider, which is also the gap between two panes. */
export const DIVIDER_WIDTH = 10;

/** Proportions of the row, summing to 1 across all three panes. */
export type PaneShares = Record<Pane, number>;

/** The Board gets the largest share: it is the only pane that scrolls sideways. */
export const DEFAULT_PANE_SHARES: PaneShares = { inbox: 0.22, planner: 0.31, board: 0.47 };

export type PaneLayout = {
  shares: PaneShares;
  /** Panes the switcher has been asked to leave out. Never all three. */
  hidden: Pane[];
};

export const DEFAULT_PANE_LAYOUT: PaneLayout = { shares: DEFAULT_PANE_SHARES, hidden: [] };

/**
 * Keyed by account, so two people sharing a browser profile do not inherit each
 * other's layout. localStorage rather than the server because this is a property
 * of the screen being used, not of the person: the same account on a laptop and
 * on a monitor wants two different splits, and one column in `users` could only
 * ever hold one of them.
 */
export const paneStorageKey = (userId: number | null): string =>
  `oo.layout.universe.v1.${userId ?? "anon"}`;

/** Shares scaled to sum to 1, with anything unusable replaced by the default. */
export function normalizeShares(shares: Partial<Record<Pane, number>>): PaneShares {
  const cleaned = {} as PaneShares;
  for (const pane of PANE_ORDER) {
    const value = Number(shares[pane]);
    cleaned[pane] = Number.isFinite(value) && value > 0 ? value : DEFAULT_PANE_SHARES[pane];
  }
  const total = PANE_ORDER.reduce((sum, pane) => sum + cleaned[pane], 0);
  if (!(total > 0)) return { ...DEFAULT_PANE_SHARES };
  for (const pane of PANE_ORDER) cleaned[pane] /= total;
  return cleaned;
}

/**
 * A stored layout, or the default for anything that cannot be read as one.
 *
 * Deliberately forgiving: this is a display preference, and there is no version
 * of "your saved layout was corrupt" worth showing someone. A bad value falls
 * back per pane, so a single edited number does not discard the other two.
 */
export function readPaneLayout(raw: string | null): PaneLayout {
  if (!raw) return DEFAULT_PANE_LAYOUT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PANE_LAYOUT;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANE_LAYOUT;

  const { shares, hidden } = parsed as { shares?: Partial<Record<Pane, number>>; hidden?: unknown };
  const stored = Array.isArray(hidden) ? PANE_ORDER.filter((pane) => hidden.includes(pane)) : [];

  return {
    shares: normalizeShares(shares ?? {}),
    // A layout with nothing on screen reads as a broken page rather than as a
    // preference, so the last pane is restored instead of honoured. The switcher
    // refuses to get here in the first place; this guards a hand-edited value.
    hidden: stored.length >= PANE_ORDER.length ? [] : stored,
  };
}

export const serializePaneLayout = (layout: PaneLayout): string =>
  JSON.stringify({ shares: layout.shares, hidden: layout.hidden });

/** What the row must be able to give these panes before they can sit side by side. */
export function minimumRowWidth(panes: readonly Pane[]): number {
  if (panes.length === 0) return 0;
  const dividers = (panes.length - 1) * DIVIDER_WIDTH;
  return panes.reduce((sum, pane) => sum + PANE_MIN_WIDTH[pane], 0) + dividers;
}

/**
 * Pixel widths for the visible panes, from their shares and the row they have.
 *
 * Shares are only a request. A pane whose share works out narrower than its
 * minimum is pinned there and dropped out of the split, and the rest divide what
 * is left over in the same proportions they had — repeated, because satisfying
 * one pane's minimum can push the next one under its own. That is the whole
 * reason this is a loop and not a multiplication.
 *
 * The panes are normalized among themselves, so hiding one hands its width to
 * the others in proportion rather than leaving a gap where it was.
 */
export function resolvePaneWidths(
  shares: PaneShares,
  panes: readonly Pane[],
  rowWidth: number,
): Record<Pane, number> {
  const widths = {} as Record<Pane, number>;
  if (panes.length === 0) return widths;

  const available = rowWidth - (panes.length - 1) * DIVIDER_WIDTH;
  const floor = panes.reduce((sum, pane) => sum + PANE_MIN_WIDTH[pane], 0);

  // Narrower than the minimums themselves. Nothing here can be honoured, so the
  // panes shrink together in proportion rather than one being pushed off the
  // edge — callers switch to tabs well before this, and this only has to be
  // survivable rather than good.
  if (available <= floor) {
    for (const pane of panes) {
      widths[pane] = (PANE_MIN_WIDTH[pane] / floor) * Math.max(available, 0);
    }
    return widths;
  }

  const pinned = new Set<Pane>();
  for (;;) {
    const free = panes.filter((pane) => !pinned.has(pane));
    if (free.length === 0) break;

    let spare = available;
    for (const pane of panes) if (pinned.has(pane)) spare -= widths[pane];
    const weight = free.reduce((sum, pane) => sum + Math.max(shares[pane] ?? 0, 0), 0);

    let pinnedThisPass = false;
    for (const pane of free) {
      const share = weight > 0 ? Math.max(shares[pane] ?? 0, 0) / weight : 1 / free.length;
      const width = share * spare;
      if (width < PANE_MIN_WIDTH[pane]) {
        widths[pane] = PANE_MIN_WIDTH[pane];
        pinned.add(pane);
        pinnedThisPass = true;
      } else {
        widths[pane] = width;
      }
    }
    if (!pinnedThisPass) break;
  }

  // Floating point leaves a fraction of a pixel behind, which over three panes
  // is enough to show a hairline of page ground at the right edge.
  const drift = available - panes.reduce((sum, pane) => sum + widths[pane], 0);
  const last = panes[panes.length - 1];
  if (Math.abs(drift) > 0.0001) widths[last] = Math.max(widths[last] + drift, PANE_MIN_WIDTH[last]);
  return widths;
}

/**
 * The widths after dragging one divider by `delta` pixels.
 *
 * Only the two panes touching that divider change. This is what makes a drag
 * predictable — the alternative, pushing the change down the row, moves a pane
 * the pointer is nowhere near — and with two dividers every arrangement is still
 * reachable. The pair's combined width is conserved, so the row never has to be
 * re-laid-out mid-drag and neither neighbour can be squeezed past its minimum.
 */
export function resizeAt(
  widths: Record<Pane, number>,
  panes: readonly Pane[],
  divider: number,
  delta: number,
): Record<Pane, number> {
  const left = panes[divider];
  const right = panes[divider + 1];
  if (!left || !right) return widths;

  const pair = (widths[left] ?? 0) + (widths[right] ?? 0);
  const lowest = PANE_MIN_WIDTH[left];
  const highest = pair - PANE_MIN_WIDTH[right];
  // The pair cannot satisfy both minimums, so there is no honest place to put
  // the divider and it stays where it is.
  if (highest < lowest) return widths;

  const nextLeft = Math.min(Math.max((widths[left] ?? 0) + delta, lowest), highest);
  return { ...widths, [left]: nextLeft, [right]: pair - nextLeft };
}

/**
 * Measured widths turned back into shares worth storing.
 *
 * Panes that were not on screen keep the weight they already had. Their number
 * is on a different scale from the freshly measured ones, which does not matter:
 * `resolvePaneWidths` normalizes whatever subset it is given, so only the ratios
 * survive — and a pane brought back later returns at roughly the width it had
 * rather than at a default.
 */
export function sharesFromWidths(
  shares: PaneShares,
  widths: Record<Pane, number>,
  panes: readonly Pane[],
): PaneShares {
  const total = panes.reduce((sum, pane) => sum + (widths[pane] ?? 0), 0);
  if (!(total > 0)) return shares;
  const next: Partial<Record<Pane, number>> = { ...shares };
  for (const pane of panes) next[pane] = widths[pane] / total;
  return normalizeShares(next);
}

/** Where a divider sits between its two neighbours, as a percentage, for `aria-valuenow`. */
export function dividerPercent(
  widths: Record<Pane, number>,
  panes: readonly Pane[],
  divider: number,
): { now: number; min: number; max: number } {
  const left = panes[divider];
  const right = panes[divider + 1];
  const pair = (widths[left] ?? 0) + (widths[right] ?? 0);
  if (!(pair > 0)) return { now: 50, min: 0, max: 100 };
  return {
    now: Math.round(((widths[left] ?? 0) / pair) * 100),
    min: Math.round((PANE_MIN_WIDTH[left] / pair) * 100),
    max: Math.round(((pair - PANE_MIN_WIDTH[right]) / pair) * 100),
  };
}
