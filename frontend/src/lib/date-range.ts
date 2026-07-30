export type RangePreset = "today" | "week" | "month" | "7d" | "30d" | "all" | "custom";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom..." },
];

/** Local calendar day as YYYY-MM-DD, avoiding the UTC shift of toISOString(). */
function toIsoDay(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split("T")[0];
}

export type ResolvedRange = { startDate?: string; endDate?: string };

/**
 * Turns a preset into inclusive calendar bounds.
 *
 * Returns null when the selection is incomplete (a custom range missing a bound)
 * so the caller can skip fetching rather than request a nonsense window.
 * "all" resolves to no bounds at all, which the API reads as all time.
 */
export function resolveRange(
  preset: RangePreset,
  customStart?: string,
  customEnd?: string,
): ResolvedRange | null {
  const now = new Date();
  const today = toIsoDay(now);

  const daysAgo = (days: number) => {
    const past = new Date(now);
    past.setDate(past.getDate() - days);
    return toIsoDay(past);
  };

  switch (preset) {
    case "all":
      return {};
    case "today":
      return { startDate: today, endDate: today };
    case "week": {
      // Monday start, matching the backend's weekday() convention.
      const monday = new Date(now);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      return { startDate: toIsoDay(monday), endDate: today };
    }
    case "month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: toIsoDay(first), endDate: today };
    }
    case "7d":
      return { startDate: daysAgo(6), endDate: today };
    case "30d":
      return { startDate: daysAgo(29), endDate: today };
    case "custom":
      if (!customStart || !customEnd) return null;
      return { startDate: customStart, endDate: customEnd };
  }
}

export function rangeLabel(preset: RangePreset): string {
  return RANGE_PRESETS.find((p) => p.value === preset)?.label ?? "All Time";
}
