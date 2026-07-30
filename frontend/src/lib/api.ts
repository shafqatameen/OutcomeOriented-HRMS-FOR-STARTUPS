const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const fetchAPI = async (endpoint: string, options: RequestInit = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (body?.detail) detail = body.detail;
    } catch {}
    throw new Error(detail);
  }

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

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (body?.detail) detail = body.detail;
    } catch {}
    throw new Error(detail);
  }

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
export const completeTask = (taskId: number) => fetchAPI(`/tasks/${taskId}/complete`, { method: "POST" });
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
export const createCategory = (data: any) => fetchAPI("/categories", { method: "POST", body: JSON.stringify(data) });
export const updateCategory = (categoryId: number, data: any) =>
  fetchAPI(`/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(data) });
export const login = (name: string, password: string) =>
  fetchAPI("/auth/login", { method: "POST", body: JSON.stringify({ name, password }) });
export const logout = () => fetchAPI("/auth/logout", { method: "POST" });
export const getMe = () => fetchAPI("/auth/me");
export const getPermissionCatalogue = () => fetchAPI("/users/access/catalogue");
export const getUserAccess = () => fetchAPI("/users/access");
/** Replaces one account's grants with exactly this set. */
export const setUserAccess = (userId: number, permissions: string[]) =>
  fetchAPI(`/users/${userId}/access`, { method: "PUT", body: JSON.stringify({ permissions }) });
export const getLoginOptions = () => fetchAPI("/auth/login-options");
export const getGoals = () => fetchAPI("/goals");
export const createGoal = (data: any) => fetchAPI("/goals", { method: "POST", body: JSON.stringify(data) });
export const getMilestones = () => fetchAPI("/milestones");
export const createMilestone = (data: any) => fetchAPI("/milestones", { method: "POST", body: JSON.stringify(data) });
export const completeMilestone = (milestoneId: number) => fetchAPI(`/milestones/${milestoneId}`, { method: "PATCH", body: JSON.stringify({ status: "Completed" }) });
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

export const getChartData = (categoryId?: number | string, startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (categoryId) params.append("category_id", categoryId.toString());
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/chart-data${query}`);
};
