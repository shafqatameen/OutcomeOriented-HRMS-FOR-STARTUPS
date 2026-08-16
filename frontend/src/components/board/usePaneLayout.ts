"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_PANE_LAYOUT,
  DEFAULT_PANE_SHARES,
  PANE_ORDER,
  minimumRowWidth,
  paneStorageKey,
  readPaneLayout,
  resizeAt,
  resolvePaneWidths,
  serializePaneLayout,
  sharesFromWidths,
  type Pane,
  type PaneLayout,
} from "@/lib/panes";

/** How far an arrow key moves a divider, and how far Shift+arrow does. */
const NUDGE = 16;
const NUDGE_FAST = 64;

/** The tab a narrow screen opens on: the board is the pane the other two feed. */
const DEFAULT_ACTIVE: Pane = "board";

/**
 * The stored layout, read through `useSyncExternalStore`.
 *
 * localStorage is an external store, and treating it as one rather than as
 * something to copy into state in an effect is what lets the server render and
 * the first client render agree without a setState round trip. The cache exists
 * because `getSnapshot` must return the same object every time until something
 * actually changes — parsing afresh on each call returns a new object, which
 * React reads as a change and re-renders forever.
 */
const listeners = new Set<() => void>();
let cache: { key: string; layout: PaneLayout } | null = null;

function subscribeLayout(onStoreChange: () => void) {
  // Another tab writing the key leaves this one's cache stale, so it is dropped
  // before the notification rather than after.
  const onStorage = () => {
    cache = null;
    onStoreChange();
  };
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function layoutSnapshot(key: string): PaneLayout {
  if (cache?.key === key) return cache.layout;
  let layout = DEFAULT_PANE_LAYOUT;
  try {
    layout = readPaneLayout(window.localStorage.getItem(key));
  } catch {
    // Storage disabled. The defaults are a perfectly good layout.
  }
  cache = { key, layout };
  return layout;
}

function writeLayout(key: string, layout: PaneLayout) {
  cache = { key, layout };
  try {
    window.localStorage.setItem(key, serializePaneLayout(layout));
  } catch {
    // Private mode, or a full quota. A layout that is not remembered is a much
    // smaller problem than a page that will not render, and the cache above
    // still keeps it for this session.
  }
  listeners.forEach((notify) => notify());
}

export type PaneLayoutController = {
  /**
   * Told the width of the element the panes sit in, which decides everything
   * else. A number rather than the element itself: the measuring is the row's
   * own business, and a hook that took a ref would be a hook every caller had to
   * hand a DOM node to.
   */
  measureRow: (width: number | null) => void;
  /** Panes side by side, as opposed to one at a time behind tabs. */
  wide: boolean;
  /** Panes the switcher is keeping on screen, left to right. */
  visible: Pane[];
  /** Panes actually rendered right now — `visible` when wide, the open tab when not. */
  mounted: Pane[];
  isMounted: (pane: Pane) => boolean;
  widths: Record<Pane, number>;
  /** The open tab, which only means anything on a narrow screen. */
  active: Pane;
  setActive: (pane: Pane) => void;
  /** Shows or hides a pane. Refuses to hide the last one. */
  toggle: (pane: Pane) => void;
  /** Back to the default split — the way out of a layout dragged into a corner. */
  resetSizes: () => void;
  /** True while a divider is being dragged, for the row's cursor and text selection. */
  resizing: boolean;
  startResize: (divider: number, event: React.PointerEvent<HTMLElement>) => void;
  moveResize: (event: React.PointerEvent<HTMLElement>) => void;
  endResize: (event: React.PointerEvent<HTMLElement>) => void;
  nudge: (divider: number, event: React.KeyboardEvent<HTMLElement>) => void;
};

/**
 * Owns how wide each pane is, which of them are on screen, and how that is
 * remembered.
 *
 * The one decision worth pointing at is that side-by-side versus tabs is settled
 * by measuring the row, not by a CSS breakpoint. The row is not the viewport —
 * the navigation rail takes 240px of it, or 64px once collapsed — so a viewport
 * query answers a question nobody asked and gets a 1024px laptop wrong in both
 * directions. Measuring means the panes appear the moment there is genuinely
 * room for all three at their minimums, including when that happens because the
 * rail was collapsed rather than because the window changed.
 *
 * A consequence worth knowing: only the mounted panes are rendered, never hidden
 * with CSS. Two copies of a card would hand dnd-kit two draggables sharing an
 * id, and the drag would land in whichever it saw first.
 */
export function usePaneLayout(userId: number | null): PaneLayoutController {
  const key = paneStorageKey(userId);
  const stored = useSyncExternalStore(
    subscribeLayout,
    () => layoutSnapshot(key),
    () => DEFAULT_PANE_LAYOUT,
  );
  const { shares, hidden } = stored;

  const [active, setActive] = useState<Pane>(DEFAULT_ACTIVE);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const measureRow = useCallback((width: number | null) => setRowWidth(width), []);

  const visible = useMemo(() => PANE_ORDER.filter((pane) => !hidden.includes(pane)), [hidden]);

  const wide = rowWidth !== null && rowWidth >= minimumRowWidth(visible);
  const mounted = useMemo(() => (wide ? visible : [active]), [wide, visible, active]);

  const settled = useMemo(
    () => resolvePaneWidths(shares, visible, rowWidth ?? 0),
    [shares, visible, rowWidth],
  );

  // Live widths during a drag. Kept apart from the stored shares so a drag is
  // one state update per pointer move rather than a round trip through storage,
  // and so an interrupted drag leaves the saved preference untouched.
  const [dragWidths, setDragWidths] = useState<Record<Pane, number> | null>(null);
  const drag = useRef<{
    pointerId: number;
    divider: number;
    startX: number;
    base: Record<Pane, number>;
    latest: Record<Pane, number>;
  } | null>(null);

  const widths = dragWidths ?? settled;

  const commit = useCallback(
    (next: Record<Pane, number>, panes: Pane[]) => {
      writeLayout(key, { shares: sharesFromWidths(shares, next, panes), hidden });
    },
    [key, shares, hidden],
  );

  const startResize = useCallback(
    (divider: number, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        divider,
        startX: event.clientX,
        base: widths,
        latest: widths,
      };
      setDragWidths(widths);
    },
    [widths],
  );

  const moveResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      // Measured from where the drag began rather than accumulated per move, so
      // a pointer dragged past a minimum and back returns to where it was
      // instead of leaving the divider stranded at the clamp.
      const next = resizeAt(current.base, visible, current.divider, event.clientX - current.startX);
      current.latest = next;
      setDragWidths(next);
    },
    [visible],
  );

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragWidths(null);
      // From the ref rather than from `dragWidths`: this handler closed over the
      // render that started the drag, and every move since then is only in here.
      commit(current.latest, visible);
    },
    [commit, visible],
  );

  const nudge = useCallback(
    (divider: number, event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? NUDGE_FAST : NUDGE;
      const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      if (delta === 0) return;
      event.preventDefault();
      commit(resizeAt(widths, visible, divider, delta), visible);
    },
    [commit, widths, visible],
  );

  const toggle = useCallback(
    (pane: Pane) => {
      const isHidden = hidden.includes(pane);
      // Refusing to hide the last pane rather than letting the workspace go
      // blank: there is nothing useful on the other side of that click.
      if (!isHidden && hidden.length + 1 >= PANE_ORDER.length) return;
      const next = isHidden ? hidden.filter((other) => other !== pane) : [...hidden, pane];
      writeLayout(key, { shares, hidden: next });
    },
    [key, shares, hidden],
  );

  const resetSizes = useCallback(() => {
    writeLayout(key, { shares: DEFAULT_PANE_SHARES, hidden });
  }, [key, hidden]);

  const isMounted = useCallback((pane: Pane) => mounted.includes(pane), [mounted]);

  return {
    measureRow,
    wide,
    visible,
    mounted,
    isMounted,
    widths,
    active,
    setActive,
    toggle,
    resetSizes,
    resizing: dragWidths !== null,
    startResize,
    moveResize,
    endResize,
    nudge,
  };
}
