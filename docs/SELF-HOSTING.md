# Running BodyView on an always-on Mac

The Mac mini runs the app **and** holds the database. Every device — phone,
desktop, laptop — keeps a local copy and syncs it with the mini, so they all
show the same data.

## How storage works

The database of record is a **SQLite file on the Mac mini**. There is one table
per collection, and a set of views that flatten the JSON into ordinary columns,
so you can query your own data with plain SQL:

```bash
./scripts/macos-service.sh sql
sqlite> SELECT date, kg FROM v_weight ORDER BY date DESC LIMIT 10;
sqlite> SELECT * FROM v_daily_macros WHERE date >= '2026-09-01';
sqlite> SELECT compound, remaining, unit FROM v_inventory;
```

Each device also keeps a full local copy in the browser. That is deliberate:
gyms and kitchens have bad signal, and an app that stops working the moment it
cannot reach the mini would be useless exactly when you want it. You can log a
workout on aeroplane mode and it reconciles when you are back on the network.

### How sync resolves conflicts

Each round trip sends the records this device has changed and receives
everything else that changed on the server. It runs on load, when the app comes
back to the foreground, a couple of seconds after you change something, when
the network returns, and once a minute as a backstop.

If the same record is edited on two devices, **the later edit wins**, judged by
the clock of the device that made it. For a single person with a phone and a
desktop that is almost always what you want — you are rarely editing the same
weigh-in in two places at once. It is not a general-purpose merge, and it does
not try to be: nothing is merged field by field, the newer version of the
record replaces the older one.

Deletions travel as tombstones, so deleting something on your phone deletes it
everywhere rather than having it reappear at the next sync.

## 1. Clone and install the service

On the Mac mini:

```bash
git clone https://github.com/Bhamm7/BodyView-.git ~/BodyView
cd ~/BodyView
./scripts/macos-service.sh install
```

That builds the app and registers a **LaunchAgent** — a per-user background
service, no `sudo` needed. It starts at login, restarts itself if it ever
crashes, and logs to `~/Library/Logs/bodyview/server.log`.

The database is created at
`~/Library/Application Support/BodyView/bodyview.db`. Override with
`BODYVIEW_DB=/path/to/file` before installing.

```bash
./scripts/macos-service.sh status      # running? responding?
./scripts/macos-service.sh logs        # tail the log
./scripts/macos-service.sh restart
./scripts/macos-service.sh update      # git pull, rebuild, restart
./scripts/macos-service.sh backup      # safe SQLite snapshot
./scripts/macos-service.sh sql         # sqlite3 shell on the database
./scripts/macos-service.sh uninstall
```

The server has no dependencies — plain Node, using the built-in `node:sqlite` —
so there's no package tree to keep patched on a long-running box. It binds to
`127.0.0.1:8787` by default. Override with `BODYVIEW_PORT` / `BODYVIEW_HOST`
before installing.

## 2. Give it HTTPS — this part is not optional

Service workers only run in a **secure context**: HTTPS, or `localhost`. A plain
`http://192.168.1.x:8787` is neither. Open the app that way and:

- the service worker never registers, so there's no offline support
- iOS gives you a bookmark rather than a real installed app
- updates behave inconsistently

So terminate TLS in front of the server. Two good ways.

### Tailscale (recommended)

Install Tailscale on the Mac mini and on your phone, sign both into the same
tailnet, then on the mini:

```bash
tailscale serve --bg http://127.0.0.1:8787
```

You get `https://<machine>.<tailnet>.ts.net` with a real, automatically renewed
certificate. It works from anywhere — the gym, work — without opening a single
port to the internet, and only your own devices can reach it. For personal
health data that's the right trade: a private network, not a public one with a
password on top.

Check it with `tailscale serve status`. To stop: `tailscale serve --https=443 off`.

### Caddy with your own domain

If you already own a domain and are comfortable with DNS:

```
bodyview.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy obtains and renews the certificate itself. Use the DNS-01 challenge and
keep the hostname off public DNS if you'd rather not advertise it. This exposes
a service to the internet, so only take this route if you're happy owning that.

### What about a self-signed certificate?

You can (`mkcert`), but you must install and explicitly trust the local CA on
every device — on iOS that's two separate settings screens, and it silently
breaks when you get a new phone. Tailscale is less work and less fragile.

## 3. Install it on your phone, and connect it

Once you have the HTTPS URL:

- **iOS** — open it in **Safari** (not Chrome), then Share → *Add to Home Screen*
- **Android** — open in Chrome, then menu → *Install app*

Then on each device: **Settings → Sync**, paste the same URL, and tap
*Connect*. That is what joins it to the shared database — installing the app
alone does not.

### A device that was used before being connected

If you already logged data on a device before connecting it, connecting merges
that data up to the server, which is usually what you want. The built-in
libraries (compounds, exercises, foods) use fixed ids, so they merge cleanly
rather than doubling.

If a device does end up with duplicates, **Settings → Sync → Replace this
device with the server's copy** wipes the local copy and pulls the server's.
Only use it on the device you're happy to overwrite.

## Optional: require an access token

On a tailnet the network is already the boundary and no token is needed. If you
would rather have one anyway — or you're exposing the server more widely — set
one before installing:

```bash
BODYVIEW_TOKEN="$(openssl rand -hex 24)" ./scripts/macos-service.sh install
```

Then enter the same token in **Settings → Sync** on each device. It guards the
API only; the app itself is still served to anyone who can reach the host.

If you serve the app from somewhere other than the mini (GitHub Pages, say),
the browser will block the cross-origin API calls unless you also set
`BODYVIEW_ALLOW_ORIGIN=https://your-app-origin`. Keeping both on the mini
avoids the issue entirely, which is why that's the default.

## 4. Mac mini housekeeping

A LaunchAgent runs when the user is logged in, which is the usual setup for an
always-on mini. To make that survive a power cut and stay reachable:

- **System Settings → Users & Groups → Automatically log in as** your user
- **System Settings → Energy** → tick *Start up automatically after a power
  failure*, and *Prevent automatic sleeping when the display is off*
- If you use FileVault, the disk stays locked after a reboot until someone logs
  in at the console — which blocks auto-login. Either accept a manual unlock
  after power cuts, or don't use FileVault on this machine.

If you'd rather it run before any login, use a **LaunchDaemon** in
`/Library/LaunchDaemons` instead. That needs `sudo` and runs as root, which is
more privilege than this needs, so the agent is the better default.

### Keeping it updated

`./scripts/macos-service.sh update` pulls, rebuilds and restarts. A weekly
`cron`/`launchd` entry can do it unattended, though on a personal app there's
something to be said for updating it when you feel like it instead.

## Backups

Everything now lives in one SQLite file, so backing that file up covers all your
devices at once.

```bash
./scripts/macos-service.sh backup
```

That uses SQLite's own `.backup` command rather than copying the file. Copying
a live SQLite database while the server is writing can capture a half-written
WAL and give you a corrupt snapshot — so don't just `cp` it.

Put the mini's `Application Support/BodyView` folder on a Time Machine volume
and you have history as well. `GET /api/export` returns the whole database as
the same JSON the app's own export produces, if you'd rather have something
portable.

Worth doing on each phone too: **Settings → Ask the browser to keep this data**
requests persistent storage, so the local copy isn't evicted under storage
pressure before it has synced.

### Erasing data when sync is on

**Settings → Erase all data** clears the device it's run on. The server still
has its copy and will send it straight back on the next sync. To genuinely
start over, disconnect the device first, or delete the SQLite file on the mini
while the service is stopped.

## Running it on Linux instead

The static server is plain Node and runs anywhere. Substitute a systemd unit
for the launchd agent:

```ini
[Unit]
Description=BodyView
After=network.target

[Service]
ExecStart=/usr/bin/node /srv/bodyview/server/serve.mjs
Environment=PORT=8787 HOST=127.0.0.1 ROOT=/srv/bodyview/dist
Restart=always
User=bodyview

[Install]
WantedBy=multi-user.target
```
