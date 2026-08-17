import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/session";
import { getPillarsServer } from "@/lib/server-api";
import NoAccess from "@/components/NoAccess";
import PillarsClient from "../PillarsClient";

/** Tab title from the pillar's name. Reuses the page's own memoized fetch. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ pillarId: string }>;
}): Promise<Metadata> {
  const { pillarId } = await params;
  const pillar = (await getPillarsServer()).find((row) => row.id === Number(pillarId));
  return pillar ? { title: pillar.name } : {};
}

/**
 * One pillar's functions. The name is resolved server-side so the heading is
 * right on first paint, and an unknown id 404s instead of rendering an empty
 * sheet that would read as "this pillar has no work".
 */
export default async function PillarPage({
  params,
}: {
  params: Promise<{ pillarId: string }>;
}) {
  const user = await requireUser();
  if (!can(user, "panel.view")) return <NoAccess feature="Pillars" />;
  const { pillarId } = await params;

  const id = Number(pillarId);
  if (!Number.isInteger(id)) notFound();

  const pillars = await getPillarsServer();
  const pillar = pillars.find((row) => row.id === id);
  if (!pillar) notFound();

  return (
    <PillarsClient
      self={{ id: user.id, name: user.name }}
      canViewAll={can(user, "panel.view.all")}
      pillarId={id}
      pillarName={pillar.name}
    />
  );
}
