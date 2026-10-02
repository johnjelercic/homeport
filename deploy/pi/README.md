# Homeport on a Raspberry Pi

`install.sh` turns a fresh Raspberry Pi OS install into a working Homeport unit: it installs
Docker, runs Homeport with automatic updates, and sets up the Pi to run unattended. The same
script serves two uses:

- **DIY:** you have a Pi and want Docker, Watchtower and Homeport installed and kept running
  for you. Run the one-line install below and skip the appliance extras you don't want
  (`--no-kiosk`, `--no-wifi-setup`).
- **Appliance:** building the SD card image you ship. Install with everything, then seal it
  with `prepare-image.sh` (see [Building a distribution image](#building-a-distribution-image)).

Already running Docker on a Linux machine or NAS? You don't need any of this; use the plain
compose file in [`../docker/`](../docker/).

## Requirements

- Raspberry Pi 5 (a Pi 4 should work, but is untested)
- **64-bit** Raspberry Pi OS, Bookworm or newer (Lite or Desktop). The script refuses to run
  on 32-bit or non-Debian systems.
- **The official 27W USB-C power supply.** Phone and laptop chargers can't hold 5V under load.
  The Pi then browns out and freezes with a solid red LED, typically while Docker unpacks
  images. Check with `vcgencmd get_throttled`: anything other than `throttled=0x0` means the
  supply is too weak.
- Internet access during install, by Ethernet or Wi-Fi (configured in Raspberry Pi Imager)

## Install

First install (the only time you need curl):

```bash
curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash
```

With options, e.g. a DIY install without the appliance extras:

```bash
curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash -s -- --no-kiosk --no-wifi-setup
```

The install also adds two commands, so from then on you never need the URL:

```bash
sudo homeport-install      # update/re-run with the latest install.sh (takes the same options)
sudo homeport-uninstall    # remove everything (see Uninstall)
```

Each command downloads the latest script from GitHub, saves it to `/usr/local/lib/homeport/`,
and runs it. If GitHub can't be reached it runs the saved copy. `--local` always uses the saved
copy. Re-running is safe: finished steps are left as they are, and Homeport's data is never
touched.

When it's done: `http://homeport.local:19156/` (settings at `/settings.html`).

### Options

| Option | Default | Meaning |
|---|---|---|
| `--hostname NAME` | `homeport` | Host name, so the Pi is reachable at `NAME.local` |
| `--interval SECONDS` | `300` | How often Watchtower checks for a new Homeport image. Use `3600` (hourly) once things are stable |
| `--tag TAG` | `latest` | Which Homeport image tag to run and follow |
| `--no-kiosk` / `--kiosk` | kiosk on | Full-screen Homeport on an HDMI display |
| `--user NAME` | the sudo user | Account the kiosk runs as |
| `--no-wifi-setup` / `--wifi-setup` | on | Wi-Fi setup hotspot ([WIFI-SETUP.md](WIFI-SETUP.md)) |
| `--wifi-country CC` | `US` | Wi-Fi country, used only if none is set yet |
| `--verbose` | off | Show full apt/Docker output on screen |
| `--debug` | off | Also print every command as it runs |

Re-running without an option resets that setting to its default. For example, run
`sudo homeport-install --interval 3600` again whenever you re-run, to keep an hourly
interval.

### What it does

The screen shows nine numbered steps with a line or two each. Full apt/Docker output goes to
`/var/log/homeport-install.log`, and its last lines are shown automatically if something fails.

1. **Base packages:** curl, certificates, Avahi (mDNS).
2. **Docker Engine:** from Docker's own apt repository. Container logs are capped at
   3 × 10 MB each to spare the SD card. Your user is added to the `docker` group.
3. **Hostname and mDNS:** sets the host name and advertises the web UI as a Bonjour service,
   so `homeport.local:19156` works on the local network.
4. **Reliability:** turns on the hardware watchdog (the Pi reboots itself if it hangs for 15s),
   caps the system log at 64 MB, and gives SD cards cloned from an image their own SSH host keys
   on first boot.
5. **Containers:** writes `/opt/homeport/docker-compose.yml` and `.env`, pulls the images and
   starts Homeport and Watchtower. Watchtower uses the maintained
   [`nickfedor/watchtower`](https://github.com/nicholas-fedor/watchtower) fork, because the
   original is unmaintained and fails on current Docker. It only updates containers labelled
   for it, deletes old images, and keeps itself updated.
6. **Health check:** waits for Homeport to answer on port 19156, and shows its logs if it
   doesn't within 2 minutes.
7. **HDMI kiosk:** see below.
8. **Management commands:** `homeport-install` / `homeport-uninstall`.
9. **Wi-Fi setup hotspot:** see below.

Everything it changes is recorded in `/var/lib/homeport-install/`: packages it newly
installed, groups added, the original hostname and boot mode. `uninstall.sh` uses that record
to undo exactly those changes.

### Files on the Pi

```
/opt/homeport/
  docker-compose.yml        homeport + watchtower (rewritten on every install)
  .env                      image tag, Watchtower interval, timezone
  data/                     calendar.db, token.key (encrypts saved calendar credentials)
  photos/
/usr/local/sbin/homeport-install, homeport-uninstall
/usr/local/lib/homeport/    saved scripts (offline fallback), wifi-setup.py
/etc/homeport/wifi-setup.conf
/var/lib/homeport-install/  record of what install.sh changed
/var/log/homeport-install.log
```

## Day-to-day

**Change the update interval without reinstalling:**

```bash
sudo sed -i 's/^WATCHTOWER_POLL_INTERVAL=.*/WATCHTOWER_POLL_INTERVAL=3600/' /opt/homeport/.env
cd /opt/homeport && sudo docker compose up -d     # recreates only Watchtower
```

**Check on things:**

```bash
sudo docker ps                                    # homeport + watchtower running?
sudo docker logs watchtower                       # update checks and what it updated
sudo docker logs homeport                         # app log
sudo docker inspect -f '{{.Config.Image}}' homeport
```

**Test an update end to end:** push an app change (bumping `VERSION` is enough), wait for the
GitHub Actions build, then watch `sudo docker logs -f watchtower`. Within one interval it
pulls the new image, restarts Homeport and removes the old image.

## HDMI kiosk

`homeport-kiosk.service` runs Chromium full-screen inside `cage`, a minimal display server that
shows exactly one app, on the HDMI display. It waits until a display reports "connected", so a
headless unit just idles, and plugging in a screen later brings the kiosk up. On Pi OS Desktop
it switches boot to console mode so the desktop doesn't compete for the screen. The uninstall
restores the original boot mode.

```bash
sudo systemctl status homeport-kiosk
journalctl -u homeport-kiosk -f
sudo homeport-install --no-kiosk      # remove it
```

## Wi-Fi setup hotspot

With no network, the Pi broadcasts **`Homeport-Setup-XXXX`**: 90 seconds after boot, or after
2 minutes offline later on. Joining it from a phone opens a page to choose the home Wi-Fi
network and enter its password. If joining fails, the hotspot comes back with the reason. It
stays out of the way whenever Ethernet or a saved network is connected.

Full details, settings, testing and troubleshooting: **[WIFI-SETUP.md](WIFI-SETUP.md)**.

## Uninstall

```bash
sudo homeport-uninstall                   # full wipe (asks you to type REMOVE)
sudo homeport-uninstall --keep-docker     # keep Docker installed (faster re-tests)
sudo homeport-uninstall --keep-data       # keep /opt/homeport/data and photos
sudo homeport-uninstall --keep-commands   # keep homeport-install/-uninstall for the next test
sudo homeport-uninstall --yes             # no prompt
sudo reboot
```

It removes the containers and images, `/opt/homeport` (data included unless `--keep-data`),
Docker with its data and apt repository, the kiosk (restoring the original boot mode), the
Wi-Fi setup service and settings, the mDNS advert, the watchdog and log settings, the
packages and group memberships install.sh added, and the commands themselves. It restores
the original hostname. It keeps your user, SSH keys, saved Wi-Fi networks and anything Pi OS
shipped with.

A full uninstall removes `homeport-install` too, so to start over use the curl line again,
or pass `--keep-commands`.

**Re-test cycle:**

```bash
sudo homeport-uninstall --keep-commands && sudo reboot
sudo homeport-install
```

## Building a distribution image

**On the Pi (the master):**

1. Flash 64-bit Pi OS with Raspberry Pi Imager: user `homeport`, a strong password (every unit
   shares it), your SSH public key, Wi-Fi if needed. Then `sudo apt update && sudo apt full-upgrade`
   and reboot.
2. Install with production settings, using the official 27W power supply:
   `curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash -s -- --interval 3600`
   (or `sudo homeport-install --interval 3600` if already installed).
3. Check it: `vcgencmd get_throttled` shows `0x0`, `sudo docker ps` shows both containers,
   `homeport.local:19156` loads, `nmcli radio` shows Wi-Fi enabled, and
   `sudo python3 /usr/local/lib/homeport/wifi-setup.py --test` brings up the hotspot.
   Optional: `sudo apt clean` makes the image smaller.
4. Seal it, in the same login session:
   ```bash
   unset HISTFILE
   curl -fsSLO https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/prepare-image.sh
   sudo bash prepare-image.sh
   ```
   It:
   - wipes Homeport's data and photos, including `token.key`, so households never share it
   - removes SSH host keys (regenerated per unit on first boot)
   - clears the machine ID (each unit then gets its own DHCP identity and IP address)
   - removes saved Wi-Fi networks from disk, so clones start in the setup hotspot and your
     Wi-Fi password isn't shipped (`--keep-wifi` to keep them)
   - clears logs and shell history (and each unit clears history again on its first boot,
     since your login session writes its history while the Pi shuts down)
   - powers off

   It keeps Docker, the downloaded images (so first boot doesn't need a big download), all
   settings and your `authorized_keys`. **Don't boot the card again before imaging it.**

**On your Mac:**

5. Put the card in and run `deploy/pi/make-image.sh` from the repo. Docker must be running:
   `colima start` (Colima: `brew install colima docker`), or Docker Desktop. It:
   - finds the Pi card (a disk with a `bootfs` partition; never your Mac's own drive) and asks
     you to type its name (e.g. `disk4`) to confirm
   - copies the card with `dd` (asks for your Mac password; Ctrl+T shows progress), then ejects it
   - shrinks and compresses it with [PiShrink](https://github.com/Drewsif/PiShrink) in a Linux
     container. The image only holds the used space and expands to fill any card on first boot
     (16 GB card: 15 GB image becomes about 2.3 GB)
   - writes a SHA-256 checksum

   Result: `~/Homeport-images/homeport-YYYY.MM.DD.img.xz` plus `.sha256`. Options: `--disk diskN`,
   `--out DIR`, `--name NAME`. If macOS says it can't read the card, click **Ignore**, never
   **Initialize**.
6. Test it: flash a second card with Raspberry Pi Imager (**Use custom**, pick the `.img.xz`,
   choose **No** to OS customization). Boot it with no Ethernet and check that:
   - `Homeport-Setup-XXXX` appears and setup works
   - `homeport.local:19156` loads
   - `ssh homeport` works (after `ssh-keygen -R homeport.local` on your Mac)
   - `df -h /` shows close to the card's full size
   - `history` is empty

**Checksums:** keep the `.sha256` next to the image wherever you copy it. Before flashing from
a copy, run `shasum -a 256 -c homeport-YYYY.MM.DD.img.xz.sha256`. It should print `OK`.

After sealing, your Mac will warn that the Pi's host key changed the next time you SSH in.
Clear it with `ssh-keygen -R homeport.local` and `ssh-keygen -R <its IP>`.

## Versions

The scripts are versioned in [`../VERSION`](../VERSION), separately from the app's
`VERSION` at the repo root. Script-only changes then don't rebuild the Homeport image, because
pushes that only touch `deploy/` skip the image build. The installer prints its version at the
start and in its summary.

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Pi freezes, solid red LED, during install or under load | Weak power supply | `vcgencmd get_throttled` should be `0x0`; `dmesg \| grep -i voltage` |
| Install fails partway | Network or apt error | Last lines are printed; full log in `/var/log/homeport-install.log` |
| `homeport.local` doesn't resolve | Phone on a different network segment (guest/IoT) | Find `homeport` in the router's DHCP list |
| Hotspot never appears | Ethernet or a saved network still connected | [WIFI-SETUP.md](WIFI-SETUP.md#testing-and-troubleshooting) |
| Black screen on HDMI | Homeport not up yet, or the kiosk is waiting | `journalctl -u homeport-kiosk`, `sudo docker ps` |
| SSH drops during install | Wi-Fi drop, or the Pi lost power | Re-run `sudo homeport-install`; it picks up where it stopped |
