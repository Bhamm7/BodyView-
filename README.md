# BodyView

A health and fitness tracker that installs as a PWA on your phone and runs in
any browser on your desktop.

Run it standalone and everything stays in that browser's own database. Point it
at your own machine — a Mac mini, a NAS, anything always-on — and your devices
share one **SQLite database** that you host, while each keeps a full local copy
so the app still works with no signal. There is no account and no third party
either way.

## What it does

| Section | What it covers |
| --- | --- |
| **Today** | Doses due, pinned metrics, calories and protein so far, and a one-tap way into a workout. |
| **Health** | Weight, body fat, blood pressure, resting HR, HRV, sleep, steps, waist, temperature, glucose, mood and energy — with trend charts, a real 7-day average, and change over 30d/90d/6m/1y. |
| **Cycles** | Peptides, PEDs, vitamins and supplements. A protocol is a compound plus a schedule; it drives a daily checklist, 30-day adherence, and the stock projections. |
| **Food** | Macro targets, a searchable food library, per-meal logging, and calorie/protein trends against target. |
| **Train** | Exercise library, a live session logger built for one-handed use between sets, personal records, estimated 1RM trends, weekly volume and sets per muscle group. |
| **Bloodwork** | Blood panels pasted from a lab report, uploaded as CSV, or typed in. Charts grouped so no plot ever carries two scales, reference bands from your own report, and a latest-vs-previous comparison. |
| **Calendar** | A month at a glance: which days had doses, workouts, meals and readings, plus which days a protocol schedules a dose on. Tap any day for the full picture. |
| **Stock** | What you have on the shelf, and when it runs out — worked out from your active protocols rather than entered by hand. |

### Bloodwork

Paste the results out of a patient portal (MyHealth Alberta, or any lab report)
and they are parsed into markers, values, units and the lab's own reference
ranges. Everything goes through a review table before it is saved — lab reports
have no standard format, so the parser is a first pass you confirm, and any
line it could not read is shown rather than dropped.

Marker names are matched on the whole name, never a substring: reading
"Reticulocyte Haemoglobin" as plain haemoglobin would file it into the wrong
series and quietly corrupt a chart, so an unrecognised marker is kept under its
printed name instead.

Charts group markers by unit. Two markers share a plot only when they share a
unit — a chart with two y-scales invites false comparisons — so testosterone
and SHBG (both nmol/L) sit together while estradiol (pmol/L) gets its own. A
group with more than six markers becomes small multiples rather than an
unreadable tangle.

Reference ranges printed on your report are stored with the result and always
beat the built-in ones, which are shown as "typical" and are for orientation
only. BodyView does not interpret results.

### Scheduling and stock projection

A protocol's schedule is one of three shapes, which between them cover how these
things are actually dosed:

- **Interval** — every day, every other day, every third day…
- **Weekdays** — specific days, e.g. Monday and Thursday
- **On / off** — 5 days on, 2 days off, repeating from the start date

plus a doses-per-day count for anything split across the day.

Stock projection simulates the calendar **day by day** rather than dividing by an
average, so an every-other-day or 5-on/2-off protocol lands on the correct
run-out date. Doses are converted into the stock's unit (250 mcg draws 0.25 mg
from a 5 mg vial); where a conversion isn't defined — IU against milligrams,
which depends on the compound — the projection says so rather than guessing.
Logging a dose draws it out of stock automatically and opens a sealed spare when
the current one runs dry.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run serve` | Runs the server: the built app plus the sync API and SQLite |
| `npm run build` | Typecheck and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests for the scheduling, projection, stats and formatting logic |
| `npm run smoke` | Drives the built app in a real browser through every core flow |
| `npm run smoke:sync` | Two browser profiles against a real server: shared data, deletions, offline catch-up |
| `npm run smoke:forms` | The stock and protocol sheets: validation, and the per-week/per-dose switch |
| `npm run smoke:blood` | Importing a lab report through to charts and comparisons |
| `npm run smoke:tags` | Naming and tagging a session, and calendar legend consistency |
| `npm run serve` | Serves a built `dist/` with the dependency-free static server |
| `npm run icons` | Regenerates the PWA icon set |

## Installing on your phone

A PWA needs an HTTPS origin, so serve the build from somewhere with a
certificate. Two routes:

- **Self-host it** on a machine you already leave running — see
  [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) for a macOS launchd service plus
  Tailscale for HTTPS. `npm run serve` runs the same dependency-free static
  server by hand.
- **GitHub Pages** — the included workflow publishes on every push to `main`;
  enable it once under **Settings → Pages → Source: GitHub Actions**.

Then, on the phone:

- **iOS** — open the URL in Safari, then Share → *Add to Home Screen*
- **Android** — open in Chrome, then the menu → *Install app*

It works offline once installed; the service worker caches the app and updates
it in the background.

To try it on your phone against the dev server on the same Wi-Fi, run
`npm run dev -- --host` and open the network URL it prints. Note that iOS will
not offer *Add to Home Screen* as a real install over plain HTTP.

## Sharing data between devices

Run the server somewhere always-on and every device syncs to one SQLite
database — see [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md). Each device still
keeps a full local copy, so you can log a workout with no signal and it
reconciles when you're back. Where the same record is edited in two places, the
later edit wins; deletions travel as tombstones so nothing reappears.

Connect a device in **Settings → Sync**.

Without a server, storage is per-device: **Settings → Export backup** writes a
single JSON file, and **Import backup** reads it back, replacing or merging.

On the same screen, *Ask the browser to keep this data* requests persistent
storage, which stops the browser evicting the local copy when space runs low.

### About Apple Health

iOS doesn't expose HealthKit to web apps, so there is no way for a PWA to read
it directly — hence manual entry for now. A native wrapper (or a Shortcuts
automation writing into the JSON import format) is the realistic route if you
want that later; the importer already accepts the full data shape.

## How it's built

- **React 19 + TypeScript**, built by **Vite**, routed with hash-based routing so
  it deep-links from any static host with no server rewrites
- **Dexie** over IndexedDB for the on-device copy, with `dexie-react-hooks` so
  every screen updates live as data changes
- **SQLite** on the server via Node's built-in `node:sqlite`, so the server has
  no dependencies at all — one table per collection plus views that flatten the
  JSON into columns for querying by hand
- **Recharts** for charts, loaded only on the routes that use one — the entry
  bundle stays around 140 KB gzipped and the charting library arrives on demand
- **No CSS framework.** A small design-token system in `src/styles/global.css`,
  dark-first with a light theme, safe-area aware, bottom tabs on phones and a
  sidebar on desktop

```
server/     Static server, sync API and SQLite storage (no dependencies)
src/
  db/         Dexie schema, domain types, metric catalogue, seed data
  lib/        Scheduling, stock projection, stats, training and nutrition maths
  components/ Shared UI, charts, and the entry sheets
  pages/      One file per screen
  hooks/      Live queries
```

The business logic lives in `src/lib/` as pure functions, separate from the UI,
which is what makes it testable — `npm test` covers dose scheduling, adherence,
stock burn-down, unit conversion, trend maths, number formatting, and the
server's merge and cursor rules.

### Chart conventions

One y-axis per chart, never two scales. A legend whenever a chart carries more
than one series, so identity is never colour alone. The categorical palette is
validated for contrast and colour-vision separation against the app's dark
surface. Axis precision follows the data range, so a 1 kg spread doesn't render
as three identical labels.

## A note on what this is

BodyView records what you tell it and does the arithmetic. It does not
recommend doses, interpret readings, or give medical advice, and the reference
ranges shown on some charts are common published figures for context only.
Anything that matters medically is a conversation with a clinician.
