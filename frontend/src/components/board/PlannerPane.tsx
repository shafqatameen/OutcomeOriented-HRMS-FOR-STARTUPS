"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CalendarCard } from "@/lib/api";
import { formatDayHeading, formatTime, istDay, istMinutes, parseIst } from "@/lib/board";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Pixels per hour. Tall enough that a half-hour block still fits its title. */
const HOUR_HEIGHT = 44;
/** A block this short is unreadable, so short events are drawn at this height. */
const MIN_BLOCK_HEIGHT = 22;
/** Below this, only the title fits — printing the time as well would clip both. */
const TIME_VISIBLE_HEIGHT = 34;
/** What a card with a due time but no start time occupies. */
const DEFAULT_DURATION_MINUTES = 30;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const hourLabel = (hour: number) => {
  if (hour === 0) return "12 am";
  if (hour === 12) return "12 pm";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
};

/** Where a card sits in one day column, in minutes from that day's midnight. */
type Segment = { card: CalendarCard; from: number; to: number; lane: number; lanes: number };

/**
 * Places one day's cards, splitting the column into lanes where they overlap.
 *
 * Without this two cards at the same hour are drawn on top of each other and the
 * one underneath is unreachable. Lanes are assigned greedily in start order — the
 * first lane whose last card has already ended — which is what a calendar grid
 * does and is stable as cards are added.
 */
function packDay(day: string, cards: CalendarCard[]): Segment[] {
  const spans = cards
    .map((card) => {
      const due = parseIst(card.due_at);
      const dueDay = istDay(due);
      const dueMinutes = istMinutes(due);
      // A card due after this column's midnight still belongs to the day it is
      // due on; the clamp only matters for one that *started* the day before.
      const to = dueDay === day ? dueMinutes : 24 * 60;

      let from = to - DEFAULT_DURATION_MINUTES;
      if (card.start_at) {
        const start = parseIst(card.start_at);
        from = istDay(start) === day ? istMinutes(start) : 0;
      }
      return { card, from: Math.max(0, Math.min(from, to)), to: Math.min(24 * 60, to) };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const laneEnds: number[] = [];
  const placed = spans.map((span) => {
    let lane = laneEnds.findIndex((end) => end <= span.from);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(span.to);
    } else {
      laneEnds[lane] = span.to;
    }
    return { ...span, lane, lanes: 1 };
  });

  // Every card in the column shares the same lane count, so the grid reads as
  // columns rather than as blocks of shifting width.
  return placed.map((segment) => ({ ...segment, lanes: Math.max(1, laneEnds.length) }));
}

type PlannerPaneProps = {
  /** IST `YYYY-MM-DD` days, left to right. */
  days: string[];
  cards: CalendarCard[] | null;
  onShift: (days: number) => void;
  onToday: () => void;
  onOpenCard: (cardId: number) => void;
  /** Omitted when the board is read-only or has no Calendar list to write into. */
  onCreateAt?: (day: string, hour: number) => void;
  error?: string | null;
};

/**
 * The day grid: dated cards on an hour axis, three days at a time.
 *
 * It reads every card with a due date rather than only the Calendar list, because
 * a card parked in Next Actions with a time on it is exactly as scheduled as one
 * filed under Calendar — a grid that hid it would be lying about the day.
 */
export default function PlannerPane({
  days,
  cards,
  onShift,
  onToday,
  onOpenCard,
  onCreateAt,
  error = null,
}: PlannerPaneProps) {
  const today = istDay(new Date());
  const nowOffset = (istMinutes(new Date()) / 60) * HOUR_HEIGHT;

  const byDay = new Map<string, Segment[]>(
    days.map((day) => [
      day,
      packDay(
        day,
        (cards ?? []).filter((card) => {
          const dueDay = istDay(parseIst(card.due_at));
          const startDay = card.start_at ? istDay(parseIst(card.start_at)) : dueDay;
          return dueDay === day || startDay === day;
        }),
      ),
    ]),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 pb-2">
        <Button size="icon-sm" variant="ghost" onClick={() => onShift(-days.length)} aria-label="Earlier">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onToday}>
          Today
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => onShift(days.length)} aria-label="Later">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {error && <span className="ml-2 truncate text-xs text-destructive">{error}</span>}
      </header>

      {/* Day names stay put while the hours scroll, or you lose track of which
          column you are reading the moment you scroll past 6am. */}
      <div className="flex border-b border-border pb-1 text-xs">
        <div className="w-12 shrink-0" />
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "min-w-0 flex-1 truncate px-1 text-center font-medium",
              day === today ? "text-primary" : "text-muted-foreground",
            )}
          >
            {formatDayHeading(day)}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex">
          <div className="w-12 shrink-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="pr-1 text-right text-[10px] text-muted-foreground"
              >
                {hourLabel(hour)}
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div key={day} className="relative min-w-0 flex-1 border-l border-border">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  style={{ height: HOUR_HEIGHT }}
                  className="group relative border-t border-border/60"
                >
                  {onCreateAt && (
                    <button
                      type="button"
                      onClick={() => onCreateAt(day, hour)}
                      aria-label={`Add a card on ${formatDayHeading(day)} at ${hourLabel(hour)}`}
                      className="absolute inset-0 flex cursor-pointer items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                    >
                      <Plus className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}

              {day === today && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 border-t border-primary"
                  style={{ top: nowOffset }}
                  aria-hidden
                />
              )}

              {(byDay.get(day) ?? []).map(({ card, from, to, lane, lanes }) => {
                const top = (from / 60) * HOUR_HEIGHT;
                const height = Math.max(MIN_BLOCK_HEIGHT, ((to - from) / 60) * HOUR_HEIGHT);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onOpenCard(card.id)}
                    title={`${card.title} — ${card.list_name}`}
                    style={{
                      top,
                      height,
                      left: `${(lane / lanes) * 100}%`,
                      width: `${100 / lanes}%`,
                      borderLeftColor: card.labels[0]?.color,
                    }}
                    className={cn(
                      "absolute z-10 overflow-hidden rounded-sm border border-border border-l-2 px-1 py-0.5 text-left text-[11px] leading-tight",
                      card.completed_at
                        ? "bg-success/10 text-muted-foreground line-through"
                        : "bg-card hover:border-ring",
                    )}
                  >
                    <span className="block truncate font-medium">{card.title}</span>
                    {height >= TIME_VISIBLE_HEIGHT && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {formatTime(card.due_at)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {cards !== null && cards.length === 0 && (
        <p className="border-t border-border pt-2 text-xs text-muted-foreground">
          Nothing scheduled in these days. Give a card a due date and it appears here.
        </p>
      )}
    </div>
  );
}
