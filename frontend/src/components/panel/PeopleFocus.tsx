import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatAmount, formatShare, pillarFill, type CompanyPanel } from "@/lib/panel";

/**
 * Who the company mix is actually made of.
 *
 * A single "42% Product" can mean the whole team pulling one way or one person
 * having a big week, and those call for opposite responses. Each person's bar
 * is therefore normalised to *their own* effort — the question per row is "what
 * is this person working on", and a company-relative bar would just redraw the
 * headcount — while their share of the company sits beside it as the weight to
 * read that bar with.
 *
 * People with nothing logged are kept rather than filtered out. A row reading
 * "0% of the company, 4 open" is one of the more useful things on the page, and
 * dropping it would make the window look fully staffed.
 */
export default function PeopleFocus({ panel }: { panel: CompanyPanel }) {
  const { people, people_mix, pillars, unit } = panel;

  if (people.length === 0) return null;

  const pillarById = new Map(pillars.map((p) => [p.pillar_id, p]));

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Who that was
          </div>
          <div className="text-xs text-muted-foreground">
            Each bar is that person&rsquo;s own mix, not their size
          </div>
        </div>

        <ul className="space-y-4">
          {people.map((person) => {
            const mix = people_mix
              .filter((cell) => cell.user_id === person.user_id)
              .sort((a, b) => b.share - a.share);
            const worked = person.points > 0 || person.minutes > 0;

            return (
              <li key={person.user_id} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/panel/${person.user_id}`}
                      className="text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {person.name}
                    </Link>
                    {person.seat_function_name ? (
                      <span className="text-xs text-muted-foreground">
                        seat: {person.seat_function_name}
                        {person.on_seat_share !== null && (
                          <>
                            {" · "}
                            <strong className="font-semibold text-foreground tabular-nums">
                              {formatShare(person.on_seat_share)}
                            </strong>{" "}
                            on it
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">no seat set</span>
                    )}
                  </span>

                  <span className="text-xs text-muted-foreground tabular-nums">
                    <strong className="font-semibold text-foreground">
                      {formatShare(person.share)}
                    </strong>{" "}
                    of the company
                    {" · "}
                    {formatAmount(person, unit)}
                    {person.open_tasks > 0 && ` · ${person.open_tasks} open`}
                  </span>
                </div>

                {worked ? (
                  <div
                    className="flex h-3 gap-[2px] overflow-hidden rounded-[3px] ring-1 ring-foreground/10"
                    role="img"
                    aria-label={mix
                      .map(
                        (cell) =>
                          `${pillarById.get(cell.pillar_id)?.name ?? "Unassigned"} ${formatShare(cell.share)}`,
                      )
                      .join(", ")}
                  >
                    {mix.map((cell) => {
                      const pillar = pillarById.get(cell.pillar_id);
                      return (
                        <span
                          key={cell.pillar_id}
                          title={`${pillar?.name ?? "Unassigned"} — ${formatShare(cell.share)} of ${person.name}'s effort`}
                          style={{
                            width: `${cell.share}%`,
                            background: pillarFill(pillar?.slug ?? "unassigned"),
                          }}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing completed in this window.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
