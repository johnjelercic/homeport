# Homeport — DIY install (Docker)

For any Linux machine or NAS that already runs Docker: a home server, a Synology,
or your own Raspberry Pi. Only the container is installed; nothing on the host
changes. For the ready-to-ship Raspberry Pi appliance (kiosk, Wi-Fi setup hotspot,
watchdog), see [`../pi/`](../pi/).

## Install

```bash
mkdir homeport && cd homeport
curl -fsSLO https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/docker/docker-compose.yml
docker compose up -d
```

Open `http://<this-machine>:19156/` (settings at `/settings.html`).

Set your timezone so the clock and calendars line up, either by editing `TZ` in the
compose file or with `TZ=America/New_York docker compose up -d`.

## Automatic updates (optional)

```bash
docker compose --profile autoupdate up -d
```

This adds Watchtower, which checks hourly for a new Homeport image and swaps it in.
It only touches containers labelled for it, so your other containers are left alone.
Change the interval with `WATCHTOWER_POLL_INTERVAL` (seconds).

Already running Watchtower for other containers? Skip the profile; yours will pick up
Homeport through the `com.centurylinklabs.watchtower.enable=true` label if it runs
with label filtering.

## Manual update

```bash
docker compose pull && docker compose up -d
```

## Data

Everything Homeport stores lives next to the compose file:

```
data/     calendar.db, token.key (encrypts saved calendar credentials; back it up with the db)
photos/
```

## Remove

```bash
docker compose --profile autoupdate down --rmi all
rm -rf data photos     # only if you also want to delete your data
```
