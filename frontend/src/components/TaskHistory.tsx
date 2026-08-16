"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, selectClassName } from "@/components/ui/select";
import { History, X } from "lucide-react";

export type HistoryTask = {
  id: number;
  title: string;
  user_id: number;
  category_id: number | null;
  milestone_id: number | null;
  is_recurring: boolean;
  status: string;
  points: number | null;
};

export type FilterCategory = { id: number; name: string };
export type FilterUser = { id: number; name: string };
export type FilterGoal = { id: number; title: string };
export type FilterMilestone = { id: number; title: string; goal_id: number };

type TaskHistoryProps = {
  tasks: HistoryTask[];
  categories: FilterCategory[];
  users: FilterUser[];
  goals: FilterGoal[];
  milestones: FilterMilestone[];
  getPoints: (task: HistoryTask) => number;
  getAssignee: (userId: number) => string;
};

/** "" means any; "none" means the field is unset. */
type Filters = {
  title: string;
  categoryId: string;
  userId: string;
  goalId: string;
  milestoneId: string;
  recurring: "any" | "daily" | "oneoff";
  minPoints: string;
  maxPoints: string;
};

const EMPTY_FILTERS: Filters = {
  title: "",
  categoryId: "",
  userId: "",
  goalId: "",
  milestoneId: "",
  recurring: "any",
  minPoints: "",
  maxPoints: "",
};

const selectClass = `${selectClassName} max-w-[12rem] truncate`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export default function TaskHistory({
  tasks,
  categories,
  users,
  goals,
  milestones,
  getPoints,
  getAssignee,
}: TaskHistoryProps) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const isFiltered = useMemo(
    () => Object.keys(EMPTY_FILTERS).some((k) => filters[k as keyof Filters] !== EMPTY_FILTERS[k as keyof Filters]),
    [filters],
  );

  /** A task's goal is reached through its milestone. */
  const goalIdOf = (task: HistoryTask) =>
    milestones.find((m) => m.id === task.milestone_id)?.goal_id ?? null;

  // Milestone options narrow to the chosen goal, so the two selects can't
  // contradict each other.
  const milestoneOptions =
    filters.goalId === "" || filters.goalId === "none"
      ? milestones
      : milestones.filter((m) => m.goal_id === Number(filters.goalId));

  const selectGoal = (value: string) => {
    setFilters((current) => {
      const stillValid =
        current.milestoneId === "" ||
        current.milestoneId === "none" ||
        (value !== "" &&
          value !== "none" &&
          milestones.some((m) => m.id === Number(current.milestoneId) && m.goal_id === Number(value)));
      return { ...current, goalId: value, milestoneId: stillValid ? current.milestoneId : "" };
    });
  };

  const visible = useMemo(() => {
    const needle = filters.title.trim().toLowerCase();
    const min = filters.minPoints === "" ? null : Number(filters.minPoints);
    const max = filters.maxPoints === "" ? null : Number(filters.maxPoints);
    // Built here rather than reusing goalIdOf, which is redefined every render
    // and would defeat the memo.
    const goalByMilestone = new Map(milestones.map((m) => [m.id, m.goal_id]));
    const goalOf = (task: HistoryTask) =>
      task.milestone_id === null ? null : goalByMilestone.get(task.milestone_id) ?? null;

    return tasks.filter((task) => {
      if (needle && !task.title.toLowerCase().includes(needle)) return false;

      if (filters.categoryId === "none") {
        if (task.category_id !== null) return false;
      } else if (filters.categoryId && task.category_id !== Number(filters.categoryId)) {
        return false;
      }

      if (filters.userId && task.user_id !== Number(filters.userId)) return false;

      if (filters.goalId === "none") {
        if (goalOf(task) !== null) return false;
      } else if (filters.goalId && goalOf(task) !== Number(filters.goalId)) {
        return false;
      }

      if (filters.milestoneId === "none") {
        if (task.milestone_id !== null) return false;
      } else if (filters.milestoneId && task.milestone_id !== Number(filters.milestoneId)) {
        return false;
      }

      if (filters.recurring === "daily" && !task.is_recurring) return false;
      if (filters.recurring === "oneoff" && task.is_recurring) return false;

      const points = getPoints(task);
      if (min !== null && !Number.isNaN(min) && points < min) return false;
      if (max !== null && !Number.isNaN(max) && points > max) return false;

      return true;
    });
    // getPoints closes over the parent's task list, which changes with the data.
  }, [tasks, filters, milestones, getPoints]);

  const milestoneTitle = (task: HistoryTask) =>
    milestones.find((m) => m.id === task.milestone_id)?.title;
  const goalTitle = (task: HistoryTask) => {
    const goalId = goalIdOf(task);
    return goals.find((g) => g.id === goalId)?.title;
  };
  const categoryName = (task: HistoryTask) =>
    categories.find((c) => c.id === task.category_id)?.name.trim();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <History className="w-5 h-5 text-muted-foreground" />
        <CardTitle>Task History</CardTitle>
        <span className="ml-auto text-xs text-muted-foreground">
          {isFiltered ? `${visible.length} of ${tasks.length}` : tasks.length}
        </span>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded border bg-muted/30 p-3">
          <Field label="Title">
            <Input
              value={filters.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Search title"
              className="h-9 max-w-[14rem]"
            />
          </Field>

          <Field label="Category">
            <Select
              className={selectClass}
              value={filters.categoryId}
              onChange={(e) => set("categoryId", e.target.value)}
            >
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name.trim()}</option>
              ))}
              <option value="none">No category</option>
            </Select>
          </Field>

          <Field label="Completed by">
            <Select
              className={selectClass}
              value={filters.userId}
              onChange={(e) => set("userId", e.target.value)}
            >
              <option value="">Anyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name.toUpperCase()}</option>
              ))}
            </Select>
          </Field>

          <Field label="Goal">
            <Select className={selectClass} value={filters.goalId} onChange={(e) => selectGoal(e.target.value)}>
              <option value="">Any goal</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
              <option value="none">No goal</option>
            </Select>
          </Field>

          <Field label="Milestone">
            <Select
              className={selectClass}
              value={filters.milestoneId}
              onChange={(e) => set("milestoneId", e.target.value)}
            >
              <option value="">Any milestone</option>
              {milestoneOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
              <option value="none">No milestone</option>
            </Select>
          </Field>

          <Field label="Type">
            <Select
              className={selectClass}
              value={filters.recurring}
              onChange={(e) => set("recurring", e.target.value as Filters["recurring"])}
            >
              <option value="any">Any type</option>
              <option value="daily">Daily only</option>
              <option value="oneoff">One-off only</option>
            </Select>
          </Field>

          <Field label="Points">
            <div className="flex items-center gap-1">
              <Input
                type="number"
                inputMode="numeric"
                value={filters.minPoints}
                onChange={(e) => set("minPoints", e.target.value)}
                placeholder="min"
                aria-label="Minimum points"
                className="h-9 w-20"
              />
              <span className="text-sm text-muted-foreground">–</span>
              <Input
                type="number"
                inputMode="numeric"
                value={filters.maxPoints}
                onChange={(e) => set("maxPoints", e.target.value)}
                placeholder="max"
                aria-label="Maximum points"
                className="h-9 w-20"
              />
            </div>
          </Field>

          {isFiltered && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="flex items-center gap-1 rounded border px-2 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        {tasks.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground p-4">No completed tasks yet.</div>
        ) : visible.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground p-4">
            No completed tasks match these filters.
          </div>
        ) : (
          visible.map((task) => (
            <div
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 border rounded bg-muted/50"
            >
              <div className="min-w-0">
                <div className="font-semibold line-through text-muted-foreground">
                  {task.title}
                  <span className="font-normal text-sm ml-1">({getPoints(task)}p)</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  <span>Completed by: {getAssignee(task.user_id)}</span>
                  {categoryName(task) && <span>· {categoryName(task)}</span>}
                  {goalTitle(task) && <span>· {goalTitle(task)}</span>}
                  {milestoneTitle(task) && <span>· {milestoneTitle(task)}</span>}
                  {task.is_recurring && <span>· Daily</span>}
                </div>
              </div>
              <Badge variant="success">
                Done
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
