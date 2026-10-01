#!/usr/bin/env bash
# Homeport — seal a configured Pi before imaging its SD card for distribution
#
# Run this LAST on the master unit (after install.sh), then let it power
# off and image the card. Every unit flashed from that image then boots
# with its own identity instead of sharing the master's:
#   - Homeport data and photos wiped (incl. token.key, which encrypts
#     each household's calendar credentials, so it must never be shared)
#   - SSH host keys removed  -> regenerated on first boot (homeport-firstboot)
#   - machine-id cleared     -> regenerated on first boot; also gives each
#                               unit its own DHCP identity / IP lease
#   - Saved Wi-Fi networks removed (your Wi-Fi password stays home)
#   - Logs and shell history cleared
# Kept: the Homeport/Watchtower images (so first boot doesn't need a big
# download), all install.sh configuration, and the login user's
# ~/.ssh/authorized_keys.
#
# Usage:
#   sudo ./prepare-image.sh            # asks for confirmation, then powers off
#   sudo ./prepare-image.sh --yes      # no prompt
#   sudo ./prepare-image.sh --keep-wifi

set -euo pipefail

HP_DIR="/opt/homeport"
ASSUME_YES="no"
KEEP_WIFI="no"
for a in "$@"; do
  case "$a" in
    --yes|-y)    ASSUME_YES="yes" ;;
    --keep-wifi) KEEP_WIFI="yes" ;;
    -h|--help)   sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ -f "$HP_DIR/docker-compose.yml" ]] || { echo "$HP_DIR not found — run install.sh first." >&2; exit 1; }

if [[ "$ASSUME_YES" != "yes" ]]; then
  echo "This ERASES all Homeport data and photos on this Pi, resets its identity,"
  [[ "$KEEP_WIFI" == "yes" ]] || echo "removes saved Wi-Fi networks,"
  echo "and powers it off. Only run this on the master unit you are about to image."
  read -r -p "Type SEAL to continue: " answer </dev/tty
  [[ "$answer" == "SEAL" ]] || { echo "Aborted."; exit 1; }
fi

# Stop the Docker daemon, not the containers: `docker compose stop` would mark
# them stopped, and restart: unless-stopped would then leave them down on
# every cloned unit. Stopping the daemon keeps them set to start at boot.
echo "==> Stopping Docker"
systemctl stop docker.service docker.socket

echo "==> Wiping Homeport data and photos"
find "$HP_DIR/data" "$HP_DIR/photos" -mindepth 1 -delete

echo "==> Removing SSH host keys (regenerated on first boot)"
rm -f /etc/ssh/ssh_host_*
systemctl enable homeport-firstboot.service >/dev/null

if [[ "$KEEP_WIFI" != "yes" ]]; then
  echo "==> Removing saved Wi-Fi networks"
  if command -v nmcli >/dev/null 2>&1; then
    nmcli -t -f NAME,TYPE connection show | awk -F: '$2=="802-11-wireless"{print $1}' |
      while IFS= read -r c; do nmcli connection delete "$c" >/dev/null || true; done
  fi
  rm -f /etc/NetworkManager/system-connections/*.nmconnection 2>/dev/null || true
fi

echo "==> Clearing logs and history"
journalctl --rotate >/dev/null 2>&1 || true
journalctl --vacuum-time=1s >/dev/null 2>&1 || true
find /var/log -type f \( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \) -delete
find /var/log -type f -exec truncate -s 0 {} +
rm -f /root/.bash_history /home/*/.bash_history

echo "==> Clearing machine-id (regenerated on first boot)"
truncate -s 0 /etc/machine-id
[[ -L /var/lib/dbus/machine-id ]] || rm -f /var/lib/dbus/machine-id

sync
echo "==> Sealed. Powering off — image the SD card once the green LED stops."
systemctl poweroff
