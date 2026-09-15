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

You need **Node 22.5 or newer** — the server stores data with Node's built-in
SQLite, which older versions don't have. `brew install node` gives you a current
one; the install script checks before doing anything and tells you if yours is
too old.

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

Tailscale puts your own devices on a private encrypted network and issues real
certificates for them. Four steps, and two places it commonly trips up.

**1. Install it on the Mac mini.** Download the app from
[tailscale.com/download/mac](https://tailscale.com/download/mac) and sign in.
(Homebrew works too — `brew install --cask tailscale-app`, though the cask has
been renamed before, so the download page is the safer bet.) Leave it running.

**2. Put the CLI on your PATH.** This is the step that bites: the Mac app ships
the `tailscale` command *inside its own bundle*, so a fresh terminal just says
`zsh: command not found: tailscale`. Link it once:

```bash
sudo ln -sfn /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale
tailscale version   # should now print
```

(If you installed the CLI-only Homebrew formula — `brew install tailscale` —
you get the command directly but have to run the `tailscaled` daemon yourself.
The app is the easier option on a Mac.)

**3. Turn on HTTPS certificates for your tailnet.** `tailscale serve` cannot
issue a certificate until this is enabled, and the error it gives is not
obvious. In the admin console at
[login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns), enable
**MagicDNS** and **HTTPS Certificates**. One-time, per tailnet.

**4. Publish the app.** On the mini:

```bash
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status      # shows the URL it is published at
```

Then install Tailscale on your phone from the App Store or Play Store and sign
into the same account. The phone can now reach that URL from anywhere.

You get `https://<machine>.<tailnet>.ts.net` with a real, automatically renewed
certificate. It works from anywhere — the gym, work — without opening a single
port to the internet, and only your own devices can reach it. For personal
health data that's the right trade: a private network, not a public one with a
password on top.

To stop serving: `tailscale serve --https=443 off`.

#### If `tailscale serve` hangs or errors

First separate the two halves of the setup — the app and the tunnel are
independent, and it is worth knowing which one is unhappy. On the mini:

```bash
curl -s http://127.0.0.1:8787/api/health
```

A line of JSON starting `{"ok":true` means BodyView itself is running fine and
the problem is only the tunnel in front of it. Nothing to fix in the app.

Then, in order:

```bash
tailscale status      # connected, and is this machine listed?
tailscale ip -4       # should print a 100.x.y.z address
tailscale cert "$(tailscale status --json | grep -o '"DNSName":"[^"]*' | head -1 | cut -d'"' -f4 | sed 's/\.$//')"
```

The `cert` command is the useful one: it does the certificate step on its own,
so it tells you plainly whether that is what `serve` is stuck on. If it fails
or hangs, **MagicDNS and HTTPS Certificates are not enabled** for your tailnet
— that is step 3 above, in the admin console, and `serve` cannot finish without
it.

The first certificate can genuinely take a while to issue. A minute of silence
is not a failure; five is.

If the phone cannot load the URL, check Tailscale is connected on the phone —
it is a VPN toggle, and iOS sometimes drops it after a restart.

### Just getting it working on your own network

If you would rather not deal with any of this yet, skip the tunnel. On the mini
itself, `http://localhost:8787` is a secure context as far as browsers are
concerned, so everything including the service worker works there.

For other devices on your home Wi-Fi, reinstall the service bound to the LAN:

```bash
BODYVIEW_HOST=0.0.0.0 ./scripts/macos-service.sh install
```

Then open `http://<the-mini's-LAN-IP>:8787` from your phone. Sync works, and
the app works. What you do not get is the service worker — so no offline
support, and iOS gives you a bookmark rather than a real installed app. It is a
reasonable way to try the thing out before committing to certificate setup.

Bear in mind this puts the API on your local network with no token, so set one
(see above) if that matters to you.

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

## 3. Install it on your other devices, and connect them

Everything other than the mini is a client. There is nothing to install on a
Windows PC, a laptop or a phone beyond opening the address and connecting —
the database stays on the mini.

Once you have the URL:

- **iOS** — open it in **Safari** (not Chrome), then Share → *Add to Home Screen*
- **Android** — open in Chrome, then menu → *Install app*
- **Windows / desktop** — open it in Chrome or Edge; if the address is HTTPS
  there is an install icon in the address bar, which gives it its own window
  and taskbar entry. Over plain HTTP it stays an ordinary tab, which works
  fine, just without offline support.

Then on each device: **Settings → Sync**, paste the same URL, and tap
*Connect*. That is what joins it to the shared database — installing the app
alone does not.

### Reaching the mini from another computer on your network

By default the server listens only on the mini itself, so nothing else can
reach it. To open it to your own network:

```bash
BODYVIEW_HOST=0.0.0.0 ./scripts/macos-service.sh install
```

Then from the other machine use the mini's own hostname, which survives your
router handing out a different IP:

```
http://<your-mac's-name>.local:8787
```

Windows 10 and 11 resolve `.local` names natively. If it does not resolve, use
the address instead — on the mini, `ipconfig getifaddr en0` (or `en1` if that
is empty) prints it.

Two things to know:

- macOS may pop up a firewall prompt the first time something connects from
  another machine. Allow it.
- This puts the sync API on your local network with no authentication. Set a
  token (below) if anyone else uses that network.

This route has no HTTPS, so browsers will not install it as an app or run it
offline. On a desktop that matters much less than on a phone. If you want it
everywhere and properly installable, use Tailscale instead — the same URL then
works from your desk, the gym, or anywhere else.

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
