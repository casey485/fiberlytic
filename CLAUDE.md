# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fiberlytic is a single-page React app for managing fiber-optic construction
operations (projects, crews, production, P&L, materials, photos, invoicing) for a
fiber contractor. It is **frontend-only** — all data lives in the browser's
`localStorage`; there is no server or database.

## Commands

```bash
npm install        # first-time setup
npm run dev        # Vite dev server at http://localhost:5173 (opens browser)
npm run build      # tsc -b then vite build → dist/
npm run preview    # serve the production build
npm run lint       # eslint (ts/tsx, max-warnings 0)
npm run typecheck  # tsc --noEmit
```

There is no test suite yet. TypeScript runs in `strict` mode with
`noUnusedLocals`/`noUnusedParameters`, so unused imports/vars fail the build —
keep imports tight.

## Architecture

Everything flows through a single client-side store. Understand these three files
before changing behavior:

- **`src/types.ts`** — the entire domain model (`Project`, `Crew`,
  `ProductionEntry`, `PnLEntry`, `Material`, `Photo`, `Invoice`) plus the
  top-level `AppData` shape. Dates are ISO `"YYYY-MM-DD"` strings (sort lexically,
  serialize cleanly). All ids are strings.

- **`src/store/DataContext.tsx`** — the source of truth. `DataProvider` loads
  `AppData` from `localStorage` (key `fiberlytic:data:v1`), falling back to the
  generated seed, and persists on every change via `useEffect`. Every component
  reads and mutates state **only** through the `useData()` hook, which exposes
  `data` plus CRUD methods. Two important side effects live here, not in pages:
  - `addProduction` also appends a rough `PnLEntry` so the money views stay in sync.
  - Adding/deleting production recomputes each project's `footageComplete`
    (`recomputeFootage`); completed projects are pinned at their goal.
  To swap in a real backend, change only this file — pages are agnostic.

- **`src/data/seed.ts`** — `generateSeedData()` builds a believable ~6-week
  snapshot **relative to today** (production + daily P&L are synthesized from
  per-project economics in `projectEconomics`, weekdays only). Runs once on first
  load, then never again unless the user clicks "Reset sample data".

### Derived data

Pages never recompute aggregates ad hoc — shared selectors live in
**`src/lib/analytics.ts`** (`summarizePnl`, `dailyPnlSeries`,
`dailyProductionSeries`, `withinDays`, `projectProgress`, `footageByCrew`,
`pnlCost`/`pnlProfit`). Add new cross-page metrics here. Formatting
(currency, dates, percent) and status→label/badge-tone maps live in
**`src/lib/format.ts`**.

### UI structure

- `src/App.tsx` — routes. Each nav item maps to one page in `src/pages/`; there is
  also a `/projects/:id` detail route (`ProjectDetail.tsx`).
- `src/components/Layout.tsx` — sidebar nav + topbar shell; the nav array here is
  the single place to register a new page.
- `src/components/ui/` — shared primitives (`Card`, `StatCard`, `Badge`, `Modal`,
  `PageHeader`, and form controls in `Form.tsx`: `Field`/`Input`/`Select`/
  `Textarea`/`Button`). Reuse these rather than hand-rolling styled elements.
- Styling is Tailwind only. Brand palette: `brand-*` (blue) and `fiber-*` (cyan)
  defined in `tailwind.config.js`. Progress bars use `bg-fiber-500`.

## PDF Print Reader + KMZ Builder

A self-contained feature under **`src/features/printkmz/`** plus two pages
(`PrintReader.tsx`, `PrintReview.tsx`) and two components (`MapView.tsx`,
`ObjectEditorDrawer.tsx`). It is **independent of the main `DataContext` store** —
it has its own external store and persistence.

Pipeline (all client-side, runs in the browser):
`pdf.ts` renders PDF pages to images (pdfjs-dist; the worker is wired via Vite's
`?url` import) → `ocr.ts` runs tesseract.js and parses structured fields
(project/streets/sheets/stations/footage/notes via regex) → `detect.ts` proposes
field objects heuristically from OCR tokens (it does NOT do raster symbol
recognition — it counts keyword/abbreviation hits and seeds candidates in a grid
near the session center for the user to drag into place).

- **`store.ts`** — external store via `useSyncExternalStore`, persisted to
  `localStorage` (`fiberlytic:printkmz:v1`). Full-res page images are large and
  are kept **only in the in-memory `pageImageCache`**, never persisted; only
  downscaled `thumbnails` are saved.
- **`supabase.ts`** — optional. Client is `null` unless `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY` are set; `saveSession` then returns `{offline:true}`
  and the app keeps working on localStorage. SQL in `supabase/schema.sql`.
- **`MapView.tsx`** — Mapbox GL (v3, bundled types — do NOT add `@types/mapbox-gl`).
  Renders a placeholder + editable list when `VITE_MAPBOX_TOKEN` is unset. Markers
  are draggable; drag updates object position.
- **`kmz.ts`** — builds KML (points, or LineString when `path` is set) and zips to
  `.kmz` with JSZip for download.

Env vars are typed in `src/vite-env.d.ts` and documented in `.env.example`. All
keys are optional — the feature degrades gracefully without them.

## Conventions

- New entity field → update `src/types.ts`, the seed, and any create-modal form.
- New page → add the page component, a `<Route>` in `App.tsx`, and an entry in the
  `nav` array in `Layout.tsx`.
- Charts use Recharts; follow the existing axis/tooltip styling for consistency.
- Money is integer-ish USD; use `money()` (no cents) for dashboards and
  `moneyExact()` (cents) for invoices/line items.
