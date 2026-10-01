# Homeport on a Raspberry Pi (appliance)

For a plain Docker install on any Linux machine or NAS, see [`../docker/`](../docker/).

Scripts that turn a fresh Raspberry Pi OS (64-bit) install into a Homeport appliance.

| Script | Run when | What it does |
|---|---|---|
| `install.sh` | On a fresh Pi (safe to re-run) | Docker, Homeport + Watchtower, mDNS (`homeport.local`), hardware watchdog, capped logs, HDMI kiosk, Wi-Fi setup hotspot |
| `prepare-image.sh` | Last, on the master unit, before imaging its SD card | Wipes Homeport data, resets SSH host keys / machine-id / saved Wi-Fi, powers off |
| `uninstall.sh` | To wipe a test Pi back to clean before re-testing `install.sh` | Reverses `install.sh`: containers, data, Docker, kiosk, settings, and only the packages it added |

## Install

First install on a fresh Pi (the only time you need curl):

```bash
curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash
```

That also installs two commands, so from then on:

```bash
sudo homeport-install      # re-run / update with the latest install.sh
sudo homeport-uninstall    # remove everything
```

Each command downloads the latest script from GitHub, saves it to `/usr/local/lib/homeport/`,
and runs it. Offline, it runs the saved copy instead. `--local` skips the download. Any other
options are passed through, e.g. `sudo homeport-install --interval 3600`.

Options: `--hostname NAME`, `--interval SECONDS` (Watchtower check, default 300), `--verbose` (full apt/docker output),
`--tag TAG` (image tag, default `latest`), `--kiosk` (default) / `--no-kiosk`, `--user NAME`, `--debug`.

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

## Re-testing from clean

```bash
sudo homeport-uninstall                   # full wipe (asks you to type REMOVE)
sudo homeport-uninstall --keep-docker     # quicker: keep Docker installed
sudo homeport-uninstall --keep-data       # keep Homeport data and photos
sudo homeport-uninstall --keep-commands   # keep homeport-install for the next test
sudo reboot
```

`install.sh` records what it changes in `/var/lib/homeport-install/` (packages it newly
installed, groups, original hostname and boot mode), so `uninstall.sh` removes exactly
that and leaves what Pi OS shipped with.

## Wi-Fi setup hotspot

`homeport-wifi-setup.service` (`wifi-setup.py`) gets a Pi onto home Wi-Fi without a cable or
keyboard:

1. At boot, if Ethernet or a saved Wi-Fi network connects within 90s, nothing happens.
2. Otherwise the Pi broadcasts an open network, `Homeport-Setup-XXXX`. Joining it from a phone
   pops up a setup page listing nearby networks.
3. Pick the network and enter the password. The hotspot closes and the Pi joins it. On failure
   the hotspot comes back within about a minute, and the page shows what went wrong.
4. If the network is lost later for 2 minutes (new router, moved house), the hotspot comes back.
   While broadcasting, it retries saved networks every 5 minutes in case the router was just
   rebooting.

Settings: `/etc/homeport/wifi-setup.conf` (hotspot name prefix, optional WPA2 password, timings).
Logs: `journalctl -u homeport-wifi-setup -f`. Skip with `--no-wifi-setup`.

To test on a dev Pi while staying connected over Ethernet:

```bash
sudo python3 /usr/local/lib/homeport/wifi-setup.py --test
```

This pauses the service and starts `Homeport-Setup-XXXX` right away, ignoring the cable. Join
it from your phone and go through the page while watching the log in the terminal. It exits
once the Pi joins Wi-Fi (or on Ctrl+C) and restarts the service.

## Building a distribution image

1. Flash Pi OS with Raspberry Pi Imager (user `homeport`, your SSH public key).
2. `sudo ./install.sh`, then check the display and `homeport.local`.
3. `sudo ./prepare-image.sh` (powers off).
4. Image the SD card on your Mac. Every card flashed from it boots with its own SSH
   host keys, machine-id and empty Homeport data.
