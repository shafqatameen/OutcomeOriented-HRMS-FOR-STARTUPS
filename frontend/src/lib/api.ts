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

export const getLeaderboard = () => fetchAPI("/leaderboard");
export const getTasks = () => fetchAPI("/tasks");
export const getCategories = () => fetchAPI("/categories");
export const getUsers = () => fetchAPI("/users");
export const completeTask = (taskId: number) => fetchAPI(`/tasks/${taskId}/complete`, { method: "POST" });
export const createTask = (data: any) => fetchAPI("/tasks", { method: "POST", body: JSON.stringify(data) });
export const createCategory = (data: any) => fetchAPI("/categories", { method: "POST", body: JSON.stringify(data) });
export const updateCategory = (categoryId: number, data: any) =>
  fetchAPI(`/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(data) });
export const login = (name: string, password: string) =>
  fetchAPI("/auth/login", { method: "POST", body: JSON.stringify({ name, password }) });
export const logout = () => fetchAPI("/auth/logout", { method: "POST" });
export const getMe = () => fetchAPI("/auth/me");
export const getLoginOptions = () => fetchAPI("/auth/login-options");
export const getGoals = () => fetchAPI("/goals");
export const createGoal = (data: any) => fetchAPI("/goals", { method: "POST", body: JSON.stringify(data) });
export const getMilestones = () => fetchAPI("/milestones");
export const createMilestone = (data: any) => fetchAPI("/milestones", { method: "POST", body: JSON.stringify(data) });
export const completeMilestone = (milestoneId: number) => fetchAPI(`/milestones/${milestoneId}`, { method: "PATCH", body: JSON.stringify({ status: "Completed" }) });
export const getChartData = (categoryId?: number | string, startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (categoryId) params.append("category_id", categoryId.toString());
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchAPI(`/chart-data${query}`);
};
