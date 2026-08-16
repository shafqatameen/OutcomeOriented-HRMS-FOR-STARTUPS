import type { Panel } from "@/lib/panel";

/** Only the two fields this note reads, so every panel-shaped payload fits. */
type CoverageSource = Pick<Panel, "unit" | "totals">;

/**
 * Why this panel is still counting in points, and what closes the gap.
 *
 * Shares only switch to time once every entry in the window is timed, because a
 * partly-timed window scores untimed work as zero effort — the mix would read
 * as confidently wrong instead of visibly incomplete. This line makes that
 * choice legible rather than mysterious, and names the exact number of entries
 * standing between here and a real time audit.
 */
export default function TimeCoverage({ panel }: { panel: CoverageSource }) {
  const { totals, unit } = panel;
  const missing = totals.entries - totals.entries_with_minutes;

  if (totals.entries === 0) return null;

  if (unit === "minutes") {
    return (
      <p className="text-xs text-muted-foreground">
        Every entry in this window is timed, so shares are measured in time.
      </p>
    );
  }

  if (totals.entries_with_minutes === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Shares are measured in points. Log minutes when you complete a task to
        measure them in time instead — until then, a zero-point track like Drain
        cannot show up here however many hours go into it.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Shares are measured in points: {totals.entries_with_minutes} of{" "}
      {totals.entries} entries in this window are timed.{" "}
      <strong className="font-semibold text-foreground">
        {missing} more {missing === 1 ? "needs" : "need"} minutes
      </strong>{" "}
      before this panel can measure in time — a partly-timed window would count
      the untimed work as zero.
    </p>
  );
}
