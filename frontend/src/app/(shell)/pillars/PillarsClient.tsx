"use client";

import { useEffect, useState } from "react";
import ContextHeader from "@/components/ContextHeader";
import PillarSheet from "@/components/panel/PillarSheet";
import { Select, selectClassName } from "@/components/ui/select";
import { getCompanyPanel, getOrgTree, getPanel, getUsers } from "@/lib/api";
import { RANGE_PRESETS, rangeLabel, resolveRange, type RangePreset } from "@/lib/date-range";
import type { OrgPillar, SheetSource } from "@/lib/panel";

/** "Everyone" is the company rollup; a number is one account's own panel. */
type Scope = "everyone" | number;

type Filters = {
  scope: Scope;
  preset: RangePreset;
  customStart: string;
  customEnd: string;
};

/**
 * The filter bar's last setting.
 *
 * Module scope rather than component state so that clicking a pillar in the rail
 * keeps the person and the window you were already reading — the sub-page mounts
 * a fresh copy of this component, which would otherwise snap back to Everyone /
 * This Month halfway through a comparison.
 *
 * Deliberately not persisted to storage. It resets on reload, so a filter set
 * yesterday can never quietly define what you see today, and the first client
 * render after a fresh load always matches what the server rendered.
 */
let remembered: Filters | null = null;

type Person = { id: number; name: string };

type PillarsClientProps = {
  /** The signed-in account, and the only scope available without `panel.view.all`. */
  self: Person;
  /** Whether other people — and the company total — may be selected. */
  canViewAll: boolean;
  /** Set by the per-pillar sub-page. Undefined is the whole sheet. */
  pillarId?: number;
  /** Resolved server-side, so the heading is right on first paint. */
  pillarName?: string;
};

/**
 * The pillar sheet with its two filters: whose effort, and over what window.
 *
 * Both scopes are served by panels that already exist rather than by a new
 * endpoint — the company rollup for Everyone, one account's panel for a person.
 * They report the same shape against different denominators, which is what makes
 * "58% Product" here mean the same thing it means on that person's own panel.
 */
export default function PillarsClient({
  self,
  canViewAll,
  pillarId,
  pillarName,
}: PillarsClientProps) {
  const [filters, setFilters] = useState<Filters>(
    () =>
      remembered ?? {
        // A single person is the only honest default without the wider grant:
        // the API would refuse the company call anyway.
        scope: canViewAll ? "everyone" : self.id,
        // Month, not week: a pillar mix read one week at a time is mostly noise
        // about who happened to close tasks.
        preset: "month",
        customStart: "",
        customEnd: "",
      },
  );

  const [tree, setTree] = useState<OrgPillar[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [panel, setPanel] = useState<SheetSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));

  useEffect(() => {
    remembered = filters;
  }, [filters]);

  // The taxonomy is what the sheet's rows are; it changes only when someone
  // edits it in Admin, so it is fetched once rather than per filter change.
  useEffect(() => {
    let cancelled = false;
    getOrgTree()
      .then((data: OrgPillar[]) => !cancelled && setTree(data))
      .catch(() => !cancelled && setError("Could not load the pillars and functions."));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canViewAll) return; // no one else is selectable, so no list is needed
    let cancelled = false;
    getUsers()
      .then((rows: (Person & { is_active: boolean })[]) => {
        if (cancelled) return;
        setPeople(
          rows
            .filter((row) => row.is_active)
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {}); // the sheet still works; only the person list is missing
    return () => {
      cancelled = true;
    };
  }, [canViewAll]);

  useEffect(() => {
    const range = resolveRange(filters.preset, filters.customStart, filters.customEnd);
    if (!range) return; // custom range still incomplete

    let cancelled = false;
    const request =
      filters.scope === "everyone"
        ? getCompanyPanel(range.startDate, range.endDate)
        : getPanel(filters.scope, range.startDate, range.endDate);

    request
      .then((data: SheetSource) => {
        if (cancelled) return;
        setPanel(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the pillar sheet.");
      });

    // Filters can change faster than the API answers, and the two scopes have
    // different denominators — a late reply landing after a newer one would
    // report the wrong window's percentages under the current label.
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const scopeName =
    filters.scope === "everyone"
      ? "Everyone"
      : filters.scope === self.id
        ? self.name
        : (people.find((person) => person.id === filters.scope)?.name ?? "Selected person");

  return (
    <div className="space-y-6 pb-12">
      <ContextHeader
        title={pillarName ?? "Pillars"}
        meta={`${scopeName} · ${rangeLabel(filters.preset)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {filters.preset === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="Range start"
                  className={selectClassName}
                  value={filters.customStart}
                  onChange={(event) => update({ customStart: event.target.value })}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <input
                  type="date"
                  aria-label="Range end"
                  className={selectClassName}
                  value={filters.customEnd}
                  onChange={(event) => update({ customEnd: event.target.value })}
                />
              </div>
            )}

            {/* Offered only with `panel.view.all`: without it the API serves this
                account its own panel and refuses everything else, so a picker
                would be a list of errors waiting to happen. */}
            {canViewAll && (
              <Select
                aria-label="Team member"
                value={String(filters.scope)}
                onChange={(event) =>
                  update({
                    scope:
                      event.target.value === "everyone"
                        ? "everyone"
                        : Number(event.target.value),
                  })
                }
              >
                <option value="everyone">Everyone</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            )}

            <Select
              aria-label="Time range"
              value={filters.preset}
              onChange={(event) => update({ preset: event.target.value as RangePreset })}
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

      {tree && panel && (
        <PillarSheet
          panel={panel}
          tree={tree}
          pillarId={pillarId}
          caption={
            filters.scope === "everyone"
              ? `Share of everyone's ${panel.unit === "minutes" ? "logged time" : "points"}`
              : `Share of ${scopeName}'s ${panel.unit === "minutes" ? "logged time" : "points"}`
          }
        />
      )}
    </div>
  );
}
