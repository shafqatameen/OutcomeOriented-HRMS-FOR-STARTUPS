import type { BoardCard, BoardListView, BoardView } from "@/lib/api";

/**
 * Time on the board is IST wall-clock, with no offset attached.
 *
 * That is what the API stores — `get_ist_now()` in the backend writes naive
 * datetimes, and every other page in this app already reads them back by pinning
 * `+05:30` (see the inbox's `age`). The board inherits the convention rather than
 * inventing a per-user timezone, because a card and the ledger row it eventually
 * produces must not disagree about which day something happened on.
 *
 * The practical payoff is that `<input type="datetime-local">` needs no
 * conversion in either direction: the control speaks local wall-clock, the API
 * stores wall-clock, and the only work is trimming seconds.
 */
export const IST_OFFSET = "+05:30";

/** Parses an API datetime as IST. Without the pin, `Date` would read it as UTC. */
export const parseIst = (iso: string): Date =>
  new Date(/[Z+]|-\d\d:\d\d$/.test(iso) ? iso : `${iso}${IST_OFFSET}`);

/** `YYYY-MM-DD` for a moment, as seen in IST, whatever the browser's own zone is. */
export const istDay = (at: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

/** Minutes since IST midnight — where a card sits on the Planner's vertical axis. */
export const istMinutes = (at: Date): number => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  const [hour, minute] = parts.split(":").map(Number);
  return hour * 60 + minute;
};

/** Day offset from today, in IST days. `0` is today, `1` tomorrow. */
export const istDayOffset = (days: number): string => {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return istDay(at);
};

/** What the API wants: `YYYY-MM-DDTHH:mm:ss`, built from a wall-clock day. */
export const dayBoundary = (day: string, endOfDay = false): string =>
  `${day}T${endOfDay ? "23:59:59" : "00:00:00"}`;

/** An API datetime as a `datetime-local` value, or "" when there is none. */
export const toInputValue = (iso: string | null): string => (iso ? iso.slice(0, 16) : "");

/** A `datetime-local` value as an API datetime, or null when the field is empty. */
export const fromInputValue = (value: string): string | null =>
  value ? `${value}:00`.slice(0, 19) : null;

/** "Mon 17 Aug", in IST. The Planner's column heading. */
export const formatDayHeading = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(parseIst(`${day}T12:00:00`));

/** "2:30 pm", in IST. Short enough for a card face. */
export const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(parseIst(iso))
    .replace(/\s/g, "")
    .toLowerCase();

/** "17 Aug", or "17 Aug, 2:30pm" when the time carries information. */
export const formatDue = (iso: string): string => {
  const at = parseIst(iso);
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  }).format(at);
  const minutes = istMinutes(at);
  // Midnight is what a date-only card gets stored as, so printing "12:00am"
  // would invent a time nobody chose.
  return minutes === 0 ? date : `${date}, ${formatTime(iso)}`;
};

/** Whether a card's due date has passed and it is not done. The only nag on a face. */
export const isOverdue = (card: BoardCard): boolean =>
  Boolean(card.due_at) && !card.completed_at && parseIst(card.due_at as string) < new Date();

/** Done / total, or null when the card has no checklist to report on. */
export const checklistProgress = (card: BoardCard): { done: number; total: number } | null => {
  if (card.checklist.length === 0) return null;
  return { done: card.checklist.filter((item) => item.is_done).length, total: card.checklist.length };
};

export const findList = (board: BoardView, listId: number): BoardListView | undefined =>
  board.lists.find((list) => list.id === listId);

export const findCard = (board: BoardView, cardId: number): BoardCard | undefined => {
  for (const list of board.lists) {
    const card = list.cards.find((c) => c.id === cardId);
    if (card) return card;
  }
  return undefined;
};

export const listHolding = (board: BoardView, cardId: number): BoardListView | undefined =>
  board.lists.find((list) => list.cards.some((card) => card.id === cardId));

/**
 * The board with one card moved, without touching anything else.
 *
 * Used for the optimistic drag: dnd-kit needs the card to appear in its new
 * column while the pointer is still down, long before the server has agreed.
 * `toIndex` past the end clamps, exactly as the API's own clamp does, so the
 * optimistic order and the persisted order cannot disagree at the edges.
 */
export function moveCardLocal(
  board: BoardView,
  cardId: number,
  toListId: number,
  toIndex: number,
): BoardView {
  const card = findCard(board, cardId);
  if (!card) return board;

  const lists = board.lists.map((list) => ({
    ...list,
    cards: list.cards.filter((c) => c.id !== cardId),
  }));
  const target = lists.find((list) => list.id === toListId);
  if (!target) return board;

  const index = Math.max(0, Math.min(toIndex, target.cards.length));
  target.cards.splice(index, 0, { ...card, list_id: toListId });
  return { ...board, lists };
}

/** The board with one card's fields replaced — after an edit in the detail panel. */
export function replaceCardLocal(board: BoardView, updated: BoardCard): BoardView {
  return {
    ...board,
    lists: board.lists.map((list) => ({
      ...list,
      cards: list.cards.map((card) => (card.id === updated.id ? { ...card, ...updated } : card)),
    })),
  };
}

/** The board with one card gone, wherever it was. */
export function removeCardLocal(board: BoardView, cardId: number): BoardView {
  return {
    ...board,
    lists: board.lists.map((list) => ({
      ...list,
      cards: list.cards.filter((card) => card.id !== cardId),
    })),
  };
}

/** Whether this account may write to the board it is looking at. */
export const canWrite = (board: Pick<BoardView, "my_role">): boolean =>
  board.my_role !== "viewer";

/** Whether it may reshape the board itself — lists, labels, membership. */
export const canAdminister = (board: Pick<BoardView, "my_role">): boolean =>
  board.my_role === "owner" || board.my_role === "admin";
