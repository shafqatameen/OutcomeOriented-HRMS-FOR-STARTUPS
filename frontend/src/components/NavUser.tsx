import { getCurrentUser } from "@/lib/session";
import LogoutButton from "@/components/LogoutButton";
import { LogIn } from "lucide-react";

export default async function NavUser() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <a href="/login" className="font-medium text-foreground hover:text-primary flex items-center gap-2 text-sm">
        <LogIn className="w-4 h-4" />
        Login
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-500">{user.name.toUpperCase()} ({user.role})</span>
      <LogoutButton />
    </div>
  );
}
