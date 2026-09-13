# Running BodyView on an always-on Mac

Yes — clone it, build it, and run the built files behind a small service. The
steps are below. But read the next section first, because self-hosting the app
does **not** do the thing most people assume it does.

## Read this first: hosting the app is not the same as hosting your data

BodyView is a client-side app. Its database (IndexedDB) lives **in the browser
that opens it**, not on the machine serving the files.

So if the Mac mini serves the app and you open it on your phone *and* your
desktop, you get two independent copies of your data. A weigh-in logged on the
phone will not appear on the desktop. Putting the files on a server changes
where the *app* comes from, not where the *data* lives.

That leaves you three honest options:

| Option | What you get | Cost |
| --- | --- | --- |
| **One device is the real one** | Log everything on the phone; use the desktop read-only via its own copy, or just don't use it | Free, works today |
| **Manual sync** | Settings → Export backup on one device, Import on the other | Free, works today, but it's a chore and easy to forget |
| **A sync server on the Mac mini** | One shared database; every device sees the same data | Needs building — the app currently has no sync client |

If you want the third one, say so and I'll build it: a small service alongside
the static server, with the app pushing changes to it and pulling on load. It's
a meaningful addition, not a config change, which is why it isn't already here.

Everything below sets up hosting. It's worth doing either way — it gives you a
stable URL and a proper phone install.

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

```bash
./scripts/macos-service.sh status      # running? responding?
./scripts/macos-service.sh logs        # tail the log
./scripts/macos-service.sh restart
./scripts/macos-service.sh update      # git pull, rebuild, restart
./scripts/macos-service.sh uninstall
```

The server itself (`server/serve.mjs`) has no dependencies — it's plain Node —
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

## 3. Install it on your phone

Once you have the HTTPS URL:

- **iOS** — open it in **Safari** (not Chrome), then Share → *Add to Home Screen*
- **Android** — open in Chrome, then menu → *Install app*

It then launches without browser chrome and works offline.

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

This is the part worth actually setting up. Your data is in the browser on your
phone, and phones get lost.

Use **Settings → Export backup** regularly and put the JSON somewhere that is
itself backed up (iCloud Drive, the Mac mini's Time Machine volume). While
you're in Settings, tap *Ask the browser to keep this data* — that requests
persistent storage so the browser won't evict the database under storage
pressure.

There is no automatic backup, because the app has nowhere to send it. That
changes if you decide you want the sync server.

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
