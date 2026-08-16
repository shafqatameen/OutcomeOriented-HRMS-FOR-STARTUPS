import { Card, CardContent } from "@/components/ui/card";
import {
  formatAmount,
  formatShare,
  pillarFill,
  pillarInk,
  type CompanyFunctionRow,
  type CompanyPanel,
} from "@/lib/panel";

/**
 * The company's focus at sub-pillar resolution: every function that carried
 * work, grouped under its pillar and ranked within it.
 *
 * This is the figure the pillar bar cannot be. "58% Business" is not something
 * anyone can act on next Monday; "most of that was Finance, and nobody touched
 * Marketing" is. So the pillar level is kept as a header — the context — and
 * the functions inside it are the marks.
 *
 * Two encoding decisions worth keeping:
 *
 * 1. **One scale across the whole figure.** Every bar is a linear share of the
 *    same company total, scaled so the largest fills its track. Normalising
 *    each pillar to its own width would draw a 2% function in a quiet pillar
 *    the same length as a 40% one, which is the exact comparison this page
 *    exists to make.
 *
 * 2. **Colour never carries identity alone.** Functions inherit their pillar's
 *    fill rather than getting hues of their own, because the pillar palette
 *    inherited from the source spreadsheet does not separate cleanly for every
 *    reader — CEO's grey and Product's teal are close enough to be confusable —
 *    and stepping hues *within* a pillar would make that worse. Every bar
 *    therefore carries its name and its number as text; the swatch is a hint,
 *    not the message.
 */
export default function FunctionFocus({ panel }: { panel: CompanyPanel }) {
  const { functions, pillars, unit } = panel;

  const worked = functions.filter((row) => row.points > 0 || row.minutes > 0);

  if (worked.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-1">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Focus by function
          </div>
          <p className="text-sm text-muted-foreground">
            No completed work in this window, so there is no focus to show yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Grouped from the function rows themselves rather than from `pillars`: a
  // pillar whose functions have only open tasks never reaches the pillar mix,
  // and dropping its functions here would hide queued work entirely.
  const groups = new Map<number, { name: string; slug: string; rows: CompanyFunctionRow[] }>();
  for (const row of worked) {
    const group = groups.get(row.pillar_id) ?? {
      name: row.pillar_name,
      slug: row.pillar_slug,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.pillar_id, group);
  }

  const shareOfPillar = new Map(pillars.map((p) => [p.pillar_id, p.share]));
  const ordered = [...groups.entries()].sort(
    (a, b) => sum(b[1].rows, unit) - sum(a[1].rows, unit),
  );

  // The scale's reference point. Bars stay linear in share; this only decides
  // what "full width" means, so the smallest function is still visible.
  const largest = Math.max(...worked.map((row) => row.share));

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Focus by function
          </div>
          <div className="text-xs text-muted-foreground">
            Share of the company&rsquo;s {unit === "minutes" ? "logged time" : "points"};
            bars scaled to the largest
          </div>
        </div>

        <div className="space-y-5">
          {ordered.map(([pillarId, group]) => (
            <div key={pillarId} className="space-y-2">
              <div
                className="flex flex-wrap items-baseline gap-2 border-l-[3px] pl-2"
                style={{ borderColor: pillarInk(group.slug) }}
              >
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 self-center rounded-[2px] ring-1 ring-foreground/20"
                  style={{ background: pillarFill(group.slug) }}
                />
                <span className="text-sm font-semibold">
                  {group.name.replace(/ Pillar$/, "")}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatShare(shareOfPillar.get(pillarId) ?? 0)} of the company
                  {" · "}
                  {group.rows.length} {group.rows.length === 1 ? "function" : "functions"}
                </span>
              </div>

              <ul className="space-y-2 pl-2">
                {group.rows.map((row) => (
                  <li key={row.function_id} className="space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="text-sm font-medium">{row.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        <strong className="font-semibold text-foreground">
                          {formatShare(row.share)}
                        </strong>
                        {" · "}
                        {formatAmount(row, unit)}
                        {" · "}
                        {row.contributors}{" "}
                        {row.contributors === 1 ? "person" : "people"}
                        {row.open_tasks > 0 && ` · ${row.open_tasks} open`}
                      </span>
                    </div>

                    <div
                      className="h-2.5 w-full overflow-hidden rounded-[3px] bg-muted"
                      role="img"
                      aria-label={`${row.name}: ${formatShare(row.share)} of the company`}
                      title={`${row.pillar_name} › ${row.name} — ${formatShare(row.share)} (${formatAmount(row, unit)})`}
                    >
                      <span
                        className="block h-full rounded-[3px]"
                        style={{
                          width: `${largest ? (row.share / largest) * 100 : 0}%`,
                          background: pillarFill(row.pillar_slug),
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const sum = (rows: CompanyFunctionRow[], unit: CompanyPanel["unit"]) =>
  rows.reduce((total, row) => total + row[unit], 0);
