"use client";
import { useEffect, useState } from "react";
import { getLeaderboard, getChartData, getCategories } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import ContextHeader from "@/components/ContextHeader";
import { RANGE_PRESETS, rangeLabel, resolveRange, type RangePreset } from "@/lib/date-range";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const CustomDot = (props: any) => {
  const { cx, cy, stroke, shape } = props;
  
  if (shape === "square") {
    return <rect x={cx - 4} y={cy - 4} width={8} height={8} stroke={stroke} fill="white" strokeWidth={2} />;
  } else if (shape === "triangle") {
    return <polygon points={`${cx},${cy - 5} ${cx - 5},${cy + 5} ${cx + 5},${cy + 5}`} stroke={stroke} fill="white" strokeWidth={2} />;
  } else if (shape === "diamond") {
    return <polygon points={`${cx},${cy - 6} ${cx - 5},${cy} ${cx},${cy + 6} ${cx + 5},${cy}`} stroke={stroke} fill="white" strokeWidth={2} />;
  } else if (shape === "star") {
    return <path d={`M${cx},${cy-5} L${cx+1.5},${cy-1.5} L${cx+5},${cy-1.5} L${cx+2.5},${cy+1} L${cx+3.5},${cy+5} L${cx},${cy+2.5} L${cx-3.5},${cy+5} L${cx-2.5},${cy+1} L${cx-5},${cy-1.5} L${cx-1.5},${cy-1.5} Z`} stroke={stroke} fill="white" strokeWidth={2} />;
  }
  // default circle
  return <circle cx={cx} cy={cy} r={4} stroke={stroke} fill="white" strokeWidth={2} />;
};

export default function LeaderboardClient() {
  const [data, setData] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | "">("");
  const [timeFilter, setTimeFilter] = useState("7d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // The matrix carries its own range so it can be read over a different window
  // than the chart above it.
  const [matrixRange, setMatrixRange] = useState<RangePreset>("all");
  const [matrixStart, setMatrixStart] = useState("");
  const [matrixEnd, setMatrixEnd] = useState("");

  useEffect(() => {
    getCategories().then(setCategories).catch(console.error);
  }, []);

  useEffect(() => {
    const range = resolveRange(matrixRange, matrixStart, matrixEnd);
    if (!range) return; // custom range still incomplete
    getLeaderboard(range.startDate, range.endDate).then(setData).catch(console.error);
  }, [matrixRange, matrixStart, matrixEnd]);

  useEffect(() => {
    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;
    
    const now = new Date();
    const getFormattedDate = (d: Date) => {
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().split('T')[0];
    };
    
    if (timeFilter === "7d") {
      const past = new Date(now); past.setDate(past.getDate() - 6);
      startDate = getFormattedDate(past);
      endDate = getFormattedDate(now);
    } else if (timeFilter === "30d") {
      const past = new Date(now); past.setDate(past.getDate() - 29);
      startDate = getFormattedDate(past);
      endDate = getFormattedDate(now);
    } else if (timeFilter === "90d") {
      const past = new Date(now); past.setDate(past.getDate() - 89);
      startDate = getFormattedDate(past);
      endDate = getFormattedDate(now);
    } else if (timeFilter === "all") {
      const past = new Date(now); past.setDate(past.getDate() - 364);
      startDate = getFormattedDate(past);
      endDate = getFormattedDate(now);
    } else if (timeFilter === "custom") {
      if (customStart && customEnd) {
        startDate = customStart;
        endDate = customEnd;
      } else {
        return; // Don't fetch until both are set
      }
    }

    getChartData(selectedCategory === "" ? undefined : selectedCategory, startDate, endDate)
      .then(setChartData)
      .catch(console.error);
  }, [selectedCategory, timeFilter, customStart, customEnd]);

  // Colour and shape are assigned from a stable identity, so re-ranking the
  // matrix for a different range cannot recolour the chart's lines.
  const chartSeries = [...data].sort((a, b) => a.user_id - b.user_id);

  return (
    <div className="space-y-6 pb-12">
      <ContextHeader title="Leaderboard" />

      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0">
          <CardTitle>
            Point History 
            {timeFilter !== "custom" && timeFilter !== "all" && ` (Last ${timeFilter.replace('d', ' Days')})`}
            {timeFilter === "all" && ` (Last 1 Year)`}
            {timeFilter === "custom" && ` (Custom Range)`}
          </CardTitle>
          <div className="flex flex-wrap gap-2 items-center">
            {timeFilter === "custom" && (
              <div className="flex gap-2 items-center">
                <input 
                  type="date" 
                  className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                />
                <span className="text-sm text-slate-500">to</span>
                <input 
                  type="date" 
                  className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                />
              </div>
            )}
            <select 
              className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last Quarter</option>
              <option value="all">All Time (1 Year)</option>
              <option value="custom">Custom...</option>
            </select>
            <select 
              className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">All Points</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name} Points</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-80 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                {chartSeries.map((u, i) => {
                  const colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"];
                  const shapes = ["circle", "square", "triangle", "diamond", "star"];
                  return (
                    <Line
                      key={u.user_id}
                      type="monotone"
                      dataKey={u.name}
                      name={u.name.toUpperCase()}
                      stroke={colors[i % colors.length]}
                      strokeWidth={2} 
                      dot={(props: any) => <CustomDot {...props} shape={shapes[i % shapes.length]} />}
                      activeDot={{ r: 8 }} 
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0">
          <CardTitle>Point Matrix ({rangeLabel(matrixRange)})</CardTitle>
          <div className="flex flex-wrap gap-2 items-center">
            {matrixRange === "custom" && (
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  aria-label="Matrix range start"
                  className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
                  value={matrixStart}
                  onChange={(e) => setMatrixStart(e.target.value)}
                />
                <span className="text-sm text-slate-500">to</span>
                <input
                  type="date"
                  aria-label="Matrix range end"
                  className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
                  value={matrixEnd}
                  onChange={(e) => setMatrixEnd(e.target.value)}
                />
              </div>
            )}
            <select
              aria-label="Point matrix time range"
              className="border rounded p-2 text-sm bg-white dark:bg-slate-900"
              value={matrixRange}
              onChange={(e) => setMatrixRange(e.target.value as RangePreset)}
            >
              {RANGE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>User</TableHead>
                {/* One column per category, so a column labelled with a category
                    name holds that category's points. */}
                {categories.map(c => (
                  <TableHead key={c.id}>{c.name.trim()}</TableHead>
                ))}
                <TableHead>Total Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((user, idx) => (
                <TableRow key={user.user_id}>
                  <TableCell>
                    {idx === 0 && <Badge className="bg-yellow-500">1st</Badge>}
                    {idx === 1 && <Badge className="bg-slate-400">2nd</Badge>}
                    {idx === 2 && <Badge className="bg-orange-700">3rd</Badge>}
                    {idx > 2 && idx + 1}
                  </TableCell>
                  <TableCell className="font-medium">{user.name.toUpperCase()}</TableCell>
                  {categories.map(c => (
                    <TableCell key={c.id}>{user.category_points?.[String(c.id)] ?? 0}</TableCell>
                  ))}
                  <TableCell className="text-lg font-bold">
                    {user.total_points}
                    {matrixRange !== "all" && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        of {user.all_time_points} all time
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
