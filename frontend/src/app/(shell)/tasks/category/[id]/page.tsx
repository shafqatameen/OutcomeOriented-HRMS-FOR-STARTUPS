import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/session";
import { getCategoriesServer } from "@/lib/server-api";
import NoAccess from "@/components/NoAccess";
import TasksClient from "../../TasksClient";

/** Tab title from the category's name. Reuses the page's own memoized fetch. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const category = (await getCategoriesServer()).find((c) => c.id === Number(id));
  return category ? { title: category.name } : {};
}

/**
 * One category's tasks. The name is resolved server-side so the heading is right
 * on first paint, and an unknown id 404s instead of rendering an empty board.
 */
export default async function TasksCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user, "tasks.view")) return <NoAccess feature="Tasks" />;
  const { id } = await params;

  const categoryId = Number(id);
  if (!Number.isInteger(categoryId)) notFound();

  const categories = await getCategoriesServer();
  const category = categories.find((c) => c.id === categoryId);
  if (!category) notFound();

  return (
    <TasksClient
      view={{ kind: "category", categoryId, categoryName: category.name }}
      canManage={can(user, "admin.tasks")}
    />
  );
}
