# Homeport on a Raspberry Pi

Scripts that turn a fresh Raspberry Pi OS (64-bit) install into a Homeport appliance.

| Script | Run when | What it does |
|---|---|---|
| `install.sh` | On a fresh Pi (safe to re-run) | Docker, Homeport + Watchtower, mDNS (`homeport.local`), hardware watchdog, capped logs, optional HDMI kiosk |
| `prepare-image.sh` | Last, on the master unit, before imaging its SD card | Wipes Homeport data, resets SSH host keys / machine-id / saved Wi-Fi, powers off |

## Install

```bash
scp deploy/pi/install.sh homeport:~/
ssh homeport 'sudo ./install.sh'
```

Or straight from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash
```

Options: `--hostname NAME`, `--interval SECONDS` (Watchtower check, default 300),
`--tag TAG` (image tag, default `latest`), `--kiosk` (default) / `--no-kiosk`, `--user NAME`.

After install: `http://homeport.local:19156/` (settings at `/settings.html`).

## Layout on the Pi

```
/opt/homeport/
  docker-compose.yml   # homeport + watchtower (rewritten by install.sh)
  .env                 # image tag, Watchtower interval, timezone
  data/                # calendar.db, token.key
  photos/
```

Change the update interval later: edit `WATCHTOWER_POLL_INTERVAL` in `/opt/homeport/.env`
(e.g. `3600` for hourly), then `cd /opt/homeport && sudo docker compose up -d`.

## HDMI kiosk

`homeport-kiosk.service` runs Chromium full-screen in `cage` (a single-app Wayland
compositor) on the HDMI display. It waits for a display to be connected, so a headless
unit just idles and plugging a screen in later brings the kiosk up. On Pi OS Desktop it
switches boot to console mode so the desktop doesn't compete for the screen.

```bash
sudo systemctl status homeport-kiosk      # state
journalctl -u homeport-kiosk -f           # logs
sudo ./install.sh --no-kiosk              # remove it
```

## Building a distribution image

1. Flash Pi OS with Raspberry Pi Imager (user `homeport`, your SSH public key).
2. `sudo ./install.sh`, then check the display and `homeport.local`.
3. `sudo ./prepare-image.sh` (powers off).
4. Image the SD card on your Mac. Every card flashed from it boots with its own SSH
   host keys, machine-id and empty Homeport data.
