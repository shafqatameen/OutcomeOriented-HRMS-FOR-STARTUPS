"use client";
import { useEffect, useRef, useState } from "react";
import {
  getTasks,
  completeTask,
  getUsers,
  getCategories,
  getGoals,
  getMilestones,
  getOrgTree,
  reorderTasks,
  moveTask,
  updateTask,
  deleteTask,
  asDeletionBlocked,
  type TaskUpdate,
} from "@/lib/api";
import type { OrgPillar } from "@/lib/panel";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import ContextHeader from "@/components/ContextHeader";
import ConfirmDialog from "@/components/ConfirmDialog";
import SortableTaskList, { TaskRow, type SortableTask } from "@/components/SortableTaskList";
import TaskEditDialog from "@/components/TaskEditDialog";
import TaskHistory, { type FilterGoal, type FilterMilestone } from "@/components/TaskHistory";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { ListTodo, Flame, Tag, type LucideIcon } from "lucide-react";

type Task = SortableTask & {
  category_id: number | null;
  milestone_id: number | null;
  /** The domain tag. Null until someone tags it; see app.modules.org. */
  function_id: number | null;
  points: number | null;
};

type Category = { id: number; name: string; default_points: number };

/** Which slice of the board this route shows. */
export type TasksView =
  | { kind: "all" }
  | { kind: "category"; categoryId: number; categoryName: string }
  | { kind: "history" };

const isCompleted = (task: Task) => task.status === "Completed";
const isPending = (task: Task) => !isCompleted(task);

/**
 * Nothing stops a task title being a paragraph long, and the confirmation
 * heading is not where anyone reads one — the row it came from is still on the
 * board behind the dialog.
 */
const clampTitle = (title: string, max = 60) =>
  title.length > max ? `${title.slice(0, max).trimEnd()}…` : title;

const UNCATEGORIZED = "uncategorized";
const containerIdFor = (categoryId: number | null) =>
  categoryId === null ? UNCATEGORIZED : `category-${categoryId}`;
const categoryIdFromContainer = (containerId: string) =>
  containerId === UNCATEGORIZED ? null : Number(containerId.replace("category-", ""));

/**
 * Presentational only. Keeps the established glyphs for the two original
 * categories and falls back to a neutral one for any category added later, so
 * the board never depends on a category being named a particular thing.
 */
const CATEGORY_GLYPHS: Record<string, { icon: LucideIcon; className: string }> = {
  // The glyph distinguishes the column by shape, not by colour. `text-orange-500`
  // here put a second orange on screen competing with the primary action, and
  // `text-blue-500` pulled a cool hue into a warm palette.
  Adjacent: { icon: ListTodo, className: "w-5 h-5 text-muted-foreground" },
  Core: { icon: Flame, className: "w-5 h-5 text-muted-foreground" },
};
const FALLBACK_GLYPH = { icon: Tag, className: "w-5 h-5 text-muted-foreground" };

/**
 * Rewrites only the slots held by one column, leaving every other task where it
 * is. Mirrors what PATCH /tasks/reorder does on the server, so the optimistic
 * order matches what comes back on the next load.
 */
function reorderWithinColumn(
  all: Task[],
  orderedIds: number[],
  belongsToColumn: (task: Task) => boolean,
): Task[] {
  const columnCount = all.filter(belongsToColumn).length;
  if (columnCount !== orderedIds.length) return all;

  const byId = new Map(all.map((task) => [task.id, task]));
  const queue = [...orderedIds];

  return all.map((task) => {
    if (!belongsToColumn(task)) return task;
    const nextId = queue.shift();
    return nextId === undefined ? task : (byId.get(nextId) ?? task);
  });
}

export default function TasksClient({
  view = { kind: "all" },
  canManage = false,
}: {
  view?: TasksView;
  /** `admin.tasks`. Hiding the controls is convenience — the API enforces it too. */
  canManage?: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<{ id: number; name: string; is_active?: boolean }[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [goals, setGoals] = useState<FilterGoal[]>([]);
  const [milestones, setMilestones] = useState<FilterMilestone[]>([]);
  const [pillars, setPillars] = useState<OrgPillar[]>([]);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadTasks = () => {
    getTasks().then(setTasks).catch(console.error);
  };

  useEffect(() => {
    loadTasks();
    getUsers().then(setUsers).catch(console.error);
    getCategories().then(setCategories).catch(console.error);
    // Needed for the history filters: milestones carry the goal linkage.
    getGoals().then(setGoals).catch(console.error);
    getMilestones().then(setMilestones).catch(console.error);
    // Feeds the edit dialog's function tag. Readable by anyone signed in.
    getOrgTree().then(setPillars).catch(console.error);
  }, []);

  const getUserName = (userId: number) => {
    const user = users.find((u) => u.id === userId);
    return user ? user.name.toUpperCase() : "Unknown";
  };

  /** What a task is worth right now: its own value if pinned, else its category's. */
  const pointsOf = (task: Task) =>
    task.points ?? categories.find((c) => c.id === task.category_id)?.default_points ?? 0;

  // Rows only carry the sortable fields, so the full task has to be found first.
  const getTaskPoints = (task: SortableTask) => {
    const full = tasks.find((t) => t.id === task.id);
    return full ? pointsOf(full) : 0;
  };

  const handleComplete = async (taskId: number) => {
    try {
      await completeTask(taskId);
      loadTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const editingTask = tasks.find((task) => task.id === editingId) ?? null;

  /** Rejections are left to propagate: the dialog shows them and stays open. */
  const handleSaveEdit = async (taskId: number, patch: TaskUpdate) => {
    await updateTask(taskId, patch);
    setEditingId(null);
    loadTasks();
  };

  const startDelete = (taskId: number) => {
    setDeleteError(null);
    setPendingDelete(tasks.find((task) => task.id === taskId) ?? null);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteTask(pendingDelete.id);
      setPendingDelete(null);
      loadTasks();
    } catch (e) {
      // A 409 here means somebody completed it while the dialog was open, so
      // the board is refreshed to show it has moved to the history.
      if (asDeletionBlocked(e)) loadTasks();
      setDeleteError(e instanceof Error ? e.message : "Could not delete the task");
    }
  };

  const sensors = useSensors(
    // A small movement threshold keeps a plain click on the handle from
    // registering as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Snapshot taken at drag start, so a rejected drop can be put back exactly.
  const dragSnapshot = useRef<{ tasks: Task[]; container: string } | null>(null);

  /** Which column a task currently sits in, treating unknown categories as orphans. */
  const containerOfTask = (task: Task) =>
    containerIdFor(categories.some((c) => c.id === task.category_id) ? task.category_id : null);

  /** dnd-kit ids are either a task id (number) or a container id (string). */
  const containerOfDragId = (dragId: string | number, source: Task[]): string | undefined => {
    if (typeof dragId === "string") return dragId;
    const task = source.find((t) => t.id === dragId);
    return task ? containerOfTask(task) : undefined;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const task = tasks.find((t) => t.id === Number(active.id)) ?? null;
    setActiveTask(task);
    setReorderError(null);
    if (task) dragSnapshot.current = { tasks, container: containerOfTask(task) };
  };

  /** Reassigns the category as you drag across, so the row lands in the hovered column. */
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = containerOfDragId(active.id, tasks);
    const to = containerOfDragId(over.id, tasks);
    if (!from || !to || from === to) return;

    const targetCategoryId = categoryIdFromContainer(to);
    setTasks((current) =>
      current.map((task) =>
        task.id === Number(active.id) ? { ...task, category_id: targetCategoryId } : task,
      ),
    );
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    const snapshot = dragSnapshot.current;
    setActiveTask(null);
    dragSnapshot.current = null;
    if (!snapshot) return;

    const taskId = Number(active.id);
    const revert = (message: string) => {
      setTasks(snapshot.tasks);
      setReorderError(message);
    };

    // Dropped outside any column: put it back rather than guessing.
    if (!over) {
      setTasks(snapshot.tasks);
      return;
    }

    const target = containerOfDragId(over.id, tasks);
    if (!target) {
      setTasks(snapshot.tasks);
      return;
    }
    if (target === UNCATEGORIZED && snapshot.container !== UNCATEGORIZED) {
      revert("Tasks cannot be moved into Uncategorized");
      return;
    }

    // Order within the destination, which dragOver has already moved us into.
    const inTarget = tasks.filter((t) => isPending(t) && containerOfTask(t) === target);
    const ids = inTarget.map((t) => t.id);
    const from = ids.indexOf(taskId);
    const overIndex = ids.indexOf(Number(over.id));
    const orderedIds = from === -1 ? ids : arrayMove(ids, from, overIndex === -1 ? ids.length - 1 : overIndex);

    const belongsToTarget = (task: Task) => isPending(task) && containerOfTask(task) === target;
    setTasks((current) => reorderWithinColumn(current, orderedIds, belongsToTarget));

    const crossedCategory = snapshot.container !== target;
    const targetCategoryId = categoryIdFromContainer(target);

    try {
      if (crossedCategory && targetCategoryId !== null) {
        await moveTask(taskId, targetCategoryId, orderedIds);
        // Points derive from the category unless pinned, so refetch to show the
        // value the server now considers authoritative.
        loadTasks();
      } else if (orderedIds.length > 0) {
        await reorderTasks(orderedIds);
      }
    } catch (e) {
      console.error(e);
      revert(e instanceof Error ? e.message : "Could not save the change");
    }
  };

  // One column per category, so a category added in Admin gets a column instead
  // of having its tasks silently absorbed by another one.
  const allColumns = categories.map((category) => ({
    key: containerIdFor(category.id),
    title: category.name,
    meta: `${category.default_points}p default`,
    glyph: CATEGORY_GLYPHS[category.name] ?? FALLBACK_GLYPH,
    belongs: (task: Task) => isPending(task) && task.category_id === category.id,
  }));

  // category_id is nullable, so a task pointing at nothing still has to appear
  // somewhere rather than vanishing off the board.
  const isOrphan = (task: Task) =>
    isPending(task) && !categories.some((c) => c.id === task.category_id);
  if (tasks.some(isOrphan)) {
    allColumns.push({
      key: UNCATEGORIZED,
      title: "Uncategorized",
      meta: "no category set",
      glyph: FALLBACK_GLYPH,
      belongs: isOrphan,
    });
  }

  const columns =
    view.kind === "category"
      ? allColumns.filter((c) => c.key === containerIdFor(view.categoryId))
      : allColumns;

  const heading =
    view.kind === "category" ? view.categoryName : view.kind === "history" ? "Task History" : "All Tasks";

  const showBoard = view.kind !== "history";
  const showHistory = view.kind !== "category";
  const completed = tasks.filter(isCompleted);

  return (
    <div className="space-y-6">
      <ContextHeader
        title={heading}
        meta={view.kind === "category" ? `${columns[0]?.meta ?? ""}` : undefined}
      />

      {reorderError && (
        <div className="rounded border border-destructive/50 p-3 text-sm wrap-anywhere text-destructive">
          {reorderError}. The list has been put back the way it was.
        </div>
      )}

      {showBoard && (
      // One context across every column, so a task can be dragged between them.
      // closestCorners reads better than closestCenter for multi-column boards.
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          if (dragSnapshot.current) setTasks(dragSnapshot.current.tasks);
          dragSnapshot.current = null;
          setActiveTask(null);
        }}
      >
        <div
          className={cn(
            "grid gap-4",
            // A single category gets the full column instead of a third of it.
            view.kind === "category" ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-3",
          )}
        >
          {columns.map((column) => {
            const Glyph = column.glyph.icon;
            const columnTasks = tasks.filter(column.belongs);
            return (
              <Card key={column.key}>
                <CardHeader className="flex flex-row items-center gap-2">
                  <Glyph className={column.glyph.className} />
                  <CardTitle>{column.title.trim()}</CardTitle>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {columnTasks.length} · {column.meta}
                  </span>
                </CardHeader>
                <CardContent>
                  <SortableTaskList
                    containerId={column.key}
                    tasks={columnTasks}
                    getPoints={getTaskPoints}
                    getAssignee={getUserName}
                    onComplete={handleComplete}
                    onEdit={canManage ? setEditingId : undefined}
                    onDelete={canManage ? startDelete : undefined}
                    emptyMessage="Nothing here yet. Drag a task in."
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Follows the cursor across column boundaries. */}
        <DragOverlay>
          {activeTask && (
            <TaskRow
              task={activeTask}
              points={getTaskPoints(activeTask)}
              assignee={getUserName(activeTask.user_id)}
              // Inert while dragging, but present so the card being carried is
              // the same shape as the row it was lifted out of.
              onComplete={() => {}}
              onEdit={canManage ? () => {} : undefined}
              onDelete={canManage ? () => {} : undefined}
              isOverlay
            />
          )}
        </DragOverlay>
      </DndContext>
      )}

      {showHistory && (
        <TaskHistory
          tasks={completed}
          categories={categories}
          users={users}
          goals={goals}
          milestones={milestones}
          getPoints={getTaskPoints}
          getAssignee={getUserName}
        />
      )}

      <TaskEditDialog
        // Remounts per row, which is what seeds the form with that task's values.
        key={editingId ?? "closed"}
        task={editingTask}
        users={users}
        goals={goals}
        milestones={milestones}
        pillars={pillars}
        inheritedPoints={
          categories.find((c) => c.id === editingTask?.category_id)?.default_points ?? 0
        }
        onClose={() => setEditingId(null)}
        onSave={handleSaveEdit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete ? clampTitle(pendingDelete.title) : "task"}?`}
        description="This cannot be undone."
        confirmLabel="Delete task"
        destructive
        error={deleteError}
        onConfirm={handleConfirmDelete}
      >
        {pendingDelete && (
          <div className="rounded border bg-muted/40 p-3 text-sm">
            <span className="font-medium">
              {getUserName(pendingDelete.user_id)} loses this {pointsOf(pendingDelete)}-point task.
            </span>{" "}
            <span className="text-muted-foreground">
              Nothing already earned changes — points only move when a task is completed, and a
              completed task cannot be deleted at all.
            </span>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
