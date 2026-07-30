"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Check } from "lucide-react";
import ContextHeader from "@/components/ContextHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadExport, getExportManifest } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { RANGE_PRESETS, rangeLabel, resolveRange, type RangePreset } from "@/lib/date-range";

type SheetInfo = {
  key: string;
  label: string;
  group: string;
  description: string;
  range_scoped: boolean;
  row_estimate: number;
};

type Manifest = {
  sheets: SheetInfo[];
  scope: "all" | "own";
  formats: string[];
  default_sheets: string[];
  group_order: string[];
};

type Format = "csv" | "xlsx";

export default function ExportClient() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<Format>("xlsx");
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  /** The default selection is applied once. Without this, refetching the manifest
   *  after a range change would re-tick boxes the user had deliberately cleared. */
  const [seeded, setSeeded] = useState(false);

  const range = resolveRange(preset, customStart, customEnd);

  // Row estimates are range-dependent, so the manifest is refetched whenever the
  // window changes. An incomplete custom range resolves to null - skip it rather
  // than ask the API about a nonsense window.
  useEffect(() => {
    if (!range) return;
    getExportManifest(range.startDate, range.endDate)
      .then((data: Manifest) => {
        setManifest(data);
        if (!seeded) {
          setSelected(data.default_sheets);
          setSeeded(true);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load export options"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.startDate, range?.endDate]);

  const groups = useMemo(() => {
    if (!manifest) return [];
    const order = manifest.group_order;
    const names = [...new Set(manifest.sheets.map((s) => s.group))].sort(
      (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
    );
    return names.map((group) => ({
      group,
      items: manifest.sheets.filter((s) => s.group === group),
    }));
  }, [manifest]);

  const toggle = (key: string) => {
    setSavedName(null);
    setSelected((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  };

  const download = async () => {
    if (!range || !selected.length) return;
    setBusy(true);
    setError(null);
    setSavedName(null);
    try {
      const { blob, filename } = await downloadExport({
        format,
        // Send catalogue order, not click order, so the file is predictable.
        sheets: manifest!.sheets.filter((s) => selected.includes(s.key)).map((s) => s.key),
        startDate: range.startDate,
        endDate: range.endDate,
      });
      saveBlob(blob, filename);
      setSavedName(filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const incompleteRange = range === null;
  const totalRows = manifest
    ? manifest.sheets
        .filter((s) => selected.includes(s.key))
        .reduce((sum, s) => sum + s.row_estimate, 0)
    : 0;

  const extension = format === "xlsx" ? "xlsx" : selected.length === 1 ? "csv" : "zip";

  return (
    <div className="space-y-6 pb-12">
      <ContextHeader
        title="Export Data"
        meta={
          manifest
            ? manifest.scope === "own"
              ? "your data only"
              : "all accounts"
            : undefined
        }
        actions={
          <Button onClick={download} disabled={busy || !selected.length || incompleteRange}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {busy ? "Preparing..." : `Download .${extension}`}
          </Button>
        }
      />

      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {savedName && (
        <div className="flex items-center gap-2 rounded border border-green-600/40 p-3 text-sm text-green-700 dark:text-green-500">
          <Check className="h-4 w-4" />
          Downloaded {savedName}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0">
          <CardTitle>Range and format</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {preset === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span className="text-sm text-slate-500">to</span>
                <input
                  type="date"
                  className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            )}
            <select
              className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
              value={preset}
              onChange={(e) => setPreset(e.target.value as RangePreset)}
            >
              {RANGE_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={format === "xlsx" ? "default" : "outline"}
                onClick={() => setFormat("xlsx")}
              >
                Excel
              </Button>
              <Button
                size="sm"
                variant={format === "csv" ? "default" : "outline"}
                onClick={() => setFormat("csv")}
              >
                CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {incompleteRange ? (
            <p className="text-destructive">Pick both a start and an end date.</p>
          ) : (
            <p>
              {format === "xlsx"
                ? `One .xlsx workbook, one tab per sheet.`
                : selected.length === 1
                  ? `One .csv file.`
                  : `A .zip containing one .csv per sheet, plus a README.`}{" "}
              Sheets marked <span className="font-medium">dated</span> cover{" "}
              {rangeLabel(preset).toLowerCase()}; the rest are lifetime figures.
            </p>
          )}
          {manifest?.scope === "own" && (
            <p>
              Your account exports its own rows only. Ask an administrator for
              &ldquo;Export everyone&apos;s data&rdquo; to widen it.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <CardTitle>Sheets</CardTitle>
          <span className="text-xs text-muted-foreground">
            {selected.length} selected &middot; ~{totalRows.toLocaleString()} rows
          </span>
          <span className="ml-auto flex items-center gap-3 text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(manifest?.sheets.map((s) => s.key) ?? [])}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
          </span>
        </CardHeader>
        <CardContent className="space-y-6">
          {!manifest && <p className="text-sm text-muted-foreground">Loading sheets...</p>}
          {groups.map(({ group, items }) => (
            <div key={group} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                {group}
              </div>
              {items.map((sheet) => (
                <label
                  key={sheet.key}
                  className="flex cursor-pointer items-start gap-3 rounded p-2 hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(sheet.key)}
                    onChange={() => toggle(sheet.key)}
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium">{sheet.label}</span>
                      {sheet.range_scoped && (
                        <span className="text-[10px] uppercase text-muted-foreground">dated</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {sheet.row_estimate.toLocaleString()} rows
                      </span>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {sheet.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
