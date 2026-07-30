"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, GripVertical } from "lucide-react";
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
  /** Rendered inside DragOverlay, where sortable transforms must not apply. */
  isOverlay?: boolean;
};

export function TaskRow({ task, points, assignee, onComplete, isOverlay = false }: TaskRowProps) {
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
        "flex items-center gap-2 rounded border bg-card p-3",
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

      <div className="min-w-0 flex-1">
        <div className="font-semibold">
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

      <Button onClick={() => onComplete(task.id)} className="flex shrink-0 gap-2">
        <CheckCircle2 className="h-4 w-4" />
        Complete
      </Button>
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
            />
          ))
        )}
      </div>
    </SortableContext>
  );
}
