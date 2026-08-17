"use client";

import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, GripVertical, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { BoardListView, BoardView } from "@/lib/api";
import { canAdminister, canWrite } from "@/lib/board";
import CardFace from "@/components/board/CardFace";
import { cardDragId, listDragId, zoneDragId } from "@/components/board/ids";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type BoardPaneProps = {
  board: BoardView;
  /**
   * The columns to draw, which is not always all of them: the Inbox list is
   * rendered by the Inbox pane while that pane is open, and drawing it twice
   * would give dnd-kit two draggables sharing one id.
   */
  lists: BoardListView[];
  /**
   * A line to print under a column's header, by list id.
   *
   * Only the Calendar list uses one today, to say that it is showing the
   * Planner's days rather than everything it holds. A column whose cards have
   * been filtered has to admit it — otherwise an empty-looking Calendar reads as
   * lost cards, and the count in the header reads as a bug.
   */
  listNotes?: Record<number, string>;
  onOpenCard: (cardId: number) => void;
  onAddCard: (listId: number, title: string) => Promise<void>;
  onRenameList: (listId: number, name: string) => Promise<void>;
  onArchiveList: (listId: number) => Promise<void>;
  onDeleteList: (listId: number) => void;
  onAddList: (name: string) => Promise<void>;
};

/**
 * The Kanban surface: every visible list, left to right, each holding its cards.
 *
 * Horizontal scrolling is deliberate and lives here rather than on the page — a
 * board with twelve GTD lists cannot fit a laptop screen, and squeezing columns
 * to make it fit is how a card title becomes four words per line. The reference
 * board scrolls; so does this.
 */
export default function BoardPane({
  board,
  lists,
  listNotes,
  onOpenCard,
  onAddCard,
  onRenameList,
  onArchiveList,
  onDeleteList,
  onAddList,
}: BoardPaneProps) {
  const writable = canWrite(board);
  const administrable = canAdminister(board);

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-2">
      <SortableContext items={lists.map((list) => listDragId(list.id))}>
        {lists.map((list) => (
          <ListColumn
            key={list.id}
            list={list}
            note={listNotes?.[list.id]}
            writable={writable}
            administrable={administrable}
            onOpenCard={onOpenCard}
            onAddCard={onAddCard}
            onRenameList={onRenameList}
            onArchiveList={onArchiveList}
            onDeleteList={onDeleteList}
          />
        ))}
      </SortableContext>
      {administrable && <AddListColumn onAddList={onAddList} />}
    </div>
  );
}

function ListColumn({
  list,
  note,
  writable,
  administrable,
  onOpenCard,
  onAddCard,
  onRenameList,
  onArchiveList,
  onDeleteList,
}: {
  list: BoardListView;
  note?: string;
  writable: boolean;
  administrable: boolean;
} & Pick<BoardPaneProps, "onOpenCard" | "onAddCard" | "onRenameList" | "onArchiveList" | "onDeleteList">) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: listDragId(list.id), disabled: !administrable });
  // A separate droppable from the sortable above, so an empty column still
  // accepts a card. Without it there is no card to be "over" and the drop is
  // silently lost — which on a GTD board means every freshly seeded list.
  const { setNodeRef: setZoneRef, isOver } = useDroppable({ id: zoneDragId(list.id) });

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(list.name);
  const [adding, setAdding] = useState(false);
  const [draftCard, setDraftCard] = useState("");
  const [busy, setBusy] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (adding) composerRef.current?.focus();
  }, [adding]);

  const submitCard = async () => {
    const title = draftCard.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onAddCard(list.id, title);
      // Kept open with the box cleared: capture comes in bursts, and closing the
      // composer after every card would make the second one cost two clicks.
      setDraftCard("");
      composerRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const name = draftName.trim();
    setRenaming(false);
    if (!name || name === list.name) {
      setDraftName(list.name);
      return;
    }
    await onRenameList(list.id, name);
  };

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex max-h-full w-64 shrink-0 flex-col rounded-md border border-border bg-muted/40",
        isDragging && "opacity-50",
      )}
      aria-label={list.name}
    >
      <header className="flex items-center gap-1 px-2 pt-2 pb-1">
        {administrable && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Move list ${list.name}`}
            className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        {renaming ? (
          <Input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={submitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitRename();
              if (event.key === "Escape") {
                setDraftName(list.name);
                setRenaming(false);
              }
            }}
            className="h-6 px-1 py-0 text-xs font-semibold uppercase"
            aria-label={`Rename ${list.name}`}
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide">
            {list.name}
          </h2>
        )}

        <span className="shrink-0 text-xs text-muted-foreground">{list.cards.length}</span>

        {administrable && !renaming && (
          // <details> rather than a state-driven popover: it opens on click,
          // closes on Escape and is reachable by keyboard without this component
          // owning any of that behaviour.
          <details className="relative shrink-0 [&_summary::-webkit-details-marker]:hidden">
            <summary
              aria-label={`List actions for ${list.name}`}
              className="cursor-pointer list-none rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-border bg-popover p-1 shadow-md">
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" /> Rename
              </button>
              <button
                type="button"
                onClick={() => onArchiveList(list.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
              <button
                type="button"
                onClick={() => onDeleteList(list.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete list
              </button>
            </div>
          </details>
        )}
      </header>

      {note && <p className="px-2 pb-1 text-[10px] leading-tight text-muted-foreground">{note}</p>}

      <div
        ref={setZoneRef}
        className={cn(
          "min-h-8 flex-1 space-y-2 overflow-y-auto px-2 pb-2",
          isOver && "bg-primary/5",
        )}
      >
        <SortableContext
          items={list.cards.map((card) => cardDragId(card.id))}
          strategy={verticalListSortingStrategy}
        >
          {list.cards.map((card) => (
            <CardFace key={card.id} card={card} onOpen={onOpenCard} draggable={writable} />
          ))}
        </SortableContext>
      </div>

      {writable && (
        <footer className="px-2 pb-2">
          {adding ? (
            <div className="space-y-1">
              <textarea
                ref={composerRef}
                value={draftCard}
                onChange={(event) => setDraftCard(event.target.value)}
                onKeyDown={(event) => {
                  // Enter submits, Shift+Enter breaks the line. A card title is
                  // one line often enough that requiring a click would be worse.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitCard();
                  }
                  if (event.key === "Escape") {
                    setAdding(false);
                    setDraftCard("");
                  }
                }}
                rows={2}
                placeholder="What is it?"
                aria-label={`New card in ${list.name}`}
                className="w-full resize-none rounded-sm border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              />
              <div className="flex items-center gap-1">
                <Button size="sm" onClick={submitCard} disabled={!draftCard.trim() || busy}>
                  Add card
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setDraftCard("");
                  }}
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAdding(true)}
              className="w-full justify-start text-muted-foreground"
            >
              <Plus className="h-4 w-4" /> Add a card
            </Button>
          )}
        </footer>
      )}
    </section>
  );
}

function AddListColumn({ onAddList }: { onAddList: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const cleaned = name.trim();
    if (!cleaned || busy) return;
    setBusy(true);
    try {
      await onAddList(cleaned);
      setName("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-64 shrink-0">
      {open ? (
        <div className="space-y-1 rounded-md border border-border bg-muted/40 p-2">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="List name"
            aria-label="New list name"
            className="h-8"
          />
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={submit} disabled={!name.trim() || busy}>
              Add list
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Cancel">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setOpen(true)}
          className="w-full justify-start border border-dashed border-border text-muted-foreground"
        >
          <Plus className="h-4 w-4" /> Add another list
        </Button>
      )}
    </div>
  );
}
