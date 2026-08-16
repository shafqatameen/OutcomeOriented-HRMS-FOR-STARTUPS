"use client";

import { useCallback, useEffect, useState } from "react";
import ContextHeader from "@/components/ContextHeader";
import CompanyHeadline from "@/components/panel/CompanyHeadline";
import FunctionFocus from "@/components/panel/FunctionFocus";
import PeopleFocus from "@/components/panel/PeopleFocus";
import PillarMix from "@/components/panel/PillarMix";
import TrackPillarMatrix from "@/components/panel/TrackPillarMatrix";
import { getCompanyPanel } from "@/lib/api";
import { RANGE_PRESETS, rangeLabel, resolveRange, type RangePreset } from "@/lib/date-range";
import type { CompanyPanel } from "@/lib/panel";
import { Select, selectClassName } from "@/components/ui/select";

/**
 * The company rollup, read top-down: the claim, then what it is made of.
 *
 * Order is the argument. The headline says where the company was pointed and
 * immediately says how much of the window is actually attributed, because that
 * qualifies everything below it. Then pillar (coarse), then function (the level
 * you can act on), then track × pillar (was the effort the kind that moves the
 * company), then people (whose effort this was).
 */
export default function CompanyClient() {
  const [panel, setPanel] = useState<CompanyPanel | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Month rather than the personal panel's week: a company direction read one
  // week at a time is mostly noise about who happened to close tasks.
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const load = useCallback(() => {
    const range = resolveRange(preset, customStart, customEnd);
    if (!range) return; // custom range still incomplete
    getCompanyPanel(range.startDate, range.endDate)
      .then((data) => {
        setPanel(data);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load the company panel."),
      );
  }, [preset, customStart, customEnd]);

  useEffect(load, [load]);

  return (
    <div className="space-y-6 pb-12">
      <ContextHeader
        title="Company Focus"
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
              aria-label="Company time range"
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
          <CompanyHeadline panel={panel} />
          <PillarMix
            panel={panel}
            title={`Where the company's ${panel.unit === "minutes" ? "time" : "points"} went`}
          />
          <FunctionFocus panel={panel} />
          <TrackPillarMatrix panel={panel} />
          <PeopleFocus panel={panel} />
        </>
      )}
    </div>
  );
}
