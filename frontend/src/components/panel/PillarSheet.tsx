import { Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import TimeCoverage from "@/components/panel/TimeCoverage";
import { cn } from "@/lib/utils";
import {
  formatAmount,
  formatShare,
  pillarFill,
  pillarInk,
  type Measured,
  type OrgPillar,
  type SheetSource,
} from "@/lib/panel";

/** Stands in for a function nothing landed on. The sheet shows it as 0.0%, not blank. */
const NOTHING: Measured = { points: 0, minutes: 0, share: 0 };

/** Matches service.UNASSIGNED_ID — the bucket for work carrying no function tag. */
const UNASSIGNED_ID = -1;

type SheetFunction = {
  id: number;
  name: string;
  purpose: string | null;
  measured: Measured;
};

type SheetGroup = {
  id: number;
  name: string;
  slug: string;
  isCompany: boolean;
  total: Measured;
  rows: SheetFunction[];
};

type PillarSheetProps = {
  panel: SheetSource;
  /** The whole taxonomy, ordered. Drives the rows, so a function with nothing
   *  against it still appears — at 0.0%, exactly as it does on the spreadsheet. */
  tree: OrgPillar[];
  /** Restricts the sheet to one pillar. The rail's per-pillar sub-pages pass it. */
  pillarId?: number;
  /** Says whose effort and which window these percentages are of. */
  caption?: string;
};

/**
 * The source spreadsheet, drawn from the ledger: Pillar → Essential Function →
 * Purpose, with each function's share of the window and each pillar's total.
 *
 * Rows come from the taxonomy rather than from the panel, which is the whole
 * point of this view. The panel only reports buckets that carry effort, so a
 * table built from it would quietly omit every function nobody worked on —
 * and on a sheet whose job is to show where attention *is not* going, a missing
 * row and a 0.0% row are opposite claims.
 *
 * The pillar band is a tint of the sheet's own cell colour rather than the flat
 * fill: at full strength, Customer's pale yellow and CEO's mid grey each need a
 * different text colour to stay readable, and one of them would lose in dark
 * mode whichever way that went. The true fill is still present, as the swatch.
 */
export default function PillarSheet({ panel, tree, pillarId, caption }: PillarSheetProps) {
  const { unit, totals } = panel;

  const measuredFunction = new Map(panel.functions.map((row) => [row.function_id, row]));
  const measuredPillar = new Map(panel.pillars.map((row) => [row.pillar_id, row]));

  const groups: SheetGroup[] = tree
    .filter((pillar) => pillarId === undefined || pillar.id === pillarId)
    .map((pillar) => ({
      id: pillar.id,
      name: pillar.name,
      slug: pillar.slug,
      isCompany: pillar.is_company,
      total: measuredPillar.get(pillar.id) ?? NOTHING,
      rows: pillar.functions.map((fn) => ({
        id: fn.id,
        name: fn.name,
        purpose: fn.purpose,
        measured: measuredFunction.get(fn.id) ?? NOTHING,
      })),
    }));

  // Untagged work belongs to no pillar and so is in no branch of the tree. It is
  // appended rather than dropped: without it the percentages stop adding up to
  // the leaderboard, and the sheet would describe the tagging as if it were the
  // focus. Left out of a single-pillar view, where it is not that pillar's row.
  const untaggedPillar = measuredPillar.get(UNASSIGNED_ID);
  if (pillarId === undefined && untaggedPillar) {
    const untaggedFunction = measuredFunction.get(UNASSIGNED_ID);
    groups.push({
      id: UNASSIGNED_ID,
      name: untaggedPillar.name,
      slug: untaggedPillar.slug,
      isCompany: false,
      total: untaggedPillar,
      rows: [
        {
          id: UNASSIGNED_ID,
          name: untaggedFunction?.name ?? "Untagged",
          purpose:
            untaggedFunction?.purpose ??
            "Work that has not been tagged with a function yet.",
          measured: untaggedFunction ?? untaggedPillar,
        },
      ],
    });
  }

  const cell = "border border-border p-2 align-top";
  const heading =
    "border border-border bg-muted p-2 text-left text-xs font-semibold tracking-wide uppercase";

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Pillars &amp; essential functions
          </div>
          {caption && <div className="text-xs text-muted-foreground">{caption}</div>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={heading}>Pillars</th>
                <th className={heading}>Essential Functions</th>
                <th className={heading}>Purpose / Sub-Function</th>
                <th className={cn(heading, "text-right")}>
                  {unit === "minutes" ? "Time" : "Points"}
                </th>
                <th className={cn(heading, "text-right")}>Share</th>
                <th className={cn(heading, "text-right")}>Pillar total</th>
              </tr>
            </thead>

            <tbody>
              {groups.map((group) => {
                const band = {
                  background: `color-mix(in srgb, ${pillarFill(group.slug)} 22%, transparent)`,
                  borderLeftColor: pillarInk(group.slug),
                };
                const bandCell = cn(cell, "border-l-[3px] font-semibold whitespace-nowrap");
                const totalCell = cn(cell, "text-right font-semibold tabular-nums");

                const label = (
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-[2px] ring-1 ring-foreground/20"
                        style={{ background: pillarFill(group.slug) }}
                      />
                      {group.name}
                    </span>
                    {/* Life is off the clock by design; Unassigned is nobody's
                        pillar at all. Both sit outside the company reading, for
                        opposite reasons, so neither is left to be inferred. */}
                    {!group.isCompany && group.id >= 0 && (
                      <span className="text-xs font-normal text-muted-foreground">
                        not company work
                      </span>
                    )}
                    {group.id < 0 && (
                      <span className="text-xs font-normal text-muted-foreground">
                        no function tag
                      </span>
                    )}
                  </span>
                );

                if (group.rows.length === 0) {
                  return (
                    <tr key={group.id}>
                      <th scope="row" className={bandCell} style={band}>
                        {label}
                      </th>
                      <td className={cn(cell, "text-muted-foreground")} colSpan={4}>
                        No essential functions defined for this pillar yet — add them
                        in Admin → Pillars &amp; Functions.
                      </td>
                      <td className={totalCell} style={band}>
                        {formatShare(group.total.share)}
                      </td>
                    </tr>
                  );
                }

                return (
                  <Fragment key={group.id}>
                    {group.rows.map((row, index) => (
                      <tr key={row.id}>
                        {index === 0 && (
                          <th
                            scope="rowgroup"
                            rowSpan={group.rows.length}
                            className={bandCell}
                            style={band}
                          >
                            {label}
                          </th>
                        )}

                        <td className={cn(cell, "font-medium whitespace-nowrap")}>
                          {row.name}
                        </td>
                        <td className={cn(cell, "min-w-[18rem] text-muted-foreground")}>
                          {row.purpose ?? "—"}
                        </td>
                        <td className={cn(cell, "text-right tabular-nums")}>
                          {formatAmount(row.measured, unit)}
                        </td>
                        <td
                          className={cn(
                            cell,
                            "text-right tabular-nums",
                            row.measured.share > 0
                              ? "font-semibold"
                              : "text-muted-foreground/60",
                          )}
                        >
                          {formatShare(row.measured.share)}
                        </td>

                        {index === 0 && (
                          <td rowSpan={group.rows.length} className={totalCell} style={band}>
                            {formatShare(group.total.share)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>

            {/* Only on the full sheet. On one pillar the same figure is already
                in the band beside it, and a row labelled "Total" under a single
                pillar would read as that pillar being the whole window. */}
            {pillarId === undefined && (
              <tfoot>
                <tr>
                  <td className={cn(cell, "font-semibold")} colSpan={3}>
                    Total
                  </td>
                  <td className={cn(cell, "text-right font-semibold tabular-nums")}>
                    {formatAmount(
                      { points: totals.points, minutes: totals.minutes, share: 0 },
                      unit,
                    )}
                  </td>
                  <td className={cn(cell, "text-right font-semibold tabular-nums")} colSpan={2}>
                    {formatShare(
                      groups.reduce((sum, group) => sum + group.total.share, 0),
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {totals.entries === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing was completed in this window, so every share reads 0%. The rows
            are the taxonomy itself, not the work.
          </p>
        ) : (
          <TimeCoverage panel={panel} />
        )}
      </CardContent>
    </Card>
  );
}
