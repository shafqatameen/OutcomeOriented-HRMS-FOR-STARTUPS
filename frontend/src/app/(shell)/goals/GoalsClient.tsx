"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getGoals, updateGoal, getGoalUsage, deleteGoal, asDeletionBlocked } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDialog from "@/components/ConfirmDialog";
import ContextHeader from "@/components/ContextHeader";
import { CheckCircle2, Circle, Pencil, Trash2, Check, X } from "lucide-react";

type GoalsClientProps = {
  /** When set, show only this goal. Otherwise show every goal. */
  goalId?: number;
  /** Resolved server-side so the heading is correct on first paint. */
  title?: string;
  /** Whether this session may rename/delete goals. Presentation only — the API enforces it too. */
  canManage?: boolean;
};

type GoalUsage = {
  goal_id: number;
  title: string;
  milestone_count: number;
  completed_milestone_count: number;
  task_count: number;
  completed_task_count: number;
};

export default function GoalsClient({ goalId, title, canManage = false }: GoalsClientProps) {
  const router = useRouter();
  const [goals, setGoals] = useState<any[]>([]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<{ id: number; title: string } | null>(null);
  const [goalUsage, setGoalUsage] = useState<GoalUsage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = () => getGoals().then(setGoals).catch(console.error);

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

  const visibleGoals = goalId === undefined ? goals : goals.filter(g => g.id === goalId);

  const startEdit = (goal: { id: number; title: string }) => {
    setEditingId(goal.id);
    setEditTitle(goal.title);
    setEditError(null);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (editingId === null) return;
    setEditError(null);
    try {
      await updateGoal(editingId, { title: editTitle });
      setEditingId(null);
      reloadAll();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to rename goal");
    }
  };

  const startDelete = async (goal: { id: number; title: string }) => {
    setPendingDelete(goal);
    setGoalUsage(null);
    setDeleteError(null);
    try {
      setGoalUsage(await getGoalUsage(goal.id));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not check what this goal holds");
    }
  };

  // Cascade is sent only when the preview actually found milestones. If
  // something was added in between, the API refuses and the dialog re-reads
  // the count rather than silently taking more with it than shown.
  const needsCascade = (goalUsage?.milestone_count ?? 0) > 0;

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteGoal(pendingDelete.id, needsCascade);
      const wasViewingDeletedGoal = goalId === pendingDelete.id;
      setPendingDelete(null);
      reloadAll();
      if (wasViewingDeletedGoal) router.push("/goals");
    } catch (err) {
      const blocked = asDeletionBlocked(err);
      setDeleteError(err instanceof Error ? err.message : "Failed to delete goal");
      if (blocked) getGoalUsage(pendingDelete.id).then(setGoalUsage).catch(() => {});
    }
  };

  return (
    <div className="space-y-6">
      <ContextHeader
        title={title ?? "All Goals"}
        meta={goalId === undefined && goals.length > 0 ? `${goals.length} goals` : undefined}
      />

      {visibleGoals.length === 0 ? (
        <Card>
          <CardContent className="text-center text-sm text-slate-500 p-4">No goals yet.</CardContent>
        </Card>
      ) : (
        visibleGoals.map(goal => (
          <Card key={goal.id}>
            <CardHeader className="flex flex-row justify-between items-center">
              {editingId === goal.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="max-w-xs"
                    autoFocus
                  />
                  <Button type="button" size="sm" onClick={saveEdit}>
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                    <X className="w-4 h-4" />
                  </Button>
                  {editError && <span className="text-xs text-destructive">{editError}</span>}
                </div>
              ) : (
                <>
                  <CardTitle>{goal.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={goal.progress_pct === 100 ? "text-green-600 bg-green-50" : undefined}
                    >
                      {goal.completed_milestone_count}/{goal.milestone_count} milestones
                    </Badge>
                    {canManage && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Rename ${goal.title}`}
                          title="Rename goal"
                          onClick={() => startEdit(goal)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          aria-label={`Delete ${goal.title}`}
                          title="Delete goal"
                          onClick={() => startDelete(goal)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </CardHeader>
            <CardContent>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${goal.progress_pct}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">{goal.progress_pct}% complete</div>

              <div className="mt-4 space-y-3 pl-3 border-l-2 border-slate-200 dark:border-slate-800">
                {goal.milestones.map((milestone: any) => (
                  <div key={milestone.id}>
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div className="flex items-center gap-2">
                        {milestone.progress_pct === 100 ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-400" />
                        )}
                        <span className="font-medium">{milestone.title}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={milestone.progress_pct === 100 ? "text-green-600 bg-green-50" : undefined}
                      >
                        {milestone.task_count === 0 && milestone.progress_pct !== 100
                          ? "No tasks yet"
                          : milestone.progress_pct === 100
                            ? "Completed"
                            : `${milestone.completed_task_count}/${milestone.task_count} tasks`}
                      </Badge>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mt-1">
                      <div
                        className={`h-full rounded-full ${milestone.progress_pct === 100 ? "bg-green-500" : "bg-blue-500"}`}
                        style={{ width: `${milestone.progress_pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.title ?? "goal"}?`}
        description="This cannot be undone."
        confirmLabel="Delete goal"
        destructive
        confirmDisabled={goalUsage === null}
        error={deleteError}
        onConfirm={confirmDelete}
      >
        {goalUsage === null ? (
          <div className="text-sm text-muted-foreground">Checking what this goal holds…</div>
        ) : goalUsage.milestone_count === 0 ? (
          <div className="text-sm text-muted-foreground">This goal has no milestones.</div>
        ) : (
          <div className="rounded border bg-muted/40 p-3 text-sm space-y-2">
            <div>
              <span className="font-medium">
                {goalUsage.milestone_count}{" "}
                {goalUsage.milestone_count === 1 ? "milestone" : "milestones"} will be deleted
              </span>{" "}
              <span className="text-muted-foreground">
                ({goalUsage.completed_milestone_count} completed,{" "}
                {goalUsage.milestone_count - goalUsage.completed_milestone_count} pending).
              </span>
            </div>
            {goalUsage.task_count > 0 && (
              <div className="text-muted-foreground">
                The {goalUsage.task_count} {goalUsage.task_count === 1 ? "task" : "tasks"} underneath{" "}
                {goalUsage.task_count === 1 ? "is" : "are"} kept and simply unlinked — points already
                earned stay on the leaderboard.
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
