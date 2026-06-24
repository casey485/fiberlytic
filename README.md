# Fiberlytic

Operations & analytics platform for fiber-optic construction contractors. Track
builds, crews, daily production, profitability, materials, field photos, and
invoicing in one place.

Built for [NextGen Fiber LLC](mailto:casey@nextgenfiberllc.com).

## Features

- **Dashboard** — live KPIs (active projects, footage, revenue, margin), production
  and revenue-vs-cost charts, reorder/invoice alerts, project progress.
- **Projects** — every build with status, % complete, contract value, and live
  profit; drill into a project for production history, financials, and invoices.
- **Crews** — field teams, day rates, current assignment, and 14-day productivity
  (footage + ft/hr).
- **Production tracking** — log daily footage placed/spliced per crew per project;
  trend chart and full production log.
- **Daily P&L** — revenue, cost, profit, and margin by day with a daily ledger and
  profit trend. Filter by project and date range.
- **Materials** — inventory on hand, valuation, reorder alerts, and quick quantity
  adjustments.
- **Photos** — field documentation gallery (before / progress / after / issue /
  safety) with in-browser upload.
- **Invoicing** — create line-item invoices, track draft → sent → paid → overdue,
  and see outstanding/collected totals.

## Tech stack

React 18 · TypeScript · Vite · Tailwind CSS · React Router · Recharts ·
lucide-react. Data is stored in the browser (`localStorage`) — no backend needed.

## Getting started

```bash
npm install
npm run dev        # start the dev server at http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Data & persistence

On first load the app seeds a realistic ~6-week dataset (see `src/data/seed.ts`)
and persists all state to `localStorage` under the key `fiberlytic:data:v1`.
Use **Reset sample data** in the sidebar to regenerate the seed and discard local
changes.

To start from a real backend later, replace the read/write internals of
`src/store/DataContext.tsx` — the rest of the app consumes data only through the
`useData()` hook, so pages don't need to change.
