"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getGoals,
  createGoal,
  updateGoal,
  getGoalUsage,
  deleteGoal,
  createMilestone,
  completeMilestone,
  updateMilestone,
  getMilestoneUsage,
  deleteMilestone,
  asDeletionBlocked,
} from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ConfirmDialog from "@/components/ConfirmDialog";
import { PlusCircle, Pencil, Check, X, Trash2 } from "lucide-react";

type Milestone = {
  id: number;
  title: string;
  goal_id: number;
  status: string;
  task_count: number;
  completed_task_count: number;
  progress_pct: number;
};
type Goal = {
  id: number;
  title: string;
  milestone_count: number;
  completed_milestone_count: number;
  progress_pct: number;
  milestones: Milestone[];
};
type GoalUsage = {
  goal_id: number;
  title: string;
  milestone_count: number;
  completed_milestone_count: number;
  task_count: number;
  completed_task_count: number;
};
type MilestoneUsage = {
  milestone_id: number;
  title: string;
  goal_id: number;
  goal_title: string;
  task_count: number;
  completed_task_count: number;
  pending_task_count: number;
};

/** Which row is in rename mode. Goal and milestone ids overlap, so the kind matters. */
type Editing = { kind: "goal" | "milestone"; id: number };
type PendingDelete =
  | { kind: "goal"; id: number; title: string }
  | { kind: "milestone"; id: number; title: string };

export default function GoalsAdminForm() {
  const router = useRouter();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalTitle, setGoalTitle] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [editTitle, setEditTitle] = useState("");

  /** The row queued for deletion, plus what deleting it would disturb. */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [goalUsage, setGoalUsage] = useState<GoalUsage | null>(null);
  const [milestoneUsage, setMilestoneUsage] = useState<MilestoneUsage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = () => getGoals().then(setGoals).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  /**
   * The rail lists goals from a Server Component in the shell layout, so a
   * rename or delete here has to invalidate that too — otherwise the old title
   * lingers in the rail, or a deleted goal stays in it, until a hard reload.
   */
  const reloadAll = () => {
    reload();
    router.refresh();
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createGoal({ title: goalTitle });
      reloadAll();
      setGoalTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create goal");
    }
  };

  const handleAddMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedGoalId) {
      setError("Please select a goal.");
      return;
    }
    try {
      await createMilestone({ title: milestoneTitle, goal_id: parseInt(selectedGoalId) });
      reloadAll();
      setMilestoneTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add milestone");
    }
  };

  const handleCompleteMilestone = async (milestoneId: number) => {
    setError(null);
    try {
      await completeMilestone(milestoneId);
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update milestone");
    }
  };

  const startEdit = (kind: "goal" | "milestone", row: { id: number; title: string }) => {
    setEditing({ kind, id: row.id });
    setEditTitle(row.title);
  };

  const cancelEdit = () => setEditing(null);

  const handleSaveEdit = async () => {
    if (!editing) return;
    setError(null);
    try {
      if (editing.kind === "goal") {
        await updateGoal(editing.id, { title: editTitle });
      } else {
        await updateMilestone(editing.id, { title: editTitle });
      }
      setEditing(null);
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to rename ${editing.kind}`);
    }
  };

  const startDelete = async (pending: PendingDelete) => {
    setPendingDelete(pending);
    setGoalUsage(null);
    setMilestoneUsage(null);
    setDeleteError(null);
    try {
      if (pending.kind === "goal") {
        setGoalUsage(await getGoalUsage(pending.id));
      } else {
        setMilestoneUsage(await getMilestoneUsage(pending.id));
      }
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : `Could not check what uses this ${pending.kind}`
      );
    }
  };

  const usageLoaded = pendingDelete?.kind === "goal" ? goalUsage !== null : milestoneUsage !== null;
  // Cascade is sent only when the preview actually found children. If something
  // was added in between, the API refuses and the dialog re-reads the counts
  // rather than silently taking more with it than the user was shown.
  const needsCascade =
    pendingDelete?.kind === "goal"
      ? (goalUsage?.milestone_count ?? 0) > 0
      : (milestoneUsage?.task_count ?? 0) > 0;

  const refreshUsage = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "goal") {
      getGoalUsage(pendingDelete.id).then(setGoalUsage).catch(() => {});
    } else {
      getMilestoneUsage(pendingDelete.id).then(setMilestoneUsage).catch(() => {});
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      if (pendingDelete.kind === "goal") {
        await deleteGoal(pendingDelete.id, needsCascade);
      } else {
        await deleteMilestone(pendingDelete.id, needsCascade);
      }
      setPendingDelete(null);
      reloadAll();
    } catch (err) {
      const blocked = asDeletionBlocked(err);
      setDeleteError(
        err instanceof Error ? err.message : `Failed to delete ${pendingDelete.kind}`
      );
      if (blocked) refreshUsage();
    }
  };

  return (
    <>
      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create Goal</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateGoal} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Goal Title</label>
              <Input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} required />
            </div>
            <Button type="submit" className="flex gap-2">
              <PlusCircle className="w-4 h-4" />
              Create Goal
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create Milestone</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddMilestone} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Milestone Title</label>
              <Input
                value={milestoneTitle}
                onChange={(e) => setMilestoneTitle(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Goal</label>
              <select
                className="w-full border rounded p-2 bg-white dark:bg-slate-900"
                value={selectedGoalId}
                onChange={(e) => setSelectedGoalId(e.target.value)}
              >
                <option value="">Select Goal</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="flex gap-2">
              <PlusCircle className="w-4 h-4" />
              Add Milestone
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Goals &amp; Milestones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {goals.length === 0 ? (
            <div className="text-center text-sm text-slate-500 p-4">No goals yet.</div>
          ) : (
            goals.map((goal) => (
              <div key={goal.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  {editing?.kind === "goal" && editing.id === goal.id ? (
                    <>
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="max-w-xs"
                      />
                      <Button type="button" size="sm" onClick={handleSaveEdit}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">{goal.title}</span>
                      <Badge variant="outline">
                        {goal.completed_milestone_count}/{goal.milestone_count} milestones
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Rename ${goal.title}`}
                        title="Rename goal"
                        onClick={() => startEdit("goal", goal)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        aria-label={`Delete ${goal.title}`}
                        title="Delete goal"
                        onClick={() =>
                          startDelete({ kind: "goal", id: goal.id, title: goal.title })
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
                <div className="space-y-2 pl-3 border-l-2 border-slate-200 dark:border-slate-800">
                  {goal.milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="flex justify-between items-center p-3 border rounded gap-4"
                    >
                      {editing?.kind === "milestone" && editing.id === milestone.id ? (
                        <>
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="max-w-xs"
                          />
                          <div className="flex gap-2">
                            <Button type="button" size="sm" onClick={handleSaveEdit}>
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{milestone.title}</span>
                          <div className="flex items-center gap-2">
                            {milestone.progress_pct === 100 ? (
                              <Badge variant="outline" className="text-green-600 bg-green-50">
                                Completed
                              </Badge>
                            ) : (
                              <>
                                <Badge variant="outline">
                                  {milestone.completed_task_count}/{milestone.task_count} tasks
                                </Badge>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleCompleteMilestone(milestone.id)}
                                >
                                  Mark Complete
                                </Button>
                              </>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={`Rename ${milestone.title}`}
                              title="Rename milestone"
                              onClick={() => startEdit("milestone", milestone)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              aria-label={`Delete ${milestone.title}`}
                              title="Delete milestone"
                              onClick={() =>
                                startDelete({
                                  kind: "milestone",
                                  id: milestone.id,
                                  title: milestone.title,
                                })
                              }
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.title ?? "item"}?`}
        description="This cannot be undone."
        confirmLabel={pendingDelete?.kind === "goal" ? "Delete goal" : "Delete milestone"}
        destructive
        confirmDisabled={!usageLoaded}
        error={deleteError}
        onConfirm={handleConfirmDelete}
      >
        {!usageLoaded ? (
          <div className="text-sm text-muted-foreground">
            Checking what this {pendingDelete?.kind ?? "item"} holds…
          </div>
        ) : pendingDelete?.kind === "goal" ? (
          <GoalDeletePreview usage={goalUsage!} />
        ) : (
          <MilestoneDeletePreview usage={milestoneUsage!} />
        )}
      </ConfirmDialog>
    </>
  );
}

/**
 * Deleting a goal takes its milestones with it. Tasks are only unlinked, which
 * is worth saying outright — "this goal has 12 tasks" reads like a threat to
 * them otherwise.
 */
function GoalDeletePreview({ usage }: { usage: GoalUsage }) {
  if (usage.milestone_count === 0) {
    return <div className="text-sm text-muted-foreground">This goal has no milestones.</div>;
  }
  return (
    <div className="rounded border bg-muted/40 p-3 text-sm space-y-2">
      <div>
        <span className="font-medium">
          {usage.milestone_count} {usage.milestone_count === 1 ? "milestone" : "milestones"} will be
          deleted
        </span>{" "}
        <span className="text-muted-foreground">
          ({usage.completed_milestone_count} completed,{" "}
          {usage.milestone_count - usage.completed_milestone_count} pending).
        </span>
      </div>
      {usage.task_count > 0 && (
        <div className="text-muted-foreground">
          The {usage.task_count} {usage.task_count === 1 ? "task" : "tasks"} underneath{" "}
          {usage.task_count === 1 ? "is" : "are"} kept and simply unlinked — points already earned
          stay on the leaderboard.
        </div>
      )}
    </div>
  );
}

function MilestoneDeletePreview({ usage }: { usage: MilestoneUsage }) {
  if (usage.task_count === 0) {
    return <div className="text-sm text-muted-foreground">No tasks are linked to this milestone.</div>;
  }
  return (
    <div className="rounded border bg-muted/40 p-3 text-sm">
      <span className="font-medium">
        {usage.task_count} {usage.task_count === 1 ? "task is" : "tasks are"} linked to this
        milestone
      </span>{" "}
      <span className="text-muted-foreground">
        ({usage.completed_task_count} completed, {usage.pending_task_count} pending). They are kept
        and simply unlinked — points already earned stay on the leaderboard.
      </span>
    </div>
  );
}
