"use client";

import { useCallback, useEffect, useState } from "react";
import ContextHeader from "@/components/ContextHeader";
import CoreHeadline from "@/components/panel/CoreHeadline";
import FunctionBreakdown from "@/components/panel/FunctionBreakdown";
import OpenWork from "@/components/panel/OpenWork";
import PillarMix from "@/components/panel/PillarMix";
import SeatCard from "@/components/panel/SeatCard";
import TrackPillarMatrix from "@/components/panel/TrackPillarMatrix";
import { getMyPanel, getPanel } from "@/lib/api";
import { RANGE_PRESETS, rangeLabel, resolveRange, type RangePreset } from "@/lib/date-range";
import type { Panel } from "@/lib/panel";
import { Select, selectClassName } from "@/components/ui/select";

export default function PanelClient({
  canComplete,
  userId,
}: {
  /** Decided by the page, which is the thing that knows whose panel this is. */
  canComplete: boolean;
  /** Omitted for your own panel; set when viewing someone else's. */
  userId?: number;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Defaults to this week: a pre-PMF founder's unit of self-correction is the
  // week, not the day and not all time.
  const [preset, setPreset] = useState<RangePreset>("week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const load = useCallback(() => {
    const range = resolveRange(preset, customStart, customEnd);
    if (!range) return; // custom range still incomplete
    const request =
      userId === undefined
        ? getMyPanel(range.startDate, range.endDate)
        : getPanel(userId, range.startDate, range.endDate);
    request
      .then((data) => {
        setPanel(data);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load the panel."),
      );
  }, [preset, customStart, customEnd, userId]);

  useEffect(load, [load]);

  return (
    <div className="space-y-6 pb-12">
      <ContextHeader
        title={panel ? `${panel.user.name}'s Panel` : "My Panel"}
        meta={rangeLabel(preset)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {preset === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="Range start"
                  className={selectClassName}
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <input
                  type="date"
                  aria-label="Range end"
                  className={selectClassName}
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </div>
            )}
            <Select
              aria-label="Panel time range"
              value={preset}
              onChange={(event) => setPreset(event.target.value as RangePreset)}
            >
              {RANGE_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {panel && (
        <>
          <CoreHeadline panel={panel} />
          <SeatCard panel={panel} />
          <PillarMix panel={panel} />
          <TrackPillarMatrix panel={panel} />
          <FunctionBreakdown panel={panel} />
          <OpenWork tasks={panel.open_work} canComplete={canComplete} onCompleted={load} />
        </>
      )}
    </div>
  );
}
