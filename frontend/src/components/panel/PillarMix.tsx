import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import TimeCoverage from "@/components/panel/TimeCoverage";
import { formatAmount, formatShare, pillarFill, type MixSource } from "@/lib/panel";

/**
 * Where the window went, by pillar — the stacked bar plus its legend.
 *
 * This is the table at the bottom of the spreadsheet's My Schedule tab, drawn
 * from the ledger instead of from hand-coloured cells. The bar and the table
 * are one figure, not two: the bar is scannable, the table is readable, and
 * every row carries its own absolute amount so a share can be checked.
 *
 * The table is not decoration. Two of the pillar fills inherited from the sheet
 * — CEO's grey and Product's teal — sit close enough that colour alone does not
 * separate them for every reader, so the swatch never carries identity by
 * itself: the name is always next to it, here and in the bar's tooltip.
 */
export default function PillarMix({
  panel,
  title,
}: {
  panel: MixSource;
  /** Overridden by the company rollup, where "your" would be wrong. */
  title?: string;
}) {
  const { pillars, unit } = panel;

  if (pillars.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-1">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {title ?? "Where it went"}
          </div>
          <p className="text-sm text-muted-foreground">
            Nothing completed in this window yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const barLabel = pillars
    .map((pillar) => `${pillar.name} ${formatShare(pillar.share)}`)
    .join(", ");

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title ?? `Where your ${unit === "minutes" ? "time" : "points"} went`}
        </div>

        {/* A hairline of the card's own ground between segments, so two
            similar fills never touch and read as one block. */}
        <div
          className="flex h-4 gap-[2px] overflow-hidden rounded-[3px] ring-1 ring-foreground/10"
          role="img"
          aria-label={barLabel}
        >
          {pillars.map((pillar) => (
            <span
              key={pillar.pillar_id}
              title={`${pillar.name} — ${formatShare(pillar.share)}`}
              style={{ width: `${pillar.share}%`, background: pillarFill(pillar.slug) }}
            />
          ))}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pillar</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">
                  {unit === "minutes" ? "Time" : "Points"}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pillars.map((pillar) => (
                <TableRow key={pillar.pillar_id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-[2px] ring-1 ring-foreground/20"
                        style={{ background: pillarFill(pillar.slug) }}
                      />
                      {pillar.name}
                      {/* Life is not a company pillar, so it is excluded from
                          company-share figures. Said out loud rather than left
                          for the reader to infer from the totals.

                          The Unassigned bucket also carries is_company=false but
                          means something entirely different — nobody tagged it,
                          not "this is off the clock" — so it is excluded here by
                          id rather than being described as deliberate non-work. */}
                      {!pillar.is_company && pillar.pillar_id >= 0 && (
                        <span className="text-xs text-muted-foreground">(not company work)</span>
                      )}
                      {pillar.pillar_id < 0 && (
                        <span className="text-xs text-muted-foreground">(no function tag)</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatShare(pillar.share)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(pillar, unit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <TimeCoverage panel={panel} />
      </CardContent>
    </Card>
  );
}
