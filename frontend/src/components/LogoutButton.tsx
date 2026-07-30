"use client";
import { logout } from "@/lib/api";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LogoutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error(err);
    }
    window.location.href = "/";
  };

  return (
    <button
      onClick={handleLogout}
      title={iconOnly ? "Logout" : undefined}
      className={cn(
        "flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground",
        iconOnly && "justify-center",
      )}
    >
      <LogOut className="h-4 w-4 shrink-0" />
      <span className={cn(iconOnly && "sr-only")}>Logout</span>
    </button>
  );
}
