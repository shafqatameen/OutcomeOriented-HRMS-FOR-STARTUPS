"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, CheckSquare, MessageSquare, Paperclip } from "lucide-react";
import type { BoardCard } from "@/lib/api";
import { checklistProgress, formatDue, isOverdue } from "@/lib/board";
import { cardDragId } from "@/components/board/ids";
import { cn } from "@/lib/utils";

type CardFaceProps = {
  card: BoardCard;
  onOpen: (cardId: number) => void;
  /** False for a viewer, which makes the face a link to its detail and nothing more. */
  draggable?: boolean;
  /** Rendered inside DragOverlay, where sortable transforms must not apply. */
  isOverlay?: boolean;
};

/**
 * One card as it appears in a list.
 *
 * The whole face is the drag handle rather than a grip in the corner, because a
 * Kanban card is the thing being moved and hunting for a 16px handle is the main
 * way board drag-and-drop feels bad. Clicks still open the detail panel: the
 * PointerSensor is configured with a small activation distance in the parent, so
 * a press that never travels is a click and one that travels is a drag.
 */
export default function CardFace({ card, onOpen, draggable = true, isOverlay = false }: CardFaceProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardDragId(card.id),
    disabled: isOverlay || !draggable,
  });

  const progress = checklistProgress(card);
  const overdue = isOverdue(card);
  const done = Boolean(card.completed_at);

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : { transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group rounded-sm border border-border bg-card text-left shadow-xs",
        !isOverlay && isDragging && "opacity-40",
        isOverlay && "rotate-1 shadow-lg",
        draggable && "touch-none",
      )}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
    >
      {/* Colour strips, above the title exactly as on the reference board: a
          label is read as a stripe at a glance and only as a name on inspection,
          so the name lives in the detail panel and the stripe lives here. */}
      {card.labels.length > 0 && (
        <div className="flex gap-1 px-2 pt-2">
          {card.labels.map((label) => (
            <span
              key={label.id}
              title={label.name ?? undefined}
              aria-label={label.name ? `Label ${label.name}` : "Label"}
              className="h-1.5 w-8 rounded-full"
              style={{ backgroundColor: label.color }}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpen(card.id)}
        className="w-full cursor-pointer px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            "block text-sm wrap-break-word",
            done && "text-muted-foreground line-through",
          )}
        >
          {card.title}
        </span>

        {(card.due_at || progress || card.comment_count > 0 || card.description || card.assignees.length > 0) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {card.due_at && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm px-1",
                  // Overdue is the one thing a card face is allowed to shout
                  // about, and it shouts in the destructive hue rather than the
                  // primary one, which DESIGN.md reserves for actions.
                  overdue && "bg-destructive/10 text-destructive",
                  done && "text-success",
                )}
              >
                <CalendarClock className="h-3 w-3" />
                {formatDue(card.due_at)}
              </span>
            )}
            {progress && (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  progress.done === progress.total && "text-success",
                )}
              >
                <CheckSquare className="h-3 w-3" />
                {progress.done}/{progress.total}
              </span>
            )}
            {card.description && (
              <span className="inline-flex items-center" title="Has a description">
                <Paperclip className="h-3 w-3" />
              </span>
            )}
            {card.comment_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {card.comment_count}
              </span>
            )}
            {card.assignees.map((assignee) => (
              <span
                key={assignee.user_id}
                title={assignee.user_name ?? undefined}
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-secondary px-1 text-[10px] font-semibold text-secondary-foreground"
              >
                {(assignee.user_name ?? "?").slice(0, 2)}
              </span>
            ))}
          </span>
        )}
      </button>
    </div>
  );
}
