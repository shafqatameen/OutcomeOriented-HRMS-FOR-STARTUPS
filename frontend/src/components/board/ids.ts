/**
 * Drag ids for the board.
 *
 * dnd-kit keeps every draggable and every droppable in one string namespace, and
 * the board puts three kinds of thing in it: cards, the lists they sit in, and
 * the empty space inside a list that still has to accept a drop. Prefixing keeps
 * them apart, and gives `resolveDragId` one place to answer "what was I just
 * dropped on?" — which is the question the whole drag handler turns on.
 *
 * A list is both draggable (by its header, to reorder columns) and a drop target,
 * so its two roles need different ids: `list:` for the column itself and `zone:`
 * for the region cards land in. Reusing one id would make dnd-kit treat the
 * column as its own drop target and the reorder would fight the card move.
 */
export type DragTarget =
  | { kind: "card"; id: number }
  | { kind: "list"; id: number }
  | { kind: "zone"; id: number };

export const cardDragId = (cardId: number) => `card:${cardId}`;
export const listDragId = (listId: number) => `list:${listId}`;
export const zoneDragId = (listId: number) => `zone:${listId}`;

export function resolveDragId(id: string | number | null | undefined): DragTarget | null {
  if (id === null || id === undefined) return null;
  const [kind, raw] = String(id).split(":");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  if (kind === "card" || kind === "list" || kind === "zone") return { kind, id: numeric };
  return null;
}
