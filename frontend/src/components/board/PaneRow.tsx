"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { dividerPercent, type Pane } from "@/lib/panes";
import type { PaneLayoutController } from "@/components/board/usePaneLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PaneSpec = {
  id: Pane;
  label: string;
  glyph: ComponentType<{ className?: string }>;
  /** The pane's own chrome — border, padding. Its width is not its business. */
  className?: string;
  content: React.ReactNode;
};

const tabId = (pane: Pane) => `universe-tab-${pane}`;
const panelId = (pane: Pane) => `universe-pane-${pane}`;

/**
 * The panes, side by side with a draggable divider between each pair — or, when
 * the row cannot hold all of them at their minimum widths, whichever one the
 * switcher below has open.
 *
 * Widths arrive as pixels rather than percentages because the minimums are in
 * pixels: a percentage plus a `min-width` lets the browser resolve the conflict
 * by overflowing the row, and the answer to "these three no longer fit" has to
 * be tabs, not a horizontal scrollbar across the whole workspace.
 */
export function PaneRow({
  layout,
  panes,
}: {
  layout: PaneLayoutController;
  panes: PaneSpec[];
}) {
  const { measureRow } = layout;
  const [row, setRow] = useState<HTMLDivElement | null>(null);

  // Measured in the ref callback as well as in the effect below, so the first
  // width is known during the commit that mounted the row. Left to the effect
  // alone, the tab fallback paints for a frame and then snaps to three panes.
  const attachRow = useCallback(
    (node: HTMLDivElement | null) => {
      setRow(node);
      measureRow(node ? node.getBoundingClientRect().width : null);
    },
    [measureRow],
  );

  useEffect(() => {
    if (!row) return;
    const observer = new ResizeObserver((entries) => measureRow(entries[0].contentRect.width));
    observer.observe(row);
    return () => observer.disconnect();
  }, [row, measureRow]);

  const byId = new Map(panes.map((pane) => [pane.id, pane]));

  return (
    <div
      ref={attachRow}
      className={cn(
        // No padding or border: this element is what gets measured, and the
        // arithmetic upstream assumes its width is the width the panes divide.
        "flex min-h-0 w-full flex-1",
        layout.resizing && "cursor-col-resize select-none",
      )}
    >
      {layout.mounted.map((id, index) => {
        const pane = byId.get(id);
        if (!pane) return null;
        return (
          <Fragment key={id}>
            {layout.wide && index > 0 && (
              <PaneDivider layout={layout} panes={panes} divider={index - 1} />
            )}
            <section
              id={panelId(id)}
              // Tabs only exist in the narrow layout. Side by side these are
              // three regions on screen at once, and calling them tab panels
              // would promise a switcher that is not what the footer is doing.
              role={layout.wide ? "region" : "tabpanel"}
              aria-label={layout.wide ? pane.label : undefined}
              aria-labelledby={layout.wide ? undefined : tabId(id)}
              tabIndex={layout.wide ? undefined : 0}
              style={layout.wide ? { width: layout.widths[id] } : undefined}
              className={cn(
                "min-h-0 min-w-0 overflow-hidden",
                layout.wide ? "shrink-0 grow-0" : "w-full flex-1",
                pane.className,
              )}
            >
              {pane.content}
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * One draggable divider, and the ARIA window splitter it also has to be.
 *
 * The grab area is wider than the 10px the divider occupies, via a pseudo
 * element that spills a few pixels into each neighbour. A divider you have to
 * hit exactly is a divider people conclude is not draggable.
 */
function PaneDivider({
  layout,
  panes,
  divider,
}: {
  layout: PaneLayoutController;
  panes: PaneSpec[];
  divider: number;
}) {
  const left = layout.visible[divider];
  const right = layout.visible[divider + 1];
  if (!left || !right) return null;

  const labelOf = (pane: Pane) => panes.find((candidate) => candidate.id === pane)?.label ?? pane;
  const { now, min, max } = dividerPercent(layout.widths, layout.visible, divider);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${labelOf(left)} and ${labelOf(right)}`}
      aria-valuenow={now}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => layout.startResize(divider, event)}
      onPointerMove={layout.moveResize}
      onPointerUp={layout.endResize}
      onPointerCancel={layout.endResize}
      onKeyDown={(event) => layout.nudge(divider, event)}
      onDoubleClick={layout.resetSizes}
      className="group relative flex w-2.5 shrink-0 cursor-col-resize touch-none items-center justify-center rounded-sm outline-none after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className={cn(
          "h-10 w-[3px] rounded-full bg-border transition-colors duration-100 group-hover:bg-primary group-focus-visible:bg-primary",
          layout.resizing && "bg-primary",
        )}
      />
    </div>
  );
}

/**
 * The switcher along the bottom, which is two different controls wearing one
 * set of buttons.
 *
 * Side by side the panes are not alternatives — the usual state is all three at
 * once — so each button is an independent toggle and the last one open refuses
 * to close. Once the row is too narrow for that, exactly one pane can be on
 * screen and the same buttons become tabs, with the roving focus and arrow keys
 * that word implies.
 */
export function PaneSwitcher({
  layout,
  panes,
}: {
  layout: PaneLayoutController;
  panes: PaneSpec[];
}) {
  const onTabKeys = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = panes[(index + step + panes.length) % panes.length];
    layout.setActive(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  return (
    <footer
      aria-label="Panes"
      role={layout.wide ? "group" : "tablist"}
      className="flex flex-wrap items-center gap-1 border-t border-border pt-2"
    >
      {panes.map((pane, index) => {
        const on = layout.wide ? layout.visible.includes(pane.id) : layout.active === pane.id;
        const last = layout.wide && on && layout.visible.length === 1;
        return (
          <Button
            key={pane.id}
            id={tabId(pane.id)}
            size="sm"
            // Both states are `ghost` and the open one is painted below, so the
            // two are told apart by the theme's primary rather than by a shade
            // of grey — `secondary` sat a hair off the page ground and the open
            // panes read as unselected.
            variant="ghost"
            role={layout.wide ? undefined : "tab"}
            aria-pressed={layout.wide ? on : undefined}
            aria-selected={layout.wide ? undefined : on}
            aria-controls={layout.wide ? undefined : panelId(pane.id)}
            // One stop in the tab order for the whole tablist, as a tablist owes
            // its user; three independent toggles each keep their own.
            tabIndex={layout.wide || on ? undefined : -1}
            // `aria-disabled` rather than `disabled`, because the real state of
            // that button is "this pane is open" and the base style fades a
            // disabled button until it reads as the opposite — off. Screen
            // readers still hear it is unavailable; the click just does nothing.
            aria-disabled={last}
            title={last ? "At least one pane stays open" : undefined}
            onKeyDown={layout.wide ? undefined : (event) => onTabKeys(event, index)}
            onClick={() => {
              if (!layout.wide) layout.setActive(pane.id);
              else if (!last) layout.toggle(pane.id);
            }}
            className={cn(
              on
                ? "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15"
                : "text-muted-foreground",
            )}
          >
            <pane.glyph className={cn("h-4 w-4", on && "text-primary")} /> {pane.label}
          </Button>
        );
      })}
      {layout.wide && (
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
          Drag a divider to resize
        </span>
      )}
    </footer>
  );
}
