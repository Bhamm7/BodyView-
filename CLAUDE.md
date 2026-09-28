# BodyView

A personal health and fitness PWA. React 19 + TypeScript + Vite on the front,
a dependency-free Node server with `node:sqlite` behind it, self-hosted on a
Mac mini and reached from a phone and a desktop.

## Working on this repo

**Always `git fetch` and `git pull --ff-only` before you start committing.**
Two Claudes work on this repo — one in the cloud, one on the Mac mini itself —
and both push to the same branch. Committing on a stale checkout produces
divergent lines that have to be merged by hand, and a merge that "keeps the
deployed side" silently drops whatever the other side built.

There is one branch, `claude/health-fitness-pwa-u15thb`, and it is the
repository's default. There is no `main`. Push there and nowhere else.

## Before pushing

```bash
npm test          # unit tests: scheduling, projection, stats, formatting, reconstitution
npm run build     # typecheck plus a production build
npm run smoke     # the browser suite for whatever you touched (see README for the rest)
```

The smoke suites drive the built app in a real browser, so build first. They
each bind a fixed port; run them one at a time.

## Deploying

On the Mac mini: `./scripts/macos-service.sh update` — pulls, rebuilds,
restarts the launchd service, and verifies the commit actually being served.

## Conventions

- Data lives in Dexie (IndexedDB) on each device and syncs through
  `POST /api/sync`. New collections need a Dexie version bump *and* a server
  table, or they will not sync.
- Seeded catalogue rows use deterministic ids (`seed-exercise-…`) so two
  devices that seed independently merge instead of duplicating.
- Charts follow the conventions in the `dataviz` skill: one scale per plot, a
  legend once there are two series.
- Where a conversion isn't defined — IU against milligrams, say — say so on
  screen rather than showing a number that looks authoritative.
