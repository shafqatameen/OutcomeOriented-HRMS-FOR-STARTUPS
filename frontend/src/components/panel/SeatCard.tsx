import { Card, CardContent } from "@/components/ui/card";
import { formatShare, pillarFill, pillarInk, type Panel } from "@/lib/panel";

/**
 * The fixed place: the function this person is meant to be working in.
 *
 * Rendered with the drift number beside it, because the seat on its own is
 * inert — it only becomes information once you can see how far the week
 * actually landed from it. No seat is a normal state, not an error, so the
 * empty case says who can set one rather than showing a warning.
 */
export default function SeatCard({ panel }: { panel: Panel }) {
  const { seat, headline, unit } = panel;

  if (!seat) {
    return (
      <Card>
        <CardContent className="space-y-1">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Your fixed place
          </div>
          <div className="font-semibold">No seat assigned</div>
          <p className="text-sm text-muted-foreground">
            A seat is the function you are meant to be working in. It restricts
            nothing — it just lets this page show how far your week drifted from
            it. An administrator can set one from Admin → People.
          </p>
        </CardContent>
      </Card>
    );
  }

  const onSeat = headline.on_seat_share;

  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Your fixed place
        </div>

        <div
          className="space-y-1 border-l-[3px] pl-3"
          style={{ borderColor: pillarInk(seat.pillar_slug) }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-[2px] ring-1 ring-foreground/20"
              style={{ background: pillarFill(seat.pillar_slug) }}
            />
            <span
              className="text-sm font-semibold"
              style={{ color: pillarInk(seat.pillar_slug) }}
            >
              {seat.pillar_name ?? "Unassigned"}
            </span>
            <span aria-hidden className="text-muted-foreground">
              ›
            </span>
            <span className="font-semibold">{seat.function_name}</span>
          </div>

          {seat.purpose && (
            <p className="text-sm text-muted-foreground">{seat.purpose}</p>
          )}
        </div>

        {onSeat !== null && (
          <p className="text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground">
              {formatShare(onSeat)} of your {unit === "minutes" ? "time" : "points"}
            </strong>{" "}
            {onSeat >= 50 ? "landed in" : "came from"} {seat.function_name}
            {onSeat < 50 && ` — the other ${formatShare(100 - onSeat)} went elsewhere`}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
