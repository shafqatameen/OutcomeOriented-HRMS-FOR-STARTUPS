import { requireUser } from "@/lib/session";
import GoalsClient from "./GoalsClient";

export default async function Page() {
  const user = await requireUser();
  return <GoalsClient />;
}
