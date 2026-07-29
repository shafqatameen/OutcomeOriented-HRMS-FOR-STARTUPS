import { Inter } from "next/font/google"
import { cn } from "@/lib/utils"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-h-screen bg-background text-foreground", inter.className)}>
      <header className="border-b bg-card/50 backdrop-blur supports-backdrop-blur:bg-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold">Admin Dashboard</h1>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
