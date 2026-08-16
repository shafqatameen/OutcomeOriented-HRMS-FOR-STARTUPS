"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  Check,
  Loader2,
  MessageSquare,
  Plus,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import {
  addCardComment,
  addChecklistItem,
  createCardLabel,
  deleteCardComment,
  deleteChecklistItem,
  getCard,
  updateCard,
  updateChecklistItem,
  type BoardCardDetail,
  type BoardView,
  type CardLabel,
} from "@/lib/api";
import { canWrite, fromInputValue, parseIst, toInputValue } from "@/lib/board";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Colours offered when adding a label. A starting palette, not a limit — the
 *  API takes any hex, and the reference board uses colour as a private code. */
const LABEL_COLORS = ["#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#3b82f6", "#64748b"];

type CardDialogProps = {
  /** null keeps it closed. Key the element on the id so a different card remounts. */
  cardId: number | null;
  board: BoardView;
  currentUserId: number | null;
  onClose: () => void;
  /** Called with the saved card so the board behind the dialog stays in step. */
  onSaved: (card: BoardCardDetail) => void;
  onDeleted: (cardId: number, trashed: boolean) => void;
  /** Sends the card to Trash, or deletes it outright if it is already there. */
  onRequestDelete: (cardId: number) => Promise<{ trashed: boolean }>;
  /** A label belongs to the board, not the card, so the parent owns the list. */
  onLabelAdded: (label: CardLabel) => void;
};

function Section({
  label,
  glyph: Glyph,
  children,
}: {
  label: string;
  glyph: typeof Tag;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-muted-foreground">
        <Glyph className="h-3.5 w-3.5" />
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * One card, in full: what it is, when it is due, what it is broken into, and
 * what has been said about it.
 *
 * Fields split by how sure the gesture is. Title, description and dates are
 * typed, so they wait for Save — otherwise a half-typed date would be persisted
 * and a stray keystroke would move an appointment. Ticking a checklist item,
 * toggling a label or posting a comment are already decisions when they happen,
 * so they save immediately and return the whole card, which is what keeps the
 * "0/1" badge on the face from drifting away from the panel.
 */
export default function CardDialog({
  cardId,
  board,
  currentUserId,
  onClose,
  onSaved,
  onDeleted,
  onRequestDelete,
  onLabelAdded,
}: CardDialogProps) {
  const [card, setCard] = useState<BoardCardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");

  const writable = canWrite(board);
  const list = board.lists.find((candidate) => candidate.id === card?.list_id);

  /** Loads the card and re-seeds the typed fields from it. */
  const seed = (loaded: BoardCardDetail) => {
    setCard(loaded);
    setTitle(loaded.title);
    setDescription(loaded.description ?? "");
    setStartAt(toInputValue(loaded.start_at));
    setDueAt(toInputValue(loaded.due_at));
  };

  /**
   * Takes the server's new copy of the card but leaves the typed fields alone.
   *
   * Used by every save-immediately action, and the distinction matters: ticking a
   * checklist item returns the whole card, and re-seeding from it would throw
   * away a due date the user had typed but not yet saved. Those fields belong to
   * whoever is typing until they press Save.
   */
  const absorb = (loaded: BoardCardDetail) => setCard(loaded);

  useEffect(() => {
    if (cardId === null) return;
    let live = true;
    getCard(cardId)
      .then((loaded) => {
        if (live) seed(loaded);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Could not load that card");
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  if (cardId === null) return null;

  /**
   * Runs one mutation, keeps the panel and the board in step, reports failure.
   * Returns whether it worked, so a caller can leave a composer's text alone
   * when it did not — losing what somebody just typed is the one failure mode
   * worse than the failure itself.
   */
  const run = async (
    action: () => Promise<BoardCardDetail>,
    take: (loaded: BoardCardDetail) => void = absorb,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      take(updated);
      onSaved(updated);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveTyped = () => {
    if (!card) return;
    const cleaned = title.trim();
    if (!cleaned) {
      setError("A card needs a title");
      return;
    }
    // Seeds rather than absorbs on the way back: Save is the one action whose
    // whole job is to settle the typed fields against what was actually stored.
    return run(
      () =>
        updateCard(card.id, {
          title: cleaned,
          description: description.trim() ? description : null,
          start_at: fromInputValue(startAt),
          due_at: fromInputValue(dueAt),
        }),
      seed,
    );
  };

  const toggleLabel = (labelId: number) => {
    if (!card) return;
    const current = card.labels.map((label) => label.id);
    const next = current.includes(labelId)
      ? current.filter((id) => id !== labelId)
      : [...current, labelId];
    return run(() => updateCard(card.id, { label_ids: next }));
  };

  const addLabel = async (color: string) => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const label = await createCardLabel(board.id, { color });
      const updated = await updateCard(card.id, {
        label_ids: [...card.labels.map((existing) => existing.id), label.id],
      });
      absorb(updated);
      onSaved(updated);
      // The board owns the label list, so the parent has to hear about a new one
      // or the swatch vanishes on the next render.
      onLabelAdded(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that label");
    } finally {
      setBusy(false);
    }
  };

  const toggleAssignee = (userId: number) => {
    if (!card) return;
    const current = card.assignees.map((assignee) => assignee.user_id);
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    return run(() => updateCard(card.id, { assignee_ids: next }));
  };

  const remove = async () => {
    if (!card) return;
    setBusy(true);
    try {
      const { trashed } = await onRequestDelete(card.id);
      onDeleted(card.id, trashed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that card");
      setBusy(false);
    }
  };

  const dirty =
    card !== null &&
    (title !== card.title ||
      description !== (card.description ?? "") ||
      startAt !== toInputValue(card.start_at) ||
      dueAt !== toInputValue(card.due_at));

  const assignable = board.board_type === "team" ? board.members : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8">
            {card ? (
              writable ? (
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="Card title"
                  className="h-8 text-base font-semibold"
                />
              ) : (
                card.title
              )
            ) : (
              "Loading…"
            )}
          </DialogTitle>
          <DialogDescription>
            {list ? `In ${list.name}` : ""}
            {card?.completed_at ? " · Done" : ""}
            {card && card.source !== "manual" ? ` · from ${card.source.replace("_", " ")}` : ""}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {card === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the card…
          </p>
        ) : (
          <div className="space-y-4">
            {writable && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={card.completed_at ? "outline" : "secondary"}
                  onClick={() => run(() => updateCard(card.id, { is_complete: !card.completed_at }))}
                  disabled={busy}
                >
                  <Check className="h-4 w-4" />
                  {card.completed_at ? "Mark not done" : "Mark done"}
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={remove} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                  {list?.role === "trash" ? "Delete for good" : "Move to Trash"}
                </Button>
                {/* Completion here is the card's own done-ness. It writes no
                    ledger row and awards no points — those belong to the task
                    board, and a checkbox that quietly moved the leaderboard
                    would make both numbers untrustworthy. */}
              </div>
            )}

            <Section label="Description" glyph={MessageSquare}>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                readOnly={!writable}
                rows={3}
                placeholder="Notes, links, whatever the card needs. Markdown welcome."
                aria-label="Description"
                className="w-full resize-y rounded-sm border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </Section>

            <Section label="Dates" glyph={CalendarClock}>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Starts</span>
                  <Input
                    type="datetime-local"
                    value={startAt}
                    onChange={(event) => setStartAt(event.target.value)}
                    readOnly={!writable}
                    className="h-8 w-52"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Due</span>
                  <Input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                    readOnly={!writable}
                    className="h-8 w-52"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A due date puts the card on the Planner grid. Times are IST, the
                same clock the rest of the app reports in.
              </p>
            </Section>

            <Section label="Labels" glyph={Tag}>
              <div className="flex flex-wrap items-center gap-1.5">
                {board.labels.map((label) => {
                  const on = card.labels.some((applied) => applied.id === label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => writable && toggleLabel(label.id)}
                      disabled={!writable || busy}
                      aria-pressed={on}
                      className={cn(
                        "flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]",
                        on ? "border-ring" : "border-border opacity-60",
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                      {label.name ?? "Label"}
                      {on && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
                {writable &&
                  LABEL_COLORS.filter(
                    (color) => !board.labels.some((label) => label.color === color),
                  ).map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => addLabel(color)}
                      disabled={busy}
                      aria-label={`Add a new ${color} label`}
                      title="Add this colour to the board"
                      className="h-4 w-4 rounded-full border border-border opacity-50 hover:opacity-100"
                      style={{ backgroundColor: color }}
                    />
                  ))}
              </div>
            </Section>

            {assignable.length > 0 && (
              <Section label="Assignees" glyph={Users}>
                <div className="flex flex-wrap gap-1.5">
                  {assignable.map((member) => {
                    const on = card.assignees.some((assignee) => assignee.user_id === member.user_id);
                    return (
                      <button
                        key={member.user_id}
                        type="button"
                        onClick={() => writable && toggleAssignee(member.user_id)}
                        disabled={!writable || busy}
                        aria-pressed={on}
                        className={cn(
                          "rounded-sm border px-1.5 py-0.5 text-[11px]",
                          on ? "border-ring" : "border-border opacity-60",
                        )}
                      >
                        {member.user_name ?? `#${member.user_id}`}
                      </button>
                    );
                  })}
                </div>
              </Section>
            )}

            <Section label="Checklist" glyph={Check}>
              <div className="space-y-1">
                {card.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.is_done}
                      disabled={!writable || busy}
                      onChange={() =>
                        run(() => updateChecklistItem(item.id, { is_done: !item.is_done }))
                      }
                      aria-label={item.text}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span className={cn("flex-1 text-sm", item.is_done && "text-muted-foreground line-through")}>
                      {item.text}
                    </span>
                    {writable && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => run(() => deleteChecklistItem(item.id))}
                        disabled={busy}
                        aria-label={`Remove ${item.text}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
                {writable && (
                  <div className="flex items-center gap-1">
                    <Input
                      value={newItem}
                      onChange={(event) => setNewItem(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && newItem.trim()) {
                          event.preventDefault();
                          run(() => addChecklistItem(card.id, newItem.trim())).then(
                            (saved) => saved && setNewItem(""),
                          );
                        }
                      }}
                      placeholder="Add an item"
                      aria-label="New checklist item"
                      className="h-7"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={!newItem.trim() || busy}
                      onClick={() =>
                        run(() => addChecklistItem(card.id, newItem.trim())).then(
                          (saved) => saved && setNewItem(""),
                        )
                      }
                      aria-label="Add checklist item"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </Section>

            <Section label="Comments" glyph={MessageSquare}>
              <div className="space-y-2">
                {card.comments.map((entry) => (
                  <div key={entry.id} className="rounded-sm border border-border px-2 py-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      {entry.user_name ?? "Someone"} ·{" "}
                      {parseIst(entry.created_at).toLocaleString("en-GB", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                    <p className="text-sm wrap-break-word">{entry.text}</p>
                    {writable && entry.user_id === currentUserId && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="mt-1 text-destructive"
                        onClick={() => run(() => deleteCardComment(entry.id))}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                ))}
                {writable && (
                  <div className="flex items-start gap-1">
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={2}
                      placeholder="Add a comment"
                      aria-label="New comment"
                      className="w-full resize-none rounded-sm border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!comment.trim() || busy}
                      onClick={() =>
                        run(() => addCardComment(card.id, comment.trim())).then(
                          (saved) => saved && setComment(""),
                        )
                      }
                    >
                      Post
                    </Button>
                  </div>
                )}
              </div>
            </Section>
          </div>
        )}

        {/* Not a DialogFooter: the typed fields are the only thing here that
            waits, and the button belongs next to them rather than parked under
            the comments where it would look like it posts one. */}
        {card !== null && writable && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-popover pt-3">
            {dirty && <span className="mr-auto text-[11px] text-muted-foreground">Unsaved changes</span>}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" onClick={saveTyped} disabled={!dirty || busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
