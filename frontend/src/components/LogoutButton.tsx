"use client";
import { logout } from "@/lib/api";
import { LogOut } from "lucide-react";

export default function LogoutButton() {
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
      className="font-medium text-foreground hover:text-primary flex items-center gap-1 text-sm"
    >
      <LogOut className="w-4 h-4" />
      Logout
    </button>
  );
}
