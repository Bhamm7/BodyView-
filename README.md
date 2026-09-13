# BodyView

A local-first health and fitness tracker that installs as a PWA on your phone
and runs in any browser on your desktop.

Everything you enter is stored in the browser's own database on the device you
enter it on. There is no account, no server, and nothing is uploaded.

## What it does

| Section | What it covers |
| --- | --- |
| **Today** | Doses due, pinned metrics, calories and protein so far, and a one-tap way into a workout. |
| **Health** | Weight, body fat, blood pressure, resting HR, HRV, sleep, steps, waist, temperature, glucose, mood and energy — with trend charts, a real 7-day average, and change over 30d/90d/6m/1y. |
| **Cycles** | Peptides, PEDs, vitamins and supplements. A protocol is a compound plus a schedule; it drives a daily checklist, 30-day adherence, and the stock projections. |
| **Food** | Macro targets, a searchable food library, per-meal logging, and calorie/protein trends against target. |
| **Train** | Exercise library, a live session logger built for one-handed use between sets, personal records, estimated 1RM trends, weekly volume and sets per muscle group. |
| **Calendar** | A month at a glance: which days had doses, workouts, meals and readings, plus which days a protocol schedules a dose on. Tap any day for the full picture. |
| **Stock** | What you have on the shelf, and when it runs out — worked out from your active protocols rather than entered by hand. |

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
| `npm run build` | Typecheck and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests for the scheduling, projection, stats and formatting logic |
| `npm run smoke` | Drives the built app in a real browser through every core flow |
| `npm run icons` | Regenerates the PWA icon set |

## Installing on your phone

A PWA needs an HTTPS origin, so serve the build from somewhere with a
certificate. The included GitHub Actions workflow publishes to GitHub Pages on
every push to `main` — enable it once under **Settings → Pages → Source: GitHub
Actions**. Then, on the phone:

- **iOS** — open the URL in Safari, then Share → *Add to Home Screen*
- **Android** — open in Chrome, then the menu → *Install app*

It works offline once installed; the service worker caches the app and updates
it in the background.

To try it on your phone against the dev server on the same Wi-Fi, run
`npm run dev -- --host` and open the network URL it prints. Note that iOS will
not offer *Add to Home Screen* as a real install over plain HTTP.

## Moving data between devices

Storage is per-device and per-browser, so your phone and your desktop each hold
their own copy. **Settings → Export backup** writes a single JSON file with
everything in it; **Import backup** reads it back, either replacing what is
there or merging into it. That is also the way to get a copy off a device before
clearing its browser data.

On the same screen, *Ask the browser to keep this data* requests persistent
storage, which stops the browser evicting the database when space runs low.
Worth doing on your main device.

### About Apple Health

iOS doesn't expose HealthKit to web apps, so there is no way for a PWA to read
it directly — hence manual entry for now. A native wrapper (or a Shortcuts
automation writing into the JSON import format) is the realistic route if you
want that later; the importer already accepts the full data shape.

## How it's built

- **React 19 + TypeScript**, built by **Vite**, routed with hash-based routing so
  it deep-links from any static host with no server rewrites
- **Dexie** over IndexedDB for storage, with `dexie-react-hooks` so every screen
  updates live as data changes
- **Recharts** for charts, loaded only on the routes that use one — the entry
  bundle stays around 140 KB gzipped and the charting library arrives on demand
- **No CSS framework.** A small design-token system in `src/styles/global.css`,
  dark-first with a light theme, safe-area aware, bottom tabs on phones and a
  sidebar on desktop

```
src/
  db/         Dexie schema, domain types, metric catalogue, seed data
  lib/        Scheduling, stock projection, stats, training and nutrition maths
  components/ Shared UI, charts, and the entry sheets
  pages/      One file per screen
  hooks/      Live queries
```

The business logic lives in `src/lib/` as pure functions, separate from the UI,
which is what makes it testable — `npm test` covers dose scheduling, adherence,
stock burn-down, unit conversion, trend maths and number formatting.

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
