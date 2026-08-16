const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * A failed request, carrying the API's `detail` intact.
 *
 * `detail` is a plain string for most failures but an object for the ones a UI
 * has to react to rather than merely print — a blocked delete, say. `message`
 * stays a readable sentence either way, so every existing `e.message` call site
 * keeps working.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Unwraps a non-2xx response into an ApiError. Never returns. */
const raiseForStatus = async (response: Response): Promise<never> => {
  let detail: unknown = null;
  try {
    detail = (await response.json())?.detail ?? null;
  } catch {}

  const message =
    typeof detail === "string"
      ? detail
      : typeof (detail as { message?: unknown } | null)?.message === "string"
        ? ((detail as { message: string }).message)
        : response.statusText;

  throw new ApiError(message, response.status, detail);
};

/** One reason a delete was refused, e.g. 7 tasks still using a category. */
export type DeletionBlocker = { kind: string; count: number; detail: string };

/** The 409 body the API sends when a delete would orphan rows. */
export type DeletionBlocked = {
  code: "deletion_blocked";
  entity: string;
  name: string;
  message: string;
  remedy: string;
  blockers: DeletionBlocker[];
};

/** The blocked-delete payload if that is what this error is, otherwise null. */
export const asDeletionBlocked = (error: unknown): DeletionBlocked | null => {
  if (!(error instanceof ApiError) || typeof error.detail !== "object" || error.detail === null) {
    return null;
  }
  const detail = error.detail as DeletionBlocked;
  return detail.code === "deletion_blocked" ? detail : null;
};

export const fetchAPI = async (endpoint: string, options: RequestInit = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) await raiseForStatus(response);

  // 204 and other empty bodies would make response.json() throw.
  if (response.status === 204) return null;
  return response.json();
};

export type DownloadedFile = { blob: Blob; filename: string };

/**
 * A download instead of JSON. Separate from fetchAPI because that one always
 * calls response.json(), which would consume and reject a spreadsheet.
 *
 * Error responses are still JSON even here, so failures are unwrapped the same
 * way and surface the API's `detail` message.
 */
export const fetchBlob = async (
  endpoint: string,
  fallbackName: string,
): Promise<DownloadedFile> => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, { credentials: "include" });

  if (!response.ok) await raiseForStatus(response);

  return {
    blob: await response.blob(),
    // Readable only because the API sends expose_headers=["Content-Disposition"];
    // without that the browser hides it on a cross-origin response.
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")) ?? fallbackName,
  };
};

/** Prefers RFC 5987 filename* over the ASCII filename, as browsers do. */
const filenameFromDisposition = (header: string | null): string | null => {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {}
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
};

/** Omit both dates for all time. Bounds are inclusive calendar days (YYYY-MM-DD). */
export const getLeaderboard = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/leaderboard${query}`);
};
export const getTasks = () => fetchAPI("/tasks");
export const getCategories = () => fetchAPI("/categories");
export const getUsers = () => fetchAPI("/users");
/**
 * Marks a task done. `minutes` is optional and records how long the work took,
 * which is what lets the panel report a share of time rather than only of
 * points — the Drain track is worth 0, so its hours are invisible without it.
 */
export const completeTask = (taskId: number, minutes?: number) =>
  fetchAPI(`/tasks/${taskId}/complete`, {
    method: "POST",
    body: JSON.stringify(minutes === undefined ? {} : { minutes }),
  });
/** Ordered ids for ONE column, top to bottom. Other tasks keep their order. */
export const reorderTasks = (taskIds: number[]) =>
  fetchAPI("/tasks/reorder", { method: "PATCH", body: JSON.stringify({ task_ids: taskIds }) });
/**
 * Moves a task into another category. `taskIds` is the destination column's full
 * order after the move and must include `taskId`. Points follow the new category
 * unless a custom value was set in Admin.
 */
export const moveTask = (taskId: number, categoryId: number, taskIds: number[]) =>
  fetchAPI(`/tasks/${taskId}/move`, {
    method: "PATCH",
    body: JSON.stringify({ category_id: categoryId, task_ids: taskIds }),
  });
export const createTask = (data: any) => fetchAPI("/tasks", { method: "POST", body: JSON.stringify(data) });

/**
 * A partial task edit. `undefined` is dropped by JSON.stringify and leaves the
 * field alone; an explicit `null` is what releases a pinned point value back to
 * the category default, or unlinks the milestone.
 *
 * Category is not editable here — dragging the task to another column is, which
 * is PATCH /tasks/{id}/move.
 */
export type TaskUpdate = {
  title?: string;
  user_id?: number;
  milestone_id?: number | null;
  /**
   * The domain tag (pillar → function). Unlike reassigning or repricing, this
   * is allowed on a completed task: the ledger stores no function of its own,
   * so retagging moves the points with it instead of stranding them. An
   * explicit null untags the task into the panel's Unassigned bucket.
   */
  function_id?: number | null;
  is_recurring?: boolean;
  points?: number | null;
};

/** Reassigning or repricing a completed task is refused: its points are already banked. */
export const updateTask = (taskId: number, data: TaskUpdate) =>
  fetchAPI(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(data) });

/**
 * Only ever succeeds for a task nobody has completed — one with ledger entries
 * is refused with a 409 (see `asDeletionBlocked`), because the leaderboard is
 * computed from those rows.
 */
export const deleteTask = (taskId: number) => fetchAPI(`/tasks/${taskId}`, { method: "DELETE" });

/**
 * Capture — your own inbox, and nobody else's.
 *
 * None of these take a user id, because the API does not offer one: an inbox is
 * reachable only by being its owner. They are gated on `capture.write`, which is
 * granted to every account by default and is deliberately *not* `admin.tasks` —
 * writing down what is on your mind is not the same act as assigning work to
 * somebody, and only the second one is privileged.
 */
export type InboxItem = { id: number; body: string; created_at: string };

/** Oldest first, which is the order clarifying works through them. */
export const getInbox = (): Promise<InboxItem[]> => fetchAPI("/inbox");
/** Just the number, for the rail. Avoids pulling captured text into every page. */
export const getInboxCount = (): Promise<{ count: number }> => fetchAPI("/inbox/count");
/** One capture. Text is trimmed server-side; blank is refused, not ignored. */
export const captureItem = (body: string): Promise<InboxItem> =>
  fetchAPI("/inbox", { method: "POST", body: JSON.stringify({ body }) });
/**
 * Throws an item away unprocessed. A hard delete — an inbox item has no points,
 * no ledger row and no project, so there is nothing downstream to preserve.
 */
export const discardInboxItem = (itemId: number) =>
  fetchAPI(`/inbox/${itemId}`, { method: "DELETE" });

/**
 * Clarify — the only way an item leaves the inbox.
 *
 * The destination row and the inbox delete share one transaction server-side,
 * so a rejected call leaves the item exactly where it was. That matters: a
 * half-applied clarify would put the same thought in two places, and the copy
 * still in the inbox would get clarified all over again.
 *
 * `next_action` and `project` additionally need `admin.tasks` (and `admin.goals`
 * for projects), because those branches create scored work. Everything else
 * only needs `capture.write`.
 */
export type ClarifyOutcome =
  | "trash" | "reference" | "someday" | "waiting" | "next_action" | "project";

export type ClarifyRequest = {
  outcome: ClarifyOutcome;
  title?: string;
  notes?: string;
  body?: string;
  delegate_user_id?: number | null;
  delegate_name?: string;
  follow_up_date?: string | null;
  category_id?: number;
  function_id?: number | null;
  points?: number | null;
  assignee_id?: number;
  goal_id?: number;
  first_action_title?: string;
};

export type ClarifyResult = {
  outcome: string;
  summary: string;
  item_id: number;
  created_id: number | null;
  created_action_id: number | null;
};

export const clarifyInboxItem = (itemId: number, request: ClarifyRequest): Promise<ClarifyResult> =>
  fetchAPI(`/inbox/${itemId}/clarify`, { method: "POST", body: JSON.stringify(request) });

/**
 * The three holding lists. All private to the caller, all gated on
 * `lists.write`, and none of them takes a user id — same as the inbox.
 */
export type SomedayItem = {
  id: number; title: string; notes: string | null;
  created_at: string; last_reviewed_at: string | null;
};
export type ReferenceItem = {
  id: number; title: string; body: string; created_at: string;
};
export type WaitingItem = {
  id: number; title: string; notes: string | null;
  delegate_user_id: number | null; delegate_name: string;
  waiting_since: string; follow_up_date: string | null;
  status: string; closed_at: string | null;
  /** Server-computed so the list and any future reminder cannot disagree. */
  days_waiting: number; is_due: boolean;
};

export const getSomeday = (): Promise<SomedayItem[]> => fetchAPI("/someday");
export const createSomeday = (data: { title: string; notes?: string }) =>
  fetchAPI("/someday", { method: "POST", body: JSON.stringify(data) });
/** `reviewed: true` stamps the review time server-side; it cannot be backdated. */
export const updateSomeday = (
  id: number,
  data: { title?: string; notes?: string; reviewed?: boolean },
) => fetchAPI(`/someday/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteSomeday = (id: number) => fetchAPI(`/someday/${id}`, { method: "DELETE" });

export const getReference = (): Promise<ReferenceItem[]> => fetchAPI("/reference");
export const createReference = (data: { title: string; body: string }) =>
  fetchAPI("/reference", { method: "POST", body: JSON.stringify(data) });
export const updateReference = (id: number, data: { title?: string; body?: string }) =>
  fetchAPI(`/reference/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteReference = (id: number) => fetchAPI(`/reference/${id}`, { method: "DELETE" });

/** Open items only unless `includeClosed`. Longest-waiting first. */
export const getWaiting = (includeClosed = false): Promise<WaitingItem[]> =>
  fetchAPI(`/waiting${includeClosed ? "?include_closed=true" : ""}`);
export const createWaiting = (data: {
  title: string; notes?: string;
  delegate_user_id?: number | null; delegate_name?: string;
  follow_up_date?: string | null;
}) => fetchAPI("/waiting", { method: "POST", body: JSON.stringify(data) });
export const updateWaiting = (
  id: number,
  data: { title?: string; notes?: string; follow_up_date?: string | null; status?: "Open" | "Closed" },
) => fetchAPI(`/waiting/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteWaiting = (id: number) => fetchAPI(`/waiting/${id}`, { method: "DELETE" });
export const createCategory = (data: any) => fetchAPI("/categories", { method: "POST", body: JSON.stringify(data) });
export const updateCategory = (categoryId: number, data: any) =>
  fetchAPI(`/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(data) });
/** How many tasks a delete would have to move. Asked before confirming, not after. */
export const getCategoryUsage = (categoryId: number) =>
  fetchAPI(`/categories/${categoryId}/usage`);
/**
 * Omit `reassignTo` only for a category nothing uses — the API refuses with a
 * 409 (see `asDeletionBlocked`) while any task still points at it.
 */
export const deleteCategory = (categoryId: number, reassignTo?: number) => {
  const query = reassignTo === undefined ? "" : `?reassign_to=${reassignTo}`;
  return fetchAPI(`/categories/${categoryId}${query}`, { method: "DELETE" });
};
/**
 * Signs in with an email address and password.
 *
 * Accounts created before email sign-in have no address yet, and those still
 * accept their display name in this same field until an administrator gives
 * them one. That fallback is the API's, not this function's — send whatever was
 * typed and let the backend resolve it.
 */
export const login = (email: string, password: string) =>
  fetchAPI("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => fetchAPI("/auth/logout", { method: "POST" });
export const getMe = () => fetchAPI("/auth/me");
export const getPermissionCatalogue = () => fetchAPI("/users/access/catalogue");
export const getUserAccess = () => fetchAPI("/users/access");
/** Replaces one account's grants with exactly this set. */
export const setUserAccess = (userId: number, permissions: string[]) =>
  fetchAPI(`/users/${userId}/access`, { method: "PUT", body: JSON.stringify({ permissions }) });
/** New accounts start on the default grant set; widen it from the Access page. */
export const createUser = (data: {
  name: string;
  role: string;
  password: string;
  email?: string;
}) => fetchAPI("/users", { method: "POST", body: JSON.stringify(data) });
/**
 * Renames an account and/or sets a new password or sign-in address. Omit a field
 * to leave it untouched — sending an empty string is refused, not ignored.
 *
 * Setting `email` moves the account off name sign-in for good; there is no way
 * to clear it back to null from here, because that would be a downgrade.
 */
export const updateUser = (
  userId: number,
  data: { name?: string; password?: string; email?: string },
) => fetchAPI(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(data) });
/**
 * Blocks or restores sign-in. Deactivating takes effect on that person's next
 * request, not just their next login, and leaves their tasks and points alone.
 */
export const setUserActive = (userId: number, isActive: boolean) =>
  fetchAPI(`/users/${userId}/active`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: isActive }),
  });
/**
 * Only ever succeeds for an account with no tasks and no points — anything else
 * is refused with a 409 (see `asDeletionBlocked`) naming what still points at it.
 */
export const deleteUser = (userId: number) => fetchAPI(`/users/${userId}`, { method: "DELETE" });

/** SMTP settings the backend is using, minus the password. Requires `admin.mail`. */
export const getMailStatus = () => fetchAPI("/mail/status");
/** Sends a diagnostic message. Omit `to` to send to your own address. */
export const sendTestMail = (to?: string) =>
  fetchAPI("/mail/test", { method: "POST", body: JSON.stringify({ to: to ?? null }) });
export const getGoals = () => fetchAPI("/goals");
export const createGoal = (data: any) => fetchAPI("/goals", { method: "POST", body: JSON.stringify(data) });
export const updateGoal = (goalId: number, data: { title: string }) =>
  fetchAPI(`/goals/${goalId}`, { method: "PATCH", body: JSON.stringify(data) });
/** How many milestones and tasks a delete would take with it. Asked before confirming. */
export const getGoalUsage = (goalId: number) => fetchAPI(`/goals/${goalId}/usage`);
/**
 * Omit `cascade` only for a goal with no milestones — the API refuses with a 409
 * (see `asDeletionBlocked`) while any still belong to it. Cascading deletes the
 * milestones but never the tasks: those are unlinked and keep their points.
 */
export const deleteGoal = (goalId: number, cascade = false) =>
  fetchAPI(`/goals/${goalId}${cascade ? "?cascade=true" : ""}`, { method: "DELETE" });
export const getMilestones = () => fetchAPI("/milestones");
export const createMilestone = (data: any) => fetchAPI("/milestones", { method: "POST", body: JSON.stringify(data) });
export const completeMilestone = (milestoneId: number) => fetchAPI(`/milestones/${milestoneId}`, { method: "PATCH", body: JSON.stringify({ status: "Completed" }) });
/** Renames a milestone. Allowed even once it is completed. */
export const updateMilestone = (milestoneId: number, data: { title: string }) =>
  fetchAPI(`/milestones/${milestoneId}`, { method: "PATCH", body: JSON.stringify(data) });
/** How many tasks a delete would unlink. Asked before confirming. */
export const getMilestoneUsage = (milestoneId: number) =>
  fetchAPI(`/milestones/${milestoneId}/usage`);
/**
 * Omit `cascade` only for a milestone with no tasks — the API refuses with a 409
 * (see `asDeletionBlocked`) while any point at it. Cascading unlinks those tasks
 * rather than deleting them.
 */
export const deleteMilestone = (milestoneId: number, cascade = false) =>
  fetchAPI(`/milestones/${milestoneId}${cascade ? "?cascade=true" : ""}`, { method: "DELETE" });
/** Which sheets this account may download, and roughly how big each one is. */
export const getExportManifest = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/export/manifest${query}`);
};

export type ExportRequest = {
  format: "csv" | "xlsx";
  sheets: string[];
  startDate?: string;
  endDate?: string;
  categoryId?: number;
  goalId?: number;
  status?: string;
  userId?: number;
};

/** One file: an .xlsx workbook, a bare .csv, or a .zip of .csv files. */
export const downloadExport = ({
  format,
  sheets,
  startDate,
  endDate,
  categoryId,
  goalId,
  status,
  userId,
}: ExportRequest) => {
  const params = new URLSearchParams({ format, sheets: sheets.join(",") });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (categoryId) params.append("category_id", String(categoryId));
  if (goalId) params.append("goal_id", String(goalId));
  if (status) params.append("status", status);
  if (userId) params.append("user_id", String(userId));

  const extension = format === "xlsx" ? "xlsx" : sheets.length === 1 ? "csv" : "zip";
  return fetchBlob(`/export?${params.toString()}`, `outcomeoriented-export.${extension}`);
};

/** Pillars with their functions nested. Feeds the panel, the task forms and seats. */
export const getOrgTree = () => fetchAPI("/org/tree");
export const createPillar = (data: {
  name: string; slug: string; color_hex?: string; position?: number; is_company?: boolean;
}) => fetchAPI("/org/pillars", { method: "POST", body: JSON.stringify(data) });
export const createFunction = (data: {
  pillar_id: number; name: string; purpose?: string; color_hex?: string; position?: number;
}) => fetchAPI("/org/functions", { method: "POST", body: JSON.stringify(data) });
export const updateFunction = (
  functionId: number,
  data: { name?: string; purpose?: string; color_hex?: string; position?: number; pillar_id?: number },
) => fetchAPI(`/org/functions/${functionId}`, { method: "PATCH", body: JSON.stringify(data) });
/** How many tasks and seats a delete would strand. Asked before confirming. */
export const getFunctionUsage = (functionId: number) =>
  fetchAPI(`/org/functions/${functionId}/usage`);
/** Refused with a 409 (see `asDeletionBlocked`) while any task or seat points at it. */
export const deleteFunction = (functionId: number) =>
  fetchAPI(`/org/functions/${functionId}`, { method: "DELETE" });

/** Omit both dates for all time. Bounds are inclusive calendar days (YYYY-MM-DD). */
export const getMyPanel = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/panel/me${query}`);
};

/** Someone else's panel. Needs `panel.view.all` unless it is your own id. */
export const getPanel = (userId: number, startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/panel/${userId}${query}`);
};

/**
 * The whole company's mix over one window — by pillar, function, track and
 * person. Needs `panel.view.all`, the same grant that opens anyone else's panel.
 */
export const getCompanyPanel = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/panel/company${query}`);
};

/**
 * Sets the function this person is meant to be working in. Null clears it.
 * A seat restricts nothing — it only gives the panel something to measure
 * drift against.
 */
export const setUserSeat = (userId: number, homeFunctionId: number | null) =>
  fetchAPI(`/users/${userId}/seat`, {
    method: "PATCH",
    body: JSON.stringify({ home_function_id: homeFunctionId }),
  });

export const getChartData = (categoryId?: number | string, startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (categoryId) params.append("category_id", categoryId.toString());
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/chart-data${query}`);
};

/**
 * MyUniverse — the board, its lists and its cards.
 *
 * Same privacy shape as the inbox: no call here takes a user id. Your personal
 * board is reachable only by being you, and `GET /boards` is what provisions it
 * the first time, so no client has to know whether it exists yet.
 *
 * Reads are whole-board on purpose. A Kanban is drawn all at once and a
 * partially-filled one is worse than a slower one, so `getBoard` returns every
 * visible list with its cards rather than making the client stitch a column at a
 * time.
 */
export type CardLabel = { id: number; name: string | null; color: string };
export type CardChecklistItem = { id: number; text: string; is_done: boolean; position: number };
export type CardAssignee = { user_id: number; user_name: string | null };
export type CardComment = {
  id: number;
  text: string;
  user_id: number;
  user_name: string | null;
  created_at: string;
};

export type BoardCard = {
  id: number;
  list_id: number;
  title: string;
  description: string | null;
  due_at: string | null;
  start_at: string | null;
  completed_at: string | null;
  google_event_id: string | null;
  source: string;
  position: number;
  created_at: string;
  updated_at: string;
  checklist: CardChecklistItem[];
  labels: CardLabel[];
  assignees: CardAssignee[];
  comment_count: number;
};

/** A card with its conversation. Only the detail panel asks for this. */
export type BoardCardDetail = BoardCard & { comments: CardComment[] };

export type BoardListView = {
  id: number;
  name: string;
  position: number;
  /** Stable slug — "inbox", "calendar", "trash" — that survives a rename. */
  role: string | null;
  is_system_default: boolean;
  cards: BoardCard[];
};

export type BoardMember = { user_id: number; user_name: string | null; role: string };

export type BoardSummary = {
  id: number;
  name: string;
  board_type: string;
  owner_user_id: number | null;
  /** "owner" | "admin" | "member" | "viewer" — what you may do here. */
  my_role: string;
  card_count: number;
};

export type BoardView = {
  id: number;
  name: string;
  board_type: string;
  owner_user_id: number | null;
  trash_purge_days: number | null;
  my_role: string;
  lists: BoardListView[];
  labels: CardLabel[];
  members: BoardMember[];
};

export type CalendarCard = {
  id: number;
  list_id: number;
  list_name: string;
  title: string;
  start_at: string | null;
  due_at: string;
  completed_at: string | null;
  labels: CardLabel[];
};

/** Every board you can open, personal first. Provisions yours on first call. */
export const getBoards = (): Promise<BoardSummary[]> => fetchAPI("/boards");
/** Your own board in full — the read MyUniverse opens with. */
export const getMyBoard = (): Promise<BoardView> => fetchAPI("/boards/mine");
export const getBoard = (boardId: number): Promise<BoardView> => fetchAPI(`/boards/${boardId}`);
/** Needs `boards.team`. Blank unless the GTD template is asked for. */
export const createBoard = (data: {
  name: string;
  use_gtd_template?: boolean;
  member_ids?: number[];
}): Promise<BoardSummary> =>
  fetchAPI("/boards", { method: "POST", body: JSON.stringify(data) });
export const updateBoard = (
  boardId: number,
  data: { name?: string; trash_purge_days?: number | null },
): Promise<BoardSummary> =>
  fetchAPI(`/boards/${boardId}`, { method: "PATCH", body: JSON.stringify(data) });
/** Team boards only — your own board is refused, since it would be reseeded. */
export const deleteBoard = (boardId: number) =>
  fetchAPI(`/boards/${boardId}`, { method: "DELETE" });

export const setBoardMember = (boardId: number, userId: number, role: string) =>
  fetchAPI(`/boards/${boardId}/members`, {
    method: "PUT",
    body: JSON.stringify({ user_id: userId, role }),
  });
export const removeBoardMember = (boardId: number, userId: number) =>
  fetchAPI(`/boards/${boardId}/members/${userId}`, { method: "DELETE" });

export const createBoardList = (boardId: number, name: string): Promise<BoardListView> =>
  fetchAPI(`/boards/${boardId}/lists`, { method: "POST", body: JSON.stringify({ name }) });
/** Renaming a seeded list keeps its `role`, so the Planner stays pointed at it. */
export const updateBoardList = (
  listId: number,
  data: { name?: string; is_archived?: boolean },
): Promise<BoardListView> =>
  fetchAPI(`/lists/${listId}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteBoardList = (listId: number) =>
  fetchAPI(`/lists/${listId}`, { method: "DELETE" });
/** Left-to-right order. Lists left out of the array keep their relative place. */
export const reorderBoardLists = (boardId: number, listIds: number[]) =>
  fetchAPI(`/boards/${boardId}/lists/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ list_ids: listIds }),
  });

export type CardDraft = {
  title: string;
  description?: string | null;
  due_at?: string | null;
  start_at?: string | null;
  source?: "manual" | "email" | "calendar_sync" | "ai_agent";
  label_ids?: number[];
  assignee_ids?: number[];
};

export const createCard = (listId: number, data: CardDraft): Promise<BoardCard> =>
  fetchAPI(`/lists/${listId}/cards`, { method: "POST", body: JSON.stringify(data) });
export const getCard = (cardId: number): Promise<BoardCardDetail> => fetchAPI(`/cards/${cardId}`);

/**
 * Partial edit. Omit a key to leave it alone; send null to clear it — the two
 * are distinguishable server-side, which is the only way a due date can be
 * removed rather than merely ignored.
 */
export type CardEdit = {
  title?: string;
  description?: string | null;
  due_at?: string | null;
  start_at?: string | null;
  is_complete?: boolean;
  label_ids?: number[];
  assignee_ids?: number[];
};
export const updateCard = (cardId: number, data: CardEdit): Promise<BoardCardDetail> =>
  fetchAPI(`/cards/${cardId}`, { method: "PATCH", body: JSON.stringify(data) });

/**
 * A drop: `position` is the destination index within the target list, not a sort
 * key. The server owns the ordering column, so two people dragging at once
 * cannot invent conflicting positions.
 */
export const moveCard = (cardId: number, listId: number, position: number): Promise<BoardCard> =>
  fetchAPI(`/cards/${cardId}/move`, {
    method: "PATCH",
    body: JSON.stringify({ list_id: listId, position }),
  });

/**
 * Sends the card to Trash, or deletes it for good if it is already there —
 * `trashed` in the reply says which happened, so the UI can word its own
 * feedback truthfully.
 */
export const deleteCard = (cardId: number): Promise<{ trashed: boolean }> =>
  fetchAPI(`/cards/${cardId}`, { method: "DELETE" });

/** The checklist calls all return the whole card, so the "0/1" badge cannot drift. */
export const addChecklistItem = (cardId: number, text: string): Promise<BoardCardDetail> =>
  fetchAPI(`/cards/${cardId}/checklist`, { method: "POST", body: JSON.stringify({ text }) });
export const updateChecklistItem = (
  itemId: number,
  data: { text?: string; is_done?: boolean },
): Promise<BoardCardDetail> =>
  fetchAPI(`/checklist/${itemId}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteChecklistItem = (itemId: number): Promise<BoardCardDetail> =>
  fetchAPI(`/checklist/${itemId}`, { method: "DELETE" });

export const createCardLabel = (
  boardId: number,
  data: { color: string; name?: string | null },
): Promise<CardLabel> =>
  fetchAPI(`/boards/${boardId}/labels`, { method: "POST", body: JSON.stringify(data) });
export const updateCardLabel = (
  labelId: number,
  data: { color?: string; name?: string | null },
): Promise<CardLabel> =>
  fetchAPI(`/labels/${labelId}`, { method: "PATCH", body: JSON.stringify(data) });
/** Deletes the label and takes it off every card that carried it. */
export const deleteCardLabel = (labelId: number) =>
  fetchAPI(`/labels/${labelId}`, { method: "DELETE" });

export const addCardComment = (cardId: number, text: string): Promise<BoardCardDetail> =>
  fetchAPI(`/cards/${cardId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
export const deleteCardComment = (commentId: number): Promise<BoardCardDetail> =>
  fetchAPI(`/comments/${commentId}`, { method: "DELETE" });

/**
 * Dated cards in a window, for the Planner grid. Every card with a due date, not
 * only the ones filed under Calendar — a card in Next Actions with a time on it
 * is exactly as scheduled as one in Calendar.
 *
 * Bounds are naive IST wall-clock (`YYYY-MM-DDTHH:mm:ss`), matching what the API
 * stores; `start` is inclusive and `end` exclusive.
 */
export const getBoardCalendar = (
  boardId: number,
  start: string,
  end: string,
): Promise<CalendarCard[]> =>
  fetchAPI(
    `/boards/${boardId}/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );

// --- Google Calendar ---------------------------------------------------------

/** One calendar the connected Google account can write to. */
export type GoogleCalendarChoice = { id: string; name: string; primary: boolean };

/**
 * The state of this account's Google Calendar link.
 *
 * `configured` and `connected` answer different questions and the UI must not
 * merge them: the first is whether this *server* has OAuth credentials at all,
 * which only whoever runs it can fix, and the second is whether *you* have
 * authorised. Merged, they would show a Connect button that cannot work.
 */
export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  google_email: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  pull_enabled: boolean;
  push_enabled: boolean;
  past_days: number;
  future_days: number;
  last_sync_at: string | null;
  last_sync_error: string | null;
};

export type GoogleSyncResult = {
  imported: number;
  updated_locally: number;
  removed_locally: number;
  exported: number;
  updated_remotely: number;
  removed_remotely: number;
  /** Per-item failures a sync carried on past. A run can succeed and still
   *  have failed to write some events, and saying so beats a silent green tick. */
  errors: string[];
  last_sync_at: string | null;
};

export const getGoogleCalendarStatus = (): Promise<GoogleCalendarStatus> =>
  fetchAPI("/integrations/google/status");

/** The connected account's writable calendars, for the picker. */
export const getGoogleCalendars = (): Promise<GoogleCalendarChoice[]> =>
  fetchAPI("/integrations/google/calendars");

/**
 * Where to send the browser for Google's consent screen.
 *
 * Returned rather than followed, because consent is a top-level navigation:
 * `fetch` would follow a redirect transparently and land Google's page inside
 * an XHR that cannot render it.
 */
export const startGoogleCalendarAuth = (): Promise<{ authorization_url: string }> =>
  fetchAPI("/integrations/google/authorize");

export const updateGoogleCalendarSettings = (data: {
  calendar_id?: string;
  pull_enabled?: boolean;
  push_enabled?: boolean;
  past_days?: number;
  future_days?: number;
}): Promise<GoogleCalendarStatus> =>
  fetchAPI("/integrations/google/settings", { method: "PATCH", body: JSON.stringify(data) });

/** Revokes the grant at Google and forgets it here. Imported cards are kept. */
export const disconnectGoogleCalendar = () =>
  fetchAPI("/integrations/google/connection", { method: "DELETE" });

/** Runs a sync now and answers with what it changed. */
export const syncGoogleCalendar = (): Promise<GoogleSyncResult> =>
  fetchAPI("/integrations/google/sync", { method: "POST" });
