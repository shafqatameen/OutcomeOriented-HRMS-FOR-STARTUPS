import { Card, CardContent } from "@/components/ui/card";
import { formatShare, pillarFill, type Panel } from "@/lib/panel";

/**
 * The number a pre-PMF founder opens this page for.
 *
 * Core share alone is only half the story. The failure that actually kills
 * companies at this stage is all the Core effort landing on the Product side
 * and none on Customer — building hard, selling never — and that is invisible
 * until the two numbers sit next to each other. So the build/sell split gets
 * equal billing, and says which way it is leaning in plain words.
 */
export default function CoreHeadline({ panel }: { panel: Panel }) {
  const { headline, unit, totals } = panel;
  const hasEffort = unit === "minutes" ? totals.minutes > 0 : totals.points > 0;

  if (!hasEffort) {
    return (
      <Card>
        <CardContent className="space-y-1">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            This window
          </div>
          <p className="text-sm text-muted-foreground">
            Nothing completed yet in this range. Finish a task, or widen the window.
          </p>
        </CardContent>
      </Card>
    );
  }

  const build = headline.product_share_of_build_sell;
  const sell = headline.customer_share_of_build_sell;
  const leaning =
    !headline.has_build_sell
      ? null
      : build >= sell
        ? `You are building ${build >= 75 ? "much " : ""}harder than you are selling.`
        : `You are selling ${sell >= 75 ? "much " : ""}harder than you are building.`;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          The one number
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <span className="text-4xl leading-none font-bold tabular-nums">
            {formatShare(headline.core_share)}
          </span>
          <span className="pb-1 text-sm text-muted-foreground">
            of your {unit === "minutes" ? "logged time" : "points"} was Core
          </span>
        </div>

        {headline.has_build_sell ? (
          <div className="space-y-2">
            <div
              className="flex h-2 overflow-hidden rounded-full ring-1 ring-foreground/10"
              role="img"
              aria-label={`Product ${formatShare(build)}, Customer ${formatShare(sell)}`}
            >
              <span style={{ width: `${build}%`, background: pillarFill("product") }} />
              <span style={{ width: `${sell}%`, background: pillarFill("customer") }} />
            </div>
            <p className="text-sm text-muted-foreground">
              Of your Product and Customer effort,{" "}
              <strong className="font-semibold text-foreground">
                {formatShare(build)} went to Product
              </strong>{" "}
              and{" "}
              <strong className="font-semibold text-foreground">
                {formatShare(sell)} to Customer
              </strong>
              . {leaning}
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
  );
}
