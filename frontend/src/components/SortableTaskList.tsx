"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, GripVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SortableTask = {
  id: number;
  title: string;
  user_id: number;
  is_recurring: boolean;
  status: string;
};

type TaskRowProps = {
  task: SortableTask;
  points: number;
  assignee: string;
  onComplete: (taskId: number) => void;
  /** Omitted for accounts without `admin.tasks`, which hides the control entirely. */
  onEdit?: (taskId: number) => void;
  onDelete?: (taskId: number) => void;
  /** Rendered inside DragOverlay, where sortable transforms must not apply. */
  isOverlay?: boolean;
};

export function TaskRow({
  task,
  points,
  assignee,
  onComplete,
  onEdit,
  onDelete,
  isOverlay = false,
}: TaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: isOverlay });

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : { transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // Wraps rather than squeezing: below roughly 15rem of row width the
        // actions drop onto their own line instead of crushing the title.
        "flex flex-wrap items-center gap-2 rounded border bg-card p-3",
        // The overlay is the thing following the cursor, so the original row
        // fades in place rather than disappearing.
        !isOverlay && isDragging && "opacity-40",
        isOverlay && "shadow-lg",
      )}
    >
      {/* Only the handle carries the drag listeners, so Complete stays clickable.
          touch-none is required or the browser scrolls instead of dragging. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder or move ${task.title}`}
        className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1 basis-32">
        <div className="font-semibold wrap-break-word">
          {task.title}
          <span className="ml-1 text-sm font-normal text-muted-foreground">({points}p)</span>
          {/* Recurrence is no longer the grouping axis, so surface it per row. */}
          {task.is_recurring && (
            <span className="ml-2 rounded border px-1.5 py-0.5 align-middle text-[11px] font-normal uppercase text-muted-foreground">
              Daily
            </span>
          )}
        </div>
        <div className="text-sm text-muted-foreground">Assigned to: {assignee}</div>
      </div>

      {/* Stacked, not strung out along the row: three controls side by side left
          the title a few characters wide in a three-column board. Complete keeps
          the top line — it is the action almost every row is here for. */}
      <div className="ml-auto flex shrink-0 flex-col gap-2">
        <Button onClick={() => onComplete(task.id)} className="w-full gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Complete
        </Button>
        {(onEdit || onDelete) && (
          // Icon-only, following the goals admin rows, and split across
          // Complete's width so the block stays one tidy rectangle.
          <div className="flex gap-2">
            {onEdit && (
              <Button
                variant="outline"
                size="icon"
                className="flex-1"
                aria-label={`Edit ${task.title}`}
                title="Edit task"
                onClick={() => onEdit(task.id)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="destructive"
                size="icon"
                className="flex-1"
                aria-label={`Delete ${task.title}`}
                title="Delete task"
                onClick={() => onDelete(task.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type SortableTaskListProps = {
  /** Droppable container id, e.g. "category-2". Lets an empty column accept a drop. */
  containerId: string;
  tasks: SortableTask[];
  getPoints: (task: SortableTask) => number;
  getAssignee: (userId: number) => string;
  onComplete: (taskId: number) => void;
  onEdit?: (taskId: number) => void;
  onDelete?: (taskId: number) => void;
  emptyMessage: string;
};

/**
 * One column of the board. The DndContext lives above this, in TasksClient, so a
 * task can be dragged from one column into another.
 */
export default function SortableTaskList({
  containerId,
  tasks,
  getPoints,
  getAssignee,
  onComplete,
  onEdit,
  onDelete,
  emptyMessage,
}: SortableTaskListProps) {
  const { setNodeRef, isOver } = useDroppable({ id: containerId });

  return (
    <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-24 space-y-4 rounded transition-colors",
          isOver && "bg-secondary/60 outline-2 outline-dashed outline-border",
        )}
      >
        {tasks.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">{emptyMessage}</div>
        ) : (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              points={getPoints(task)}
              assignee={getAssignee(task.user_id)}
              onComplete={onComplete}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </SortableContext>
  );
}
