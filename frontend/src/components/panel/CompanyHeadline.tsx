import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatShare, pillarFill, type CompanyPanel } from "@/lib/panel";

/**
 * What the company was pointed at this window, and whether that claim is worth
 * believing.
 *
 * The second half matters as much as the first. Every figure on this page is
 * computed from the function tag on a task, and that tag is optional — so a
 * page drawn from mostly-untagged work is describing the tagging, not the
 * focus. Rather than let the reader discover that from a large grey "Unassigned"
 * band further down, the attribution rate is stated up front, next to the
 * numbers it qualifies, with the one action that fixes it.
 */
export default function CompanyHeadline({ panel }: { panel: CompanyPanel }) {
  const { headline, totals, unit } = panel;
  const hasEffort = unit === "minutes" ? totals.minutes > 0 : totals.points > 0;

  if (!hasEffort) {
    return (
      <Card>
        <CardContent className="space-y-1">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            This window
          </div>
          <p className="text-sm text-muted-foreground">
            Nobody completed anything in this range. Widen the window, or check
            that work is being marked done.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tagged = 100 - headline.untagged_share;
  // Below half, the mix is a minority report and the ranking under it can flip
  // on a single retag - so the warning is framed as "cannot be read yet",
  // not as a tidiness nag.
  const unreliable = headline.untagged_share >= 50;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Where the company is pointed
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              value={formatShare(headline.core_share)}
              label={`of the company's ${unit === "minutes" ? "logged time" : "points"} was Core`}
            />
            <Stat
              value={
                headline.top_pillar_share === null
                  ? "—"
                  : formatShare(headline.top_pillar_share)
              }
              label={
                headline.top_pillar_name
                  ? `in ${headline.top_pillar_name.replace(/ Pillar$/, "")}, the biggest pillar`
                  : "no pillar carries tagged work yet"
              }
              slug={headline.top_pillar_slug}
            />
            <Stat
              value={
                headline.top_function_share === null
                  ? "—"
                  : formatShare(headline.top_function_share)
              }
              label={
                headline.top_function_name
                  ? `in ${headline.top_function_name}, the biggest function`
                  : "no function carries tagged work yet"
              }
              slug={headline.top_function_pillar_slug}
            />
            <Stat
              value={
                headline.on_seat_share === null ? "—" : formatShare(headline.on_seat_share)
              }
              label={
                totals.seated_people === 0
                  ? "nobody has a seat set yet"
                  // Counted against everyone on the page, not against
                  // `totals.people` — that counts only accounts that logged
                  // something, which would put a seated idle person outside
                  // its own denominator.
                  : `landed in people's own seats (${totals.seated_people} of ${panel.people.length} have one set)`
              }
            />
          </div>

          {headline.has_build_sell ? (
            <div className="space-y-2">
              <div
                className="flex h-2 gap-[2px] overflow-hidden rounded-full ring-1 ring-foreground/10"
                role="img"
                aria-label={`Product ${formatShare(headline.product_share_of_build_sell)}, Customer ${formatShare(headline.customer_share_of_build_sell)}`}
              >
                <span
                  style={{
                    width: `${headline.product_share_of_build_sell}%`,
                    background: pillarFill("product"),
                  }}
                />
                <span
                  style={{
                    width: `${headline.customer_share_of_build_sell}%`,
                    background: pillarFill("customer"),
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Of the Product and Customer effort,{" "}
                <strong className="font-semibold text-foreground">
                  {formatShare(headline.product_share_of_build_sell)} went to Product
                </strong>{" "}
                and{" "}
                <strong className="font-semibold text-foreground">
                  {formatShare(headline.customer_share_of_build_sell)} to Customer
                </strong>
                .{" "}
                {headline.product_share_of_build_sell >= headline.customer_share_of_build_sell
                  ? "The company is building harder than it is selling."
                  : "The company is selling harder than it is building."}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Product or Customer work is tagged in this window, so there is no
              build-versus-sell split to show yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className={unreliable ? "border-destructive/40" : undefined}>
        <CardContent className="space-y-2">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            How much of this is attributed
          </div>

          <div
            className="flex h-2 gap-[2px] overflow-hidden rounded-full ring-1 ring-foreground/10"
            role="img"
            aria-label={`${formatShare(tagged)} of the window is tagged with a function`}
          >
            <span style={{ width: `${tagged}%`, background: "var(--primary)" }} />
            <span
              style={{
                width: `${headline.untagged_share}%`,
                background: pillarFill("unassigned"),
              }}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground">
              {formatShare(tagged)} of this window carries a function tag.
            </strong>{" "}
            {unreliable ? (
              <>
                The rest is untagged, so the mix above describes the tagged
                minority — the ranking can change on a single retag. Tag the
                completed work on the{" "}
                <Link href="/tasks" className="underline underline-offset-2">
                  Tasks board
                </Link>{" "}
                to make this page mean something; a task can be retagged after it
                is finished, and the points move with it.
              </>
            ) : (
              <>
                The untagged remainder shows up as its own band rather than being
                quietly redistributed, so every figure here adds up to the
                leaderboard total.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** One headline number. The pillar swatch is a hint; the label carries the meaning. */
function Stat({
  value,
  label,
  slug,
}: {
  value: string;
  label: string;
  slug?: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {slug && (
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-[2px] ring-1 ring-foreground/20"
            style={{ background: pillarFill(slug) }}
          />
        )}
        <span className="text-3xl leading-none font-bold tabular-nums">{value}</span>
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
