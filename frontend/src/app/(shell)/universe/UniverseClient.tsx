"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  CalendarDays,
  CalendarSync,
  Inbox as InboxIcon,
  LayoutGrid,
  Loader2,
  Plus,
} from "lucide-react";
import {
  createBoard,
  createBoardList,
  createCard,
  deleteBoardList,
  deleteCard,
  discardInboxItem,
  getBoard,
  getBoardCalendar,
  getBoards,
  getGoogleCalendarStatus,
  getInbox,
  moveCard,
  reorderBoardLists,
  syncGoogleCalendar,
  updateBoardList,
  type BoardCard,
  type BoardSummary,
  type BoardView,
  type CalendarCard,
  type CardLabel,
  type InboxItem,
} from "@/lib/api";
import {
  canWrite,
  dayBoundary,
  istDay,
  listHolding,
  moveCardLocal,
  parseIst,
  removeCardLocal,
  replaceCardLocal,
  withinDays,
} from "@/lib/board";
import BoardPane from "@/components/board/BoardPane";
import CapturePane from "@/components/board/CapturePane";
import CardDialog from "@/components/board/CardDialog";
import CardFace from "@/components/board/CardFace";
import GoogleCalendarDialog from "@/components/board/GoogleCalendarDialog";
import PlannerPane from "@/components/board/PlannerPane";
import { PaneRow, PaneSwitcher, type PaneSpec } from "@/components/board/PaneRow";
import { usePaneLayout } from "@/components/board/usePaneLayout";
import { resolveDragId, type DragTarget } from "@/components/board/ids";
import ConfirmDialog from "@/components/ConfirmDialog";
import { BOARD_CHANGED_EVENT } from "@/components/StuffBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

/** How many days the Planner opens on. Three, as on the reference board. */
const DEFAULT_PLANNER_DAYS = 3;

/**
 * How stale a Google sync may be before opening the board runs one.
 *
 * There is no worker process in this app, so a sync only ever happens because
 * somebody caused one — and "I opened my planner" is the moment the data most
 * needs to be right. Bounded rather than run every time because the board is
 * re-opened all day, and each sync is real traffic to Google against a shared
 * API quota. Five minutes is under the interval at which anyone notices a
 * calendar being behind, and far above the rate at which this page is opened.
 */
const AUTO_SYNC_AFTER_MINUTES = 5;

type UniverseClientProps = {
  /** `capture.write` — whether the unclarified captures section is any use. */
  canCapture: boolean;
  /** `boards.team` — whether shared boards can be created from here. */
  canCreateTeamBoards: boolean;
  /** `calendar.sync` — whether this account may link a Google Calendar at all. */
  canSyncCalendar: boolean;
  currentUserId: number | null;
  /** `?google=` from the OAuth callback: "connected", "denied" or "error". */
  googleOutcome: string | null;
  /** `?reason=` — Google's own words, when it had any. Only set with "error". */
  googleReason: string | null;
};

/** What to tell somebody the OAuth callback just returned, if anything. */
function googleNoticeFor(outcome: string | null, reason: string | null): string | null {
  if (outcome === "connected") return "Google Calendar connected. Syncing…";
  if (outcome === "denied") return "Google Calendar was not connected — the request was declined.";
  if (outcome) return reason || "Google Calendar could not be connected.";
  return null;
}

/**
 * MyUniverse: three views of the same board, side by side.
 *
 * The panes are not three pages behind tabs, they are one workspace — the point
 * of the arrangement is that a thought captured on the left can be dragged onto
 * the board on the right and read back off the day grid in the middle without a
 * navigation in between. That is why one component owns all three: they share a
 * single loaded board, a single DndContext and a single card detail panel, so a
 * drag or an edit shows up everywhere at once instead of leaving two panes
 * disagreeing about what is true.
 *
 * The Inbox list appears in the left pane and is therefore left out of the board
 * pane while that pane is on screen, exactly as the reference board does it. Two
 * copies of one card would also give dnd-kit two draggables sharing an id, and
 * the drag would land in whichever it saw first. That is asked of
 * `layout.isMounted` rather than of the switcher, because on a narrow screen a
 * pane can be enabled and still not rendered — and then the board does owe you
 * its Inbox column.
 *
 * How wide each pane is, which of them are on screen and how that is remembered
 * belong to `usePaneLayout`; see `lib/panes.ts` for the arithmetic behind it.
 */
export default function UniverseClient({
  canCapture,
  canCreateTeamBoards,
  canSyncCalendar,
  currentUserId,
  googleOutcome,
  googleReason,
}: UniverseClientProps) {
  const router = useRouter();

  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [board, setBoard] = useState<BoardView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const layout = usePaneLayout(currentUserId);
  const showsInbox = layout.isMounted("inbox");
  const showsPlanner = layout.isMounted("planner");

  const [firstDay, setFirstDay] = useState(() => istDay(new Date()));
  const [plannerDays, setPlannerDays] = useState(DEFAULT_PLANNER_DAYS);
  const [calendar, setCalendar] = useState<CalendarCard[] | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const [captures, setCaptures] = useState<InboxItem[] | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragTarget | null>(null);
  const [pendingListDelete, setPendingListDelete] = useState<number | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);

  // All three seeded from the callback's own answer, so the first paint after
  // returning from Google already says what happened. A failure also opens the
  // dialog, because the next thing anybody does after a failed connection is
  // look for the button they just pressed.
  const [googleOpen, setGoogleOpen] = useState(
    googleOutcome !== null && googleOutcome !== "connected" && googleOutcome !== "denied",
  );
  const [googleConnected, setGoogleConnected] = useState(googleOutcome === "connected");
  const [googleNotice, setGoogleNotice] = useState<string | null>(() =>
    googleNoticeFor(googleOutcome, googleReason),
  );
  /** One auto-sync per visit. Without the latch, every board reload re-arms it. */
  const autoSynced = useRef(false);

  const days = useMemo(() => {
    const start = new Date(`${firstDay}T12:00:00+05:30`);
    return Array.from({ length: plannerDays }, (_, offset) => {
      const at = new Date(start);
      at.setDate(at.getDate() + offset);
      return istDay(at);
    });
  }, [firstDay, plannerDays]);

  /** Reloads the whole board. The fallback whenever an optimistic move is refused. */
  const reload = useCallback(async (boardId: number) => {
    try {
      setBoard(await getBoard(boardId));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load that board");
    }
  }, []);

  useEffect(() => {
    // `GET /boards` is what provisions the personal board, so this one call both
    // fills the switcher and guarantees there is something to show.
    getBoards()
      .then(async (all) => {
        setBoards(all);
        if (all.length > 0) await reload(all[0].id);
      })
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : "Could not load your boards"),
      );
  }, [reload]);

  // The `s` shortcut adds cards to Stuff from any page, including this one,
  // where the board it just wrote to is sitting in state that knows nothing
  // about it. Re-read on its say-so rather than polling: the event fires once,
  // when that dialog closes, so a dump of six cards costs one board read.
  useEffect(() => {
    const onBoardChanged = (event: Event) => {
      const changed = (event as CustomEvent<{ boardId: number }>).detail?.boardId;
      if (board && changed === board.id) void reload(board.id);
    };
    window.addEventListener(BOARD_CHANGED_EVENT, onBoardChanged);
    return () => window.removeEventListener(BOARD_CHANGED_EVENT, onBoardChanged);
  }, [board, reload]);

  useEffect(() => {
    if (!canCapture) return;
    getInbox()
      .then((items) => {
        setCaptures(items);
        setCaptureError(null);
      })
      .catch((err) => {
        setCaptures([]);
        setCaptureError(err instanceof Error ? err.message : "Could not load your captures");
      });
  }, [canCapture]);

  useEffect(() => {
    if (!board || !showsPlanner) return;
    let live = true;
    getBoardCalendar(
      board.id,
      dayBoundary(days[0]),
      dayBoundary(shiftDay(days[days.length - 1], 1)),
    )
      .then((cards) => {
        if (!live) return;
        setCalendar(cards);
        setCalendarError(null);
      })
      .catch((err) => {
        if (!live) return;
        setCalendar([]);
        setCalendarError(err instanceof Error ? err.message : "Could not load the planner");
      });
    return () => {
      live = false;
    };
    // `board` rather than `board.id`: a card's due date changing has to redraw
    // the grid, and the board object is what changes when it does.
  }, [board, days, showsPlanner]);

  /**
   * Takes the callback's answer back out of the address bar once it is read.
   *
   * The state above already holds it, so this only cleans up — but the cleanup
   * matters twice over: a refresh would otherwise re-announce a connection made
   * ten minutes ago, and `?reason=` can quote Google's own error text, which
   * has no business sitting in a URL to be pasted into a bug report or caught
   * in a screenshot.
   */
  useEffect(() => {
    if (googleOutcome) router.replace("/universe");
  }, [googleOutcome, router]);

  /**
   * Syncs on arrival when the link exists and has gone stale.
   *
   * This is what makes the integration feel like an integration rather than a
   * button: nothing on this server runs on a timer — there is no worker process
   * — so without it a calendar would only ever be as current as the last time
   * somebody remembered to press Sync. Opening the planner is precisely when
   * being out of date matters, so that is where the cost is spent.
   *
   * Failure is deliberately silent. A sync nobody asked for must not put an
   * error across a board somebody opened to read: the dialog reports the same
   * failure in full to anyone who goes looking, and the board still shows every
   * card it already had.
   */
  useEffect(() => {
    if (!canSyncCalendar || !board || autoSynced.current) return;
    autoSynced.current = true;

    let live = true;
    (async () => {
      try {
        const status = await getGoogleCalendarStatus();
        if (!live) return;
        setGoogleConnected(status.connected);
        if (!status.connected) return;

        const staleSince = Date.now() - AUTO_SYNC_AFTER_MINUTES * 60_000;
        const lastSync = status.last_sync_at ? parseIst(status.last_sync_at).getTime() : 0;
        if (lastSync > staleSince) return;

        const outcome = await syncGoogleCalendar();
        if (!live) return;
        setGoogleNotice(null);
        // Only re-read the board when something actually moved. A quiet sync is
        // the common case, and re-fetching after each one would throw away
        // whatever the person was doing in the half second it takes.
        if (
          outcome.imported ||
          outcome.updated_locally ||
          outcome.removed_locally ||
          outcome.exported
        ) {
          await reload(board.id);
        }
      } catch {
        // See the docstring: an unasked-for sync fails quietly.
        if (live) setGoogleNotice(null);
      }
    })();

    return () => {
      live = false;
    };
  }, [board, canSyncCalendar, reload]);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so the whole card face can be
    // the handle and still open the detail panel on a plain click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const writable = board ? canWrite(board) : false;
  const inboxList = board?.lists.find((list) => list.role === "inbox");
  const calendarList = board?.lists.find((list) => list.role === "calendar");
  /**
   * The columns to draw, with the Calendar list cut down to the Planner's days.
   *
   * The two are one view of one week, not two independent lists: a Calendar
   * column holding every dated card ever synced is hundreds of prayers and
   * appointments deep, and scrolling it to find today defeats the point of
   * having the grid beside it. Windowed to the same days the grid is drawing,
   * the column becomes the agenda for what you are looking at, and widening the
   * grid to seven days widens the agenda with it.
   *
   * Only while the Planner is on screen. With that pane closed there is no
   * control left that moves the window, so a filtered column would be a column
   * whose hidden cards cannot be got back to.
   *
   * The filtering is for rendering only — `board` still holds every card, which
   * is what keeps drop positions honest. Dropping onto a visible card resolves
   * its index in the full list, so a card dragged into a windowed Calendar lands
   * where it looks like it landed rather than at some position counted over a
   * shorter array.
   */
  const boardLists = useMemo(() => {
    if (!board) return [];
    const visible = showsInbox ? board.lists.filter((list) => list.role !== "inbox") : board.lists;
    if (!showsPlanner) return visible;
    return visible.map((list) =>
      list.role === "calendar"
        ? { ...list, cards: list.cards.filter((card) => withinDays(card, days)) }
        : list,
    );
  }, [board, showsInbox, showsPlanner, days]);

  /** What the windowed Calendar column says about the cards it is not showing. */
  const listNotes = useMemo(() => {
    if (!calendarList || !showsPlanner) return undefined;
    const shown = boardLists.find((list) => list.id === calendarList.id)?.cards.length ?? 0;
    const hidden = calendarList.cards.length - shown;
    if (hidden <= 0) return undefined;
    return {
      [calendarList.id]: `Showing these ${days.length} days · ${hidden} on other days`,
    };
  }, [calendarList, boardLists, days.length, showsPlanner]);

  const activeCard = activeDrag?.kind === "card" && board ? findCardIn(board, activeDrag.id) : null;

  // --- drag ------------------------------------------------------------------

  /**
   * What the pointer is over, with the dragged thing itself left out.
   *
   * Two departures from plain `closestCorners`, both learned the hard way:
   *
   * The active card is excluded because it is a drop target too. Once
   * `handleDragOver` has optimistically moved it, its own droppable sits under
   * the pointer and wins every subsequent collision — so the card stops
   * following the pointer and a quick drag across three columns lands in the
   * first one it noticed.
   *
   * `pointerWithin` goes first because it answers the question the user is
   * actually asking: which column am I pointing at? Corner distance is a decent
   * fallback for a drop just outside every column, but as the primary test it
   * prefers whichever rect happens to be geometrically nearest, which is not
   * always the one under the cursor.
   *
   * A list being dragged only ever collides with other lists — columns reorder
   * among themselves, and letting a column consider a card as a target would
   * make a header drag land nowhere.
   */
  const collisionDetection: CollisionDetection = (args) => {
    const active = resolveDragId(args.active.id);
    const candidates = args.droppableContainers.filter((container) => {
      if (container.id === args.active.id) return false;
      const target = resolveDragId(container.id);
      if (!target) return false;
      return active?.kind === "list" ? target.kind === "list" : true;
    });
    const within = pointerWithin({ ...args, droppableContainers: candidates });
    return within.length > 0 ? within : closestCorners({ ...args, droppableContainers: candidates });
  };

  const targetListFor = (board: BoardView, over: DragTarget | null): number | null => {
    if (!over) return null;
    if (over.kind === "card") return listHolding(board, over.id)?.id ?? null;
    return over.id;
  };

  /**
   * Where the dragged card sat when the drag began.
   *
   * Needed because `handleDragOver` moves the card as the pointer crosses
   * columns: by the time the drop happens the board state already shows the new
   * position, so "did anything change?" cannot be asked of it. Asked of the
   * origin instead, the answer stays right — without this, an optimistic move
   * looks like a no-op at drop time, no request is sent, and the card snaps back
   * on the next load.
   */
  const dragOrigin = useRef<{ listId: number; index: number } | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const active = resolveDragId(event.active.id);
    setActiveDrag(active);
    if (active?.kind === "card" && board) {
      const from = listHolding(board, active.id);
      dragOrigin.current = from
        ? { listId: from.id, index: from.cards.findIndex((card) => card.id === active.id) }
        : null;
    } else {
      dragOrigin.current = null;
    }
  };

  /**
   * Moves the card between columns while the pointer is still down.
   *
   * Only across lists: within one list dnd-kit's own sorting animation already
   * shows the gap, and rewriting the array on every hover would fight it.
   */
  const handleDragOver = (event: DragOverEvent) => {
    const active = resolveDragId(event.active.id);
    if (!board || active?.kind !== "card") return;
    const targetId = targetListFor(board, resolveDragId(event.over?.id));
    if (targetId === null) return;

    const from = listHolding(board, active.id);
    if (!from || from.id === targetId) return;

    const target = board.lists.find((list) => list.id === targetId);
    if (!target) return;
    const over = resolveDragId(event.over?.id);
    const index =
      over?.kind === "card"
        ? target.cards.findIndex((card) => card.id === over.id)
        : target.cards.length;
    setBoard(moveCardLocal(board, active.id, targetId, index < 0 ? target.cards.length : index));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const active = resolveDragId(event.active.id);
    const over = resolveDragId(event.over?.id);
    setActiveDrag(null);
    if (!board || !active) return;

    if (active.kind === "list") {
      if (over?.kind !== "list" || over.id === active.id) return;
      const order = board.lists.map((list) => list.id);
      const next = arrayMove(order, order.indexOf(active.id), order.indexOf(over.id));
      const previous = board;
      setBoard({ ...board, lists: next.map((id) => board.lists.find((l) => l.id === id)!) });
      try {
        await reorderBoardLists(board.id, next);
      } catch (err) {
        setBoard(previous);
        setActionError(err instanceof Error ? err.message : "Could not reorder the lists");
      }
      return;
    }

    if (active.kind !== "card") return;
    const targetId = targetListFor(board, over) ?? listHolding(board, active.id)?.id ?? null;
    if (targetId === null) return;
    const target = board.lists.find((list) => list.id === targetId);
    if (!target) return;

    const currentIndex = target.cards.findIndex((card) => card.id === active.id);
    const index =
      over?.kind === "card"
        ? target.cards.findIndex((card) => card.id === over.id)
        : currentIndex >= 0
          ? currentIndex
          : target.cards.length;
    const finalIndex = index < 0 ? target.cards.length : index;

    // Compared against where the drag began, never against the current board:
    // `handleDragOver` may already have moved the card there, which would make
    // every cross-column drop look like a no-op.
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    if (origin && origin.listId === targetId && origin.index === finalIndex) return;

    setBoard(moveCardLocal(board, active.id, targetId, finalIndex));
    try {
      await moveCard(active.id, targetId, finalIndex);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That move did not stick");
      await reload(board.id);
    }
  };

  // --- mutations -------------------------------------------------------------

  const guard = async (action: () => Promise<void>, fallback: string) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallback);
      if (board) await reload(board.id);
    }
  };

  const addCard = (listId: number, title: string) =>
    guard(async () => {
      const created = await createCard(listId, { title });
      setBoard((current) =>
        current === null
          ? current
          : {
              ...current,
              lists: current.lists.map((list) =>
                list.id === listId ? { ...list, cards: [...list.cards, created] } : list,
              ),
            },
      );
    }, "Could not add that card");

  const renameList = (listId: number, name: string) =>
    guard(async () => {
      await updateBoardList(listId, { name });
      setBoard((current) =>
        current === null
          ? current
          : {
              ...current,
              lists: current.lists.map((list) => (list.id === listId ? { ...list, name } : list)),
            },
      );
    }, "Could not rename that list");

  const archiveList = (listId: number) =>
    guard(async () => {
      await updateBoardList(listId, { is_archived: true });
      setBoard((current) =>
        current === null
          ? current
          : { ...current, lists: current.lists.filter((list) => list.id !== listId) },
      );
    }, "Could not archive that list");

  const removeList = () =>
    guard(async () => {
      if (pendingListDelete === null) return;
      await deleteBoardList(pendingListDelete);
      setBoard((current) =>
        current === null
          ? current
          : { ...current, lists: current.lists.filter((list) => list.id !== pendingListDelete) },
      );
      setPendingListDelete(null);
    }, "Could not delete that list");

  const addList = (name: string) =>
    guard(async () => {
      if (!board) return;
      const created = await createBoardList(board.id, name);
      setBoard((current) =>
        current === null ? current : { ...current, lists: [...current.lists, created] },
      );
    }, "Could not add that list");

  /**
   * Files a capture onto the board and drops it from the inbox.
   *
   * Two calls, in this order on purpose: the card is created first, so a failure
   * on the second leaves the thought in both places rather than in neither. A
   * duplicate is a nuisance; a silently lost capture is the failure this whole
   * app exists to prevent.
   */
  const fileCapture = (item: InboxItem) =>
    guard(async () => {
      if (!inboxList) return;
      const created = await createCard(inboxList.id, { title: item.body });
      setBoard((current) =>
        current === null
          ? current
          : {
              ...current,
              lists: current.lists.map((list) =>
                list.id === inboxList.id ? { ...list, cards: [...list.cards, created] } : list,
              ),
            },
      );
      await discardInboxItem(item.id);
      setCaptures((current) => (current ?? []).filter((candidate) => candidate.id !== item.id));
      // The rail's badge is server-rendered in the shell layout and would
      // otherwise keep the old count until a hard reload.
      router.refresh();
    }, "Could not file that capture");

  const discardCapture = (item: InboxItem) =>
    guard(async () => {
      await discardInboxItem(item.id);
      setCaptures((current) => (current ?? []).filter((candidate) => candidate.id !== item.id));
      router.refresh();
    }, "Could not discard that");

  /**
   * Creates a card at a clicked hour and opens it.
   *
   * Titled rather than prompting for a name first: the detail panel is already
   * the better place to type one, and an appointment that exists on the grid
   * before it is named is easier to correct than one that was never created.
   */
  const createAt = (day: string, hour: number) =>
    guard(async () => {
      const list = calendarList ?? board?.lists[0];
      if (!list) return;
      const at = `${day}T${String(hour).padStart(2, "0")}:00:00`;
      const created = await createCard(list.id, { title: "New card", due_at: at });
      setBoard((current) =>
        current === null
          ? current
          : {
              ...current,
              lists: current.lists.map((candidate) =>
                candidate.id === list.id
                  ? { ...candidate, cards: [...candidate.cards, created] }
                  : candidate,
              ),
            },
      );
      setOpenCardId(created.id);
    }, "Could not add a card there");

  const onCardSaved = (updated: BoardCard) =>
    setBoard((current) => (current === null ? current : replaceCardLocal(current, updated)));

  const onCardDeleted = (cardId: number, trashed: boolean) => {
    if (!board) return;
    // A trashed card moved rather than vanished, and the Trash list is on screen,
    // so the cheapest correct answer is to re-read the board.
    if (trashed) void reload(board.id);
    else setBoard(removeCardLocal(board, cardId));
  };

  const onLabelAdded = (label: CardLabel) =>
    setBoard((current) =>
      current === null ? current : { ...current, labels: [...current.labels, label] },
    );

  const switchBoard = async (boardId: number) => {
    setBoard(null);
    setCalendar(null);
    await reload(boardId);
  };

  const newBoard = (name: string, useTemplate: boolean) =>
    guard(async () => {
      const created = await createBoard({ name, use_gtd_template: useTemplate });
      setBoards((current) => [...current, created]);
      setCreatingBoard(false);
      await switchBoard(created.id);
    }, "Could not create that board");

  // --- render ----------------------------------------------------------------

  if (loadError) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">MyUniverse</h1>
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  if (!board) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening your board…
      </p>
    );
  }

  const panes: PaneSpec[] = [
    {
      id: "inbox",
      label: "Inbox",
      glyph: InboxIcon,
      className: "rounded-md border border-border p-2",
      content: (
        <CapturePane
          inboxList={inboxList}
          captures={canCapture ? captures : []}
          captureError={captureError}
          writable={writable}
          onAddCard={(title) => (inboxList ? addCard(inboxList.id, title) : Promise.resolve())}
          onOpenCard={setOpenCardId}
          onFileCapture={fileCapture}
          onDiscardCapture={discardCapture}
        />
      ),
    },
    {
      id: "planner",
      label: "Planner",
      glyph: CalendarDays,
      className: "rounded-md border border-border p-2",
      content: (
        <PlannerPane
          days={days}
          cards={calendar}
          error={calendarError}
          onShift={(delta) => setFirstDay(shiftDay(firstDay, delta))}
          onToday={() => setFirstDay(istDay(new Date()))}
          onSpanChange={setPlannerDays}
          onOpenCard={setOpenCardId}
          onCreateAt={writable ? createAt : undefined}
        />
      ),
    },
    {
      id: "board",
      label: "Board",
      glyph: LayoutGrid,
      content: (
        <BoardPane
          board={board}
          lists={boardLists}
          listNotes={listNotes}
          onOpenCard={setOpenCardId}
          onAddCard={addCard}
          onRenameList={renameList}
          onArchiveList={archiveList}
          onDeleteList={setPendingListDelete}
          onAddList={addList}
        />
      ),
    },
  ];

  return (
    // Pinned to the viewport at every width, because the panes each own their own
    // scrolling and the switcher along the bottom has to stay reachable. That was
    // once only true from md up, when a narrow screen stacked all three panes and
    // no fixed height could hold them; a narrow screen now shows one pane at a
    // time, which fits by construction.
    <div className="flex h-[calc(100svh-8.5rem)] min-h-[26rem] flex-col gap-3 md:h-[calc(100svh-7rem)] md:min-h-[34rem]">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{board.name}</h1>
        {boards.length > 1 && (
          <Select
            value={String(board.id)}
            onChange={(event) => switchBoard(Number(event.target.value))}
            aria-label="Switch boards"
            className="max-w-52"
          >
            {boards.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.board_type === "team" ? " · team" : ""}
              </option>
            ))}
          </Select>
        )}
        {board.board_type === "team" && (
          <span className="text-xs text-muted-foreground">
            Shared · you are {board.my_role}
          </span>
        )}
        {canCreateTeamBoards && (
          <Button size="sm" variant="ghost" onClick={() => setCreatingBoard(true)}>
            <Plus className="h-4 w-4" /> New board
          </Button>
        )}
        {canSyncCalendar && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setGoogleOpen(true)}
            title={
              googleConnected
                ? "Google Calendar settings, and sync now"
                : "Bring your Google Calendar onto this board"
            }
          >
            <CalendarSync className="h-4 w-4" />
            {googleConnected ? "Calendar" : "Connect calendar"}
          </Button>
        )}
        {googleNotice && (
          <button
            type="button"
            onClick={() => setGoogleNotice(null)}
            className="max-w-full truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
            title="Dismiss"
          >
            {googleNotice}
          </button>
        )}
        {actionError && (
          <span className="ml-auto max-w-full truncate text-xs text-destructive">{actionError}</span>
        )}
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDrag(null);
          dragOrigin.current = null;
        }}
      >
        <PaneRow layout={layout} panes={panes} />

        <DragOverlay>
          {activeCard ? <CardFace card={activeCard} onOpen={() => {}} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {/* The pane switcher, along the bottom as on the reference board. Toggles
          while the panes sit side by side, because they are not alternatives —
          the usual state is all three at once, and this is how you get a wider
          board when you need one. Tabs once the row is too narrow to hold them. */}
      <PaneSwitcher layout={layout} panes={panes} />

      <CardDialog
        key={openCardId ?? "closed"}
        cardId={openCardId}
        board={board}
        currentUserId={currentUserId}
        onClose={() => setOpenCardId(null)}
        onSaved={onCardSaved}
        onDeleted={onCardDeleted}
        onRequestDelete={deleteCard}
        onLabelAdded={onLabelAdded}
      />

      <ConfirmDialog
        open={pendingListDelete !== null}
        onOpenChange={(open) => !open && setPendingListDelete(null)}
        title="Delete this list?"
        description="Its cards go with it. Archive the list instead to keep them."
        confirmLabel="Delete list"
        destructive
        onConfirm={removeList}
      />

      {creatingBoard && (
        <NewBoardDialog onCancel={() => setCreatingBoard(false)} onCreate={newBoard} />
      )}

      {canSyncCalendar && (
        <GoogleCalendarDialog
          open={googleOpen}
          onOpenChange={(open) => {
            setGoogleOpen(open);
            // The dialog can connect, disconnect or switch calendars, any of
            // which changes what belongs on the board. Cheapest correct answer
            // on close is to re-read it.
            if (!open) {
              setGoogleNotice(null);
              void getGoogleCalendarStatus()
                .then((status) => setGoogleConnected(status.connected))
                .catch(() => {});
            }
          }}
          onSynced={() => void reload(board.id)}
        />
      )}
    </div>
  );
}

function NewBoardDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string, useTemplate: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), useTemplate);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New shared board</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase text-muted-foreground">Name</span>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submit()}
              placeholder="Marketing"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useTemplate}
              onChange={(event) => setUseTemplate(event.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Start from the GTD template
          </label>
          <p className="text-[11px] text-muted-foreground">
            Shared boards are blank by default — To Do, Doing, Done. GTD is a
            personal method, and imposing its twelve lists on a team is how a board
            fills with columns nobody owns.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create board
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The card, wherever it is on the board. Local to the drag overlay's needs. */
function findCardIn(board: BoardView, cardId: number): BoardCard | null {
  for (const list of board.lists) {
    const found = list.cards.find((card) => card.id === cardId);
    if (found) return found;
  }
  return null;
}

/** `day` shifted by whole IST days, as `YYYY-MM-DD`. Also builds the Planner's
 *  exclusive upper bound, which is one day past the last column. */
function shiftDay(day: string, delta: number): string {
  const at = new Date(`${day}T12:00:00+05:30`);
  at.setDate(at.getDate() + delta);
  return istDay(at);
}

