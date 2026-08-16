import { Card, CardContent } from "@/components/ui/card";
import { formatShare, pillarFill, type MixSource } from "@/lib/panel";

/**
 * The cross-tab: Track (is this moving me forward?) against Pillar (what kind
 * of work is this?).
 *
 * Neither axis alone says much a founder does not already know. Together they
 * locate the effort precisely — Core work sitting entirely in Product, or a
 * Drain row that turns out to be a fifth of the week. The single largest cell
 * is marked, because on a grid of numbers the eye needs somewhere to start.
 *
 * Takes a `MixSource` rather than a `Panel` so the company rollup renders the
 * same cross-tab from the same code — the figure means the same thing for one
 * person and for everyone.
 */
export default function TrackPillarMatrix({ panel }: { panel: MixSource }) {
  const { tracks, pillars, matrix, unit } = panel;

  if (matrix.length === 0) return null;

  const cells = new Map(
    matrix.map((cell) => [`${cell.track_id}:${cell.pillar_id}`, cell]),
  );
  const largest = matrix.reduce((a, b) => (b.share > a.share ? b : a));
  const largestKey = `${largest.track_id}:${largest.pillar_id}`;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Track × Pillar — share of {unit === "minutes" ? "logged time" : "points"}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr>
                <th className="border border-border bg-muted p-2 text-left text-xs font-semibold tracking-wide uppercase">
                  Track
                </th>
                {pillars.map((pillar) => (
                  <th
                    key={pillar.pillar_id}
                    scope="col"
                    className="border border-border bg-muted p-2 text-right text-xs font-semibold whitespace-nowrap"
                  >
                    <span className="flex items-center justify-end gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 shrink-0 rounded-[2px] ring-1 ring-foreground/20"
                        style={{ background: pillarFill(pillar.slug) }}
                      />
                      {pillar.name.replace(/ Pillar$/, "")}
                    </span>
                  </th>
                ))}
                <th className="border border-border bg-muted p-2 text-right text-xs font-semibold tracking-wide uppercase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track) => (
                <tr key={track.track_id}>
                  <th
                    scope="row"
                    className="border border-border bg-muted/60 p-2 text-left font-semibold whitespace-nowrap"
                  >
                    {track.name}
                    {/* Drain is priced at 0, so its points column always reads
                        zero however many hours went into it. Worth naming. */}
                    {track.default_points === 0 && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        0 pts
                      </span>
                    )}
                  </th>

                  {pillars.map((pillar) => {
                    const key = `${track.track_id}:${pillar.pillar_id}`;
                    const cell = cells.get(key);
                    return (
                      <td
                        key={pillar.pillar_id}
                        className={
                          "border border-border p-2 text-right " +
                          (cell
                            ? key === largestKey
                              ? "bg-primary/15 font-semibold"
                              : "font-medium"
                            : "text-muted-foreground/50")
                        }
                      >
                        {cell ? formatShare(cell.share) : "—"}
                      </td>
                    );
                  })}

                  <td className="border border-border p-2 text-right font-semibold">
                    {formatShare(track.share)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="border border-border p-2 text-left font-semibold">Total</td>
                {pillars.map((pillar) => (
                  <td
                    key={pillar.pillar_id}
                    className="border border-border p-2 text-right font-semibold"
                  >
                    {formatShare(pillar.share)}
                  </td>
                ))}
                <td className="border border-border p-2 text-right font-semibold">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="text-sm text-muted-foreground">
          Biggest single block:{" "}
          <strong className="font-semibold text-foreground">
            {tracks.find((t) => t.track_id === largest.track_id)?.name} in{" "}
            {pillars.find((p) => p.pillar_id === largest.pillar_id)?.name}
          </strong>{" "}
          at {formatShare(largest.share)}.
        </p>
      </CardContent>
    </Card>
  );
}
