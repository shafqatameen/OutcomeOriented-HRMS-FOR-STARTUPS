"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TaskUpdate } from "@/lib/api";
import { Select, selectClassName } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export type EditableTask = {
  id: number;
  title: string;
  user_id: number;
  milestone_id: number | null;
  function_id: number | null;
  is_recurring: boolean;
  points: number | null;
};

type EditUser = { id: number; name: string; is_active?: boolean };
type EditGoal = { id: number; title: string };
type EditMilestone = { id: number; title: string; goal_id: number };
type EditPillar = {
  id: number;
  name: string;
  functions: { id: number; name: string }[];
};

type TaskEditDialogProps = {
  /**
   * null keeps the dialog closed; setting a task opens it on that row. Give the
   * element a `key` of the task id so opening a different row remounts it and
   * the form re-seeds from scratch.
   */
  task: EditableTask | null;
  users: EditUser[];
  goals: EditGoal[];
  milestones: EditMilestone[];
  /** Pillars with their functions, for the domain tag. Empty hides the field. */
  pillars?: EditPillar[];
  /** The category default, shown as the points placeholder so blank means something. */
  inheritedPoints: number;
  onClose: () => void;
  /** Rejecting keeps the dialog open with the error, so nothing is lost. */
  onSave: (taskId: number, patch: TaskUpdate) => Promise<void>;
};

type Form = {
  title: string;
  userId: string;
  milestoneId: string;
  functionId: string;
  /** Blank means "inherit the category default" — not zero. */
  points: string;
  isRecurring: boolean;
};

const formFor = (task: EditableTask): Form => ({
  title: task.title,
  userId: String(task.user_id),
  milestoneId: task.milestone_id === null ? "" : String(task.milestone_id),
  functionId: task.function_id === null ? "" : String(task.function_id),
  points: task.points === null ? "" : String(task.points),
  isRecurring: task.is_recurring,
});

const selectClass = `${selectClassName} w-full`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Edits one task: title, who it is on, its milestone, its points, whether it
 * recurs. Category is not here on purpose — a task changes column by being
 * dragged there, which also decides where in that column it lands.
 *
 * Only the fields that actually changed are sent, so two people editing
 * different fields of the same task do not overwrite each other.
 */
export default function TaskEditDialog({
  task,
  users,
  goals,
  milestones,
  pillars = [],
  inheritedPoints,
  onClose,
  onSave,
}: TaskEditDialogProps) {
  // Seeded once per mount. The caller keys this component on the task id, so a
  // different row arrives as a fresh mount rather than as a prop change an
  // effect would have to chase.
  const [form, setForm] = useState<Form | null>(() => (task ? formFor(task) : null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  // Unmounted rather than kept open={false}: there is no exit animation to wait
  // for, and a mounted-but-hidden form would keep the last task's values around.
  if (!task || !form) return null;

  // A deactivated account cannot sign in, so it could never complete the task.
  // The current assignee stays listed either way — hiding them would silently
  // preselect somebody else.
  const assignable = users.filter((u) => u.is_active !== false || u.id === task.user_id);

  const milestonesByGoal = goals
    .map((goal) => ({ goal, options: milestones.filter((m) => m.goal_id === goal.id) }))
    .filter((group) => group.options.length > 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const title = form.title.trim();
    if (!title) {
      setError("Title must not be empty.");
      return;
    }

    const points = form.points.trim() === "" ? null : Number(form.points);
    if (points !== null && (!Number.isInteger(points) || points < 0)) {
      setError("Points must be a whole number, zero or more. Leave it blank to use the category default.");
      return;
    }

    const milestoneId = form.milestoneId === "" ? null : Number(form.milestoneId);
    const functionId = form.functionId === "" ? null : Number(form.functionId);
    const userId = Number(form.userId);

    const patch: TaskUpdate = {};
    if (title !== task.title) patch.title = title;
    if (userId !== task.user_id) patch.user_id = userId;
    if (milestoneId !== task.milestone_id) patch.milestone_id = milestoneId;
    if (functionId !== task.function_id) patch.function_id = functionId;
    if (points !== task.points) patch.points = points;
    if (form.isRecurring !== task.is_recurring) patch.is_recurring = form.isRecurring;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    try {
      await onSave(task.id, patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the changes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      // Dismissing mid-request would strand the save with no feedback.
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      disablePointerDismissal={busy}
    >
      <DialogContent showCloseButton={!busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            Drag the task to another column to change its category.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Title">
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              autoFocus
              required
            />
          </Field>

          <Field label="Assigned to">
            <Select
              className={selectClass}
              value={form.userId}
              onChange={(e) => set("userId", e.target.value)}
            >
              {assignable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name.toUpperCase()}
                  {u.is_active === false ? " (deactivated)" : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Milestone">
            <Select
              className={selectClass}
              value={form.milestoneId}
              onChange={(e) => set("milestoneId", e.target.value)}
            >
              <option value="">No milestone</option>
              {milestonesByGoal.map(({ goal, options }) => (
                <optgroup key={goal.id} label={goal.title}>
                  {options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>

          {/* Retagging is allowed on a completed task, unlike reassigning or
              repricing: the ledger stores no function of its own, so this moves
              the points with it rather than stranding them. */}
          {pillars.length > 0 && (
            <Field label="Function">
              <Select
                className={selectClass}
                value={form.functionId}
                onChange={(e) => set("functionId", e.target.value)}
              >
                <option value="">Untagged</option>
                {pillars.map((pillar) => (
                  <optgroup key={pillar.id} label={pillar.name}>
                    {pillar.functions.map((fn) => (
                      <option key={fn.id} value={fn.id}>
                        {fn.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Points">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={form.points}
              onChange={(e) => set("points", e.target.value)}
              placeholder={`Category default (${inheritedPoints}p)`}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isRecurring}
              onChange={(e) => set("isRecurring", e.target.checked)}
            />
            <span>Repeats daily</span>
          </label>

          {error && (
            <div className="rounded border border-destructive/50 p-3 text-sm wrap-anywhere text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
