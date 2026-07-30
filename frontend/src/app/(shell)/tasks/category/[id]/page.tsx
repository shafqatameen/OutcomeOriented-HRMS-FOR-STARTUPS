import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/session";
import { getCategoriesServer } from "@/lib/server-api";
import NoAccess from "@/components/NoAccess";
import TasksClient from "../../TasksClient";

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
    <TasksClient view={{ kind: "category", categoryId, categoryName: category.name }} />
  );
}
