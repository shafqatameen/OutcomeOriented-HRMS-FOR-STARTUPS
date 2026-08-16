import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Every dropdown in the app was a bare `<select>` carrying its own copy of
 * `border rounded p-2 bg-white dark:bg-slate-900` - a cool-grey fill in a
 * warm-neutral palette, at a height and radius that matched nothing else on
 * the form. This is the same native element, wearing the Input primitive's
 * metrics so a select and a text field sitting side by side line up.
 *
 * Exported as a class string as well as a component: a few call sites build
 * their own `<select>` (multi-selects, filter bars with extra width caps) and
 * only need the styling.
 *
 * Width is deliberately absent. Form selects want `w-full`; the ones in a
 * filter bar want to size to their content, and baking `w-full` in here would
 * blow those rows apart.
 */
const selectClassName =
  "h-8 min-w-0 rounded-md border border-input bg-transparent px-2 py-1 text-sm transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30"

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(selectClassName, className)}
      {...props}
    />
  )
}

export { Select, selectClassName }
