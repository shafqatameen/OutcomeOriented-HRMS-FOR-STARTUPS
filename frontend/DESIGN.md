# OutcomeOriented — Design System

A Y Combinator / Hacker News–style visual language: dense, plain, fast, and
unmistakably utilitarian. The design gets out of the way of the data.

---

## 1. Principles

1. **Information density over whitespace.** A user should see the whole
   leaderboard without scrolling. Padding is a last resort, not a default.
2. **One accent color, used sparingly.** Orange marks the primary action and
   the active brand element. Everything else is black, gray, or beige.
3. **No decoration.** No gradients, no drop shadows, no glassmorphism, no
   animated flourishes. Borders and background fills do all the separating.
4. **Sharp corners.** Radius is 2–3px, never pill-shaped. Rounded-full is
   reserved for nothing.
5. **Text is the interface.** Prefer a labeled link or a plain bordered button
   over an icon-only control. Icons support words; they don't replace them.
6. **Instant.** No skeleton shimmer, no page transitions. Render the data.

---

## 2. Color

The palette is warm-neutral: HN beige page, white cards, YC orange accent.

### Light

| Token | Value | Use |
|---|---|---|
| `background` | `#f6f6ef` | Page background (HN beige) |
| `foreground` | `#1a1a1a` | Body text |
| `card` | `#ffffff` | Card / panel surface |
| `card-foreground` | `#1a1a1a` | Text on cards |
| `primary` | `#ff6600` | Primary buttons, brand, active nav |
| `primary-foreground` | `#ffffff` | Text on orange |
| `secondary` | `#eeeee6` | Secondary button fill |
| `secondary-foreground` | `#1a1a1a` | Text on secondary |
| `muted` | `#f0f0e8` | Zebra rows, inert fills |
| `muted-foreground` | `#828282` | Meta text, timestamps, "assigned to" |
| `border` | `#dcdcd2` | All borders and dividers |
| `input` | `#dcdcd2` | Field borders |
| `ring` | `#ff6600` | Focus ring |
| `destructive` | `#cc0000` | Destructive actions, errors |
| `success` | `#008000` | Completed states, positive deltas |

### Dark

| Token | Value |
|---|---|
| `background` | `#1a1a1a` |
| `foreground` | `#e8e8e8` |
| `card` | `#222222` |
| `primary` | `#ff6600` |
| `secondary` | `#2a2a2a` |
| `muted` | `#262626` |
| `muted-foreground` | `#9a9a9a` |
| `border` | `#333333` |
| `destructive` | `#ef4444` |
| `success` | `#3fb950` |

### Rules

- Orange is for **one** thing per screen: the primary action. Two orange
  buttons competing in a card means one of them is wrong.
- Never put orange text on beige — it fails contrast at body sizes. Orange is
  a *fill* color with white text, or a large brand mark.
- Completed/positive uses `success` green; it never uses orange.

---

## 3. Typography

Verdana is the HN signature and reads well at small sizes. Base is **13px**,
which is deliberately smaller than the modern 16px default.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | 18px | 700 | One per page, left-aligned |
| Card title | 13px | 700 | Same size as body — weight carries it |
| Body | 13px | 400 | Default |
| Meta / secondary | 11px | 400 | `muted-foreground` |
| Numeric display | 20px | 700 | Point totals, ranks only |

- Line height `1.4` for body, `1.2` for titles.
- No letter-spacing adjustments. No uppercase transforms except short badges.
- Numbers in tables should be tabular: `font-variant-numeric: tabular-nums`.

---

## 4. Layout & density

- **Page max width: `960px`**, left-aligned within the viewport, `16px` side
  padding. Do not center content in a `max-w-4xl` island with huge margins.
- **Vertical rhythm:** `12px` between cards, `8px` between rows inside a card.
- **Card padding:** `12px`. Header and body use the same padding; no extra
  header block spacing.
- **Table rows:** `28px` tall, `6px` vertical cell padding. Zebra-stripe with
  `muted` on odd rows instead of drawing row borders.
- **Nav bar:** solid `primary` orange, `28px` tall, white text, brand mark on
  the left, user + logout on the right. This is the single largest block of
  color in the app.

---

## 5. Components

Mapped to the existing components in [src/components/ui/](src/components/ui/).

### Button — [button.tsx](src/components/ui/button.tsx)
- **default:** orange fill, white text, `2px` radius, `1px` transparent border.
  Hover darkens to `#e65c00` — no opacity tricks.
- **outline:** transparent fill, `border` stroke, `foreground` text. Hover
  fills with `muted`.
- **destructive:** `destructive` text on transparent, red border. Reserve the
  solid red fill for confirmation dialogs only.
- Height `24px` for `sm`, `28px` default. Padding `8px` horizontal.

### Card — [card.tsx](src/components/ui/card.tsx)
`card` background, `1px solid border`, `3px` radius, **no shadow**. The title
sits directly above content with a `1px` bottom divider, not a padding gap.

### Badge — [badge.tsx](src/components/ui/badge.tsx)
`11px`, uppercase, `2px` radius, `1px` border, `2px 6px` padding.
- Completed → `success` text on transparent with green border.
- Counts (`3/5 tasks`) → `muted-foreground` on transparent with gray border.
- Rank 1/2/3 → solid fills; everything below rank 3 is a plain number, not a
  badge.

### Input / Select — [input.tsx](src/components/ui/input.tsx)
`28px` tall, `1px solid input` border, `2px` radius, white fill, `13px` text.
Focus: `1px` orange border plus a `2px` orange ring. No glow.

### Table — [table.tsx](src/components/ui/table.tsx)
Header row: `muted` fill, `11px`, bold, `border` bottom. Body rows zebra-striped.
Right-align all numeric columns. This is the densest element in the app and
should feel like a spreadsheet, not a report.

### Progress bar (Goals)
`4px` tall, `2px` radius, `muted` track. Fill is `success` at 100%, otherwise
`primary`. No gradient, no animated stripe, no percentage label inside the bar
— put the number beside it at `11px`.

---

## 6. Page application

**Login (`/login`)** — Also the app's landing page, and the only public,
indexable route. Full `960px` measure, left-aligned: brand mark, one `h1`, a
lead paragraph, then two columns — a dense bordered feature list on the left,
the `320px` sign-in card on the right (sticky on desktop). Stacks on narrow
screens with the card *first*, since a returning user should not scroll past
the pitch to sign in.

The orange rule still holds: the "Sign in" button is the only orange fill on
the page. The brand mark is the one permitted orange text, at heading size.
Feature rows separate with `1px` dividers — no cards, no shadows, no icons
larger than `16px`. This page describes a product; it is not an advertisement
for one.

> This replaces the earlier "single centered card, nothing else on the screen"
> spec. The page took on the job of explaining the app to someone who has never
> seen it, which the bare card could not do.

**Leaderboard (`/`)** — Chart card first, then the point matrix table. Chart
lines use the categorical palette below, `2px` stroke, no area fill, no
rounded caps. Grid lines `border` at `1px` dashed.

**Tasks (`/tasks`)** — Two columns (Adjacent / Core) as dense bordered lists,
not spacious cards. Each row: title + point value inline, assignee as `11px`
meta beneath, Complete button right-aligned. Task History collapses to a
muted, struck-through list.

**Goals (`/goals`)** — Goal title with a count badge, progress bar, then
milestones indented under a `2px` left rule. Milestone rows are `28px` and
never wrap.

**Admin (`/admin`)** — Stacked forms in plain cards. Labels above inputs at
`11px` bold. Forms are functional, not styled — this page should look like
a database front end, because it is one.

### Chart palette
Orange leads, then distinguishable non-orange hues:
`#ff6600`, `#0066cc`, `#008000`, `#8b5cf6`, `#cc0000`.
Each series also gets a distinct dot shape so the chart survives grayscale.

---

## 7. Implementation

The project uses Tailwind v4, so tokens belong in `@theme inline` in
[src/app/globals.css](src/app/globals.css). Drop-in block:

```css
@import "tailwindcss";

:root {
  --radius: 2px;
  --background: #f6f6ef;
  --foreground: #1a1a1a;
  --card: #ffffff;
  --card-foreground: #1a1a1a;
  --popover: #ffffff;
  --popover-foreground: #1a1a1a;
  --primary: #ff6600;
  --primary-foreground: #ffffff;
  --secondary: #eeeee6;
  --secondary-foreground: #1a1a1a;
  --muted: #f0f0e8;
  --muted-foreground: #828282;
  --accent: #f0f0e8;
  --accent-foreground: #1a1a1a;
  --destructive: #cc0000;
  --destructive-foreground: #ffffff;
  --success: #008000;
  --border: #dcdcd2;
  --input: #dcdcd2;
  --ring: #ff6600;
}

.dark {
  --background: #1a1a1a;
  --foreground: #e8e8e8;
  --card: #222222;
  --card-foreground: #e8e8e8;
  --popover: #222222;
  --popover-foreground: #e8e8e8;
  --primary: #ff6600;
  --primary-foreground: #ffffff;
  --secondary: #2a2a2a;
  --secondary-foreground: #e8e8e8;
  --muted: #262626;
  --muted-foreground: #9a9a9a;
  --accent: #2a2a2a;
  --accent-foreground: #e8e8e8;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --success: #3fb950;
  --border: #333333;
  --input: #333333;
  --ring: #ff6600;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --font-sans: Verdana, Geneva, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;

  --radius-sm: 2px;
  --radius-md: 2px;
  --radius-lg: 3px;
}

@layer base {
  * { border-color: var(--border); }

  body {
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.4;
  }

  table { font-variant-numeric: tabular-nums; }
}
```

> The `@import "tailwindcss"` line is load-bearing. Without it every utility
> class in the app resolves to nothing and the site renders unstyled.

---

## 8. Don't

- Don't add shadows to lift cards. Use a border.
- Don't introduce a second accent color. If something needs to stand out next
  to an orange button, make the orange button the only orange thing.
- Don't increase base font size to 14/16px. The density is the design.
- Don't use pill-shaped buttons or `rounded-full` anything.
- Don't center-align body text or tables.
- Don't animate anything longer than `100ms`, and only for hover color.
