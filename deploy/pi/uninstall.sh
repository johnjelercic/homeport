#!/usr/bin/env bash
# Homeport — remove everything install.sh set up, so it can be re-tested clean
#
# Reverses install.sh:
#   - Stops and removes the Homeport and Watchtower containers and images
#   - Deletes /opt/homeport, INCLUDING Homeport data and photos (unless --keep-data)
#   - Purges Docker Engine, its data (/var/lib/docker) and apt repo (unless --keep-docker)
#   - Removes the HDMI kiosk and restores the original boot mode (desktop/console)
#   - Removes the Wi-Fi setup hotspot (saved Wi-Fi networks are kept)
#   - Removes the mDNS advert, watchdog/journal settings and first-boot service
#   - Purges only the packages install.sh newly installed, removes group
#     memberships it added, and restores the original hostname
#
# Kept: your user, SSH keys and authorized_keys, Wi-Fi, and anything Pi OS
# shipped with (e.g. avahi-daemon, so <hostname>.local keeps working).
#
# Usage:
#   sudo ./uninstall.sh                 # asks for confirmation
#   sudo ./uninstall.sh --yes           # no prompt
#   sudo ./uninstall.sh --keep-docker   # faster re-tests: keep Docker installed
#   sudo ./uninstall.sh --keep-data     # keep /opt/homeport/data and photos
#   sudo ./uninstall.sh --keep-commands # keep homeport-install/-uninstall for the next test
# (sudo homeport-uninstall takes the same options.)

set -euo pipefail

HP_DIR="/opt/homeport"
STATE_DIR="/var/lib/homeport-install"
LOG_FILE="/var/log/homeport-install.log"
DOCKER_PKGS=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras)
ASSUME_YES="no"; KEEP_DOCKER="no"; KEEP_DATA="no"; KEEP_COMMANDS="no"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    - %s\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*" >&2; }

for a in "$@"; do
  case "$a" in
    --yes|-y)      ASSUME_YES="yes" ;;
    --keep-docker) KEEP_DOCKER="yes" ;;
    --keep-data)   KEEP_DATA="yes" ;;
    --keep-commands) KEEP_COMMANDS="yes" ;;
    -h|--help)     sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 1 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

if [[ "$ASSUME_YES" != "yes" ]]; then
  echo "This removes the Homeport install from this Pi:"
  [[ "$KEEP_DATA"   == "yes" ]] || echo "  - ALL Homeport data and photos in $HP_DIR"
  [[ "$KEEP_DOCKER" == "yes" ]] || echo "  - Docker Engine and every container/image on this Pi"
  echo "  - the kiosk, mDNS advert, watchdog/log settings and packages install.sh added"
  read -r -p "Type REMOVE to continue: " answer </dev/tty
  [[ "$answer" == "REMOVE" ]] || { echo "Aborted."; exit 1; }
fi

if [[ -d "$STATE_DIR" ]]; then
  HAVE_STATE="yes"
else
  HAVE_STATE="no"
  warn "No install record in $STATE_DIR (installed by an older install.sh): using safe defaults."
fi
recorded_pkgs() { [[ -f "$STATE_DIR/packages" ]] && cat "$STATE_DIR/packages"; return 0; }
is_docker_pkg() { local p; for p in "${DOCKER_PKGS[@]}"; do [[ "$1" == "$p" ]] && return 0; done; return 1; }

# ---------------------------------------------------------------- kiosk
log "HDMI kiosk"
if [[ -f /etc/systemd/system/homeport-kiosk.service ]]; then
  systemctl disable --now homeport-kiosk.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/homeport-kiosk.service /usr/local/bin/homeport-kiosk
  info "Removed homeport-kiosk.service"
else
  info "Not installed"
fi
systemctl enable getty@tty1.service >/dev/null 2>&1 || true

if [[ -f "$STATE_DIR/boot" ]]; then
  # shellcheck source=/dev/null
  . "$STATE_DIR/boot"
else
  # No record: desktop images have a display manager, Lite doesn't.
  if systemctl cat display-manager.service >/dev/null 2>&1; then
    ORIG_TARGET=graphical.target; ORIG_DM=enabled
  else
    ORIG_TARGET=multi-user.target; ORIG_DM=none
  fi
fi
systemctl set-default "${ORIG_TARGET:-multi-user.target}" >/dev/null
info "Boot mode restored: ${ORIG_TARGET:-multi-user.target}"
if [[ "${ORIG_DM:-none}" == "enabled" ]]; then
  # display-manager.service is an alias; enable whichever greeter provides it.
  for dm in lightdm gdm3 sddm; do
    if systemctl cat "$dm.service" >/dev/null 2>&1; then
      systemctl enable "$dm.service" >/dev/null 2>&1 || true
      info "Desktop login re-enabled ($dm)"
      break
    fi
  done
fi

# ---------------------------------------------------------------- wifi setup
log "Wi-Fi setup hotspot"
if [[ -f /etc/systemd/system/homeport-wifi-setup.service ]]; then
  systemctl disable --now homeport-wifi-setup.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/homeport-wifi-setup.service
  info "Removed homeport-wifi-setup.service"
else
  info "Not installed"
fi
nmcli connection delete homeport-setup >/dev/null 2>&1 || true
rm -f /etc/NetworkManager/dnsmasq-shared.d/homeport-captive.conf
rm -rf /etc/homeport

# ---------------------------------------------------------------- containers
log "Homeport and Watchtower containers"
if command -v docker >/dev/null 2>&1 && [[ -f "$HP_DIR/docker-compose.yml" ]]; then
  (cd "$HP_DIR" && docker compose down --rmi all --volumes --remove-orphans) || warn "docker compose down failed; continuing"
else
  info "Nothing running from $HP_DIR"
fi

if [[ "$KEEP_DATA" == "yes" && -d "$HP_DIR" ]]; then
  rm -f "$HP_DIR/docker-compose.yml" "$HP_DIR/.env"
  info "Kept $HP_DIR/data and $HP_DIR/photos"
else
  rm -rf "$HP_DIR"
  info "Deleted $HP_DIR"
fi

# ---------------------------------------------------------------- docker
log "Docker Engine"
if [[ "$KEEP_DOCKER" == "yes" ]]; then
  info "Kept (--keep-docker)"
else
  systemctl stop docker.service docker.socket containerd.service >/dev/null 2>&1 || true
  installed=()
  for p in "${DOCKER_PKGS[@]}"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" && installed+=("$p")
  done
  if (( ${#installed[@]} )); then
    apt-get purge -y "${installed[@]}"
  fi
  rm -rf /var/lib/docker /var/lib/containerd /etc/docker
  rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.asc
  getent group docker >/dev/null && groupdel docker || true
  info "Docker, its data and apt repository removed"
fi

# ---------------------------------------------------------------- other packages
log "Packages added by install.sh"
to_purge=()
if [[ "$HAVE_STATE" == "yes" ]]; then
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    is_docker_pkg "$p" && continue          # handled above
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" && to_purge+=("$p")
  done < <(recorded_pkgs)
else
  # Old install with no record: the kiosk packages are the only safe guesses.
  # Chromium ships with Pi OS Desktop, so only remove it on Lite.
  for p in cage fonts-noto-color-emoji; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" && to_purge+=("$p")
  done
  if ! systemctl cat display-manager.service >/dev/null 2>&1; then
    for p in chromium chromium-browser; do
      dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" && to_purge+=("$p")
    done
  fi
fi
if (( ${#to_purge[@]} )); then
  info "Purging: ${to_purge[*]}"
  apt-get purge -y "${to_purge[@]}"
else
  info "None to remove"
fi
apt-get autoremove -y --purge
apt-get update -q || true

# ---------------------------------------------------------------- groups
if [[ -f "$STATE_DIR/groups" ]]; then
  log "Group memberships added by install.sh"
  while IFS=: read -r u g; do
    [[ -n "$u" && -n "$g" ]] || continue
    if getent group "$g" >/dev/null && gpasswd -d "$u" "$g" >/dev/null 2>&1; then
      info "Removed $u from $g"
    fi
  done < "$STATE_DIR/groups"
fi

# ---------------------------------------------------------------- system settings
log "mDNS advert, watchdog, journal cap, first-boot service"
rm -f /etc/avahi/services/homeport.service
systemctl restart avahi-daemon >/dev/null 2>&1 || true
systemctl disable homeport-firstboot.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/homeport-firstboot.service /usr/local/sbin/homeport-firstboot
rm -f /etc/systemd/system.conf.d/homeport-watchdog.conf /etc/systemd/journald.conf.d/homeport.conf
systemctl daemon-reload
systemctl daemon-reexec
systemctl restart systemd-journald
info "Removed"

# ---------------------------------------------------------------- hostname
if [[ -f "$STATE_DIR/hostname" ]]; then
  ORIG_HOST="$(cat "$STATE_DIR/hostname")"
  if [[ -n "$ORIG_HOST" && "$ORIG_HOST" != "$(hostname)" ]]; then
    log "Restoring hostname '$ORIG_HOST'"
    hostnamectl set-hostname "$ORIG_HOST"
    sed -i -E "s/^127\.0\.1\.1\s.*/127.0.1.1\t$ORIG_HOST/" /etc/hosts
  fi
fi

# ---------------------------------------------------------------- commands
# Safe even when this script is running from /usr/local/lib/homeport: bash
# keeps reading the already-open file after it's unlinked.
if [[ "$KEEP_COMMANDS" == "yes" ]]; then
  log "Kept homeport-install and homeport-uninstall (--keep-commands)"
else
  log "Removing homeport-install and homeport-uninstall"
  rm -f /usr/local/sbin/homeport-install /usr/local/sbin/homeport-uninstall
  rm -rf /usr/local/lib/homeport
  info "To install again: curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash"
fi

rm -rf "$STATE_DIR"
rm -f "$LOG_FILE"

log "Done. Reboot to finish (resets the watchdog, boot mode and group changes): sudo reboot"
