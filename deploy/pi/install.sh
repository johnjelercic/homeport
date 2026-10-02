#!/usr/bin/env bash
# Homeport — Raspberry Pi appliance installer
#
# Turns a fresh Raspberry Pi OS (64-bit, Lite or Desktop) install into a
# Homeport appliance:
#   - Docker Engine + Compose plugin (Docker's official apt repo)
#   - Homeport + Watchtower, defined in /opt/homeport/docker-compose.yml
#   - mDNS: reachable as http://<hostname>.local:19156, advertised as a web service
#   - Hardware watchdog, capped logs (SD-card wear), auto-restart on boot
#   - Optional HDMI kiosk: full-screen Chromium on the attached display,
#     which simply stays idle when no display is plugged in
#   - Wi-Fi setup hotspot: with no network, broadcasts "Homeport-Setup-XXXX";
#     joining it from a phone opens a page to pick the home Wi-Fi network
#
# This is the appliance installer for Raspberry Pi OS. On any other Linux
# box or NAS that already runs Docker, use deploy/docker/ instead (DIY).
#
# Safe to re-run: every step checks or overwrites its own files, and the
# Homeport data/photos folders are never touched.
#
# Usage (on the Pi):
#   First install:  curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash
#   Afterwards:     sudo homeport-install [options]     (fetches the latest script itself)
#                   sudo homeport-uninstall [options]
#   Or locally:     sudo ./install.sh [options]
#
# homeport-install / homeport-uninstall download the latest script from
# GitHub each run and fall back to the copy saved in /usr/local/lib/homeport
# when offline; --local skips the download.
#
# Options:
#   --hostname NAME      mDNS/host name (default: homeport -> homeport.local)
#   --interval SECONDS   Watchtower update check interval (default: 300)
#   --tag TAG            Homeport image tag to follow (default: latest)
#   --kiosk              Install the HDMI kiosk (default)
#   --no-kiosk           Headless only; removes the kiosk if previously installed
#   --user NAME          Account the kiosk runs as (default: the sudo user)
#   --no-wifi-setup      Skip the Wi-Fi setup hotspot (removes it if installed)
#   --wifi-country CC    Wi-Fi country code if none is set yet (default: US)
#   --verbose            Show full apt/docker output on screen too
#   --debug              Also echo every command as it runs (bash -x)
#   -h, --help           Show this help
#
# What it changes is recorded in /var/lib/homeport-install/ so uninstall.sh
# can reverse exactly that (and leave anything Pi OS already had alone).
#
# The screen shows numbered steps and a line or two per step; the full
# apt/docker output goes to /var/log/homeport-install.log (and is shown
# automatically if a command fails).

set -euo pipefail

# ---------------------------------------------------------------- defaults
HP_HOSTNAME="homeport"
HP_INTERVAL="300"
HP_TAG="latest"
HP_KIOSK="yes"
HP_WIFI_SETUP="yes"
HP_WIFI_COUNTRY="US"
HP_USER="${SUDO_USER:-}"
HP_IMAGE="ghcr.io/johnjelercic/homeport"
HP_PORT="19156"
HP_DIR="/opt/homeport"
HP_LIB_DIR="/usr/local/lib/homeport"
HP_SCRIPTS_URL="${HOMEPORT_SCRIPTS_URL:-https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi}"

HP_DEBUG="no"
HP_VERBOSE="no"
LOG_FILE="/var/log/homeport-install.log"
STEP=0
STEPS_TOTAL=9
step() { STEP=$((STEP+1)); printf '\n\033[1;34m==> [%d/%d] %s\033[0m  \033[2m(%s, +%ss)\033[0m\n' "$STEP" "$STEPS_TOTAL" "$*" "$(date +%H:%M:%S)" "$SECONDS"; }
log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    - %s\n' "$*"; }
# run CMD...: noisy commands write only to the log file; on failure, show its tail.
run() {
  if [[ "$HP_VERBOSE" == "yes" ]]; then "$@"; return; fi
  if ! "$@" >>"$LOG_FILE" 2>&1; then
    warn "Failed: $*"
    warn "Last lines of $LOG_FILE:"
    tail -n 25 "$LOG_FILE" >&2
    return 1
  fi
}
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }
usage() {
  if [[ -f "$0" ]]; then sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "$0"
  else echo "See the header of deploy/pi/install.sh for options."; fi
  exit 0
}

# ---------------------------------------------------------------- args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) HP_HOSTNAME="${2:?}"; shift 2 ;;
    --interval) HP_INTERVAL="${2:?}"; shift 2 ;;
    --tag)      HP_TAG="${2:?}"; shift 2 ;;
    --kiosk)    HP_KIOSK="yes"; shift ;;
    --no-kiosk) HP_KIOSK="no"; shift ;;
    --wifi-setup)    HP_WIFI_SETUP="yes"; shift ;;
    --no-wifi-setup) HP_WIFI_SETUP="no"; shift ;;
    --wifi-country)  HP_WIFI_COUNTRY="${2:?}"; shift 2 ;;
    --user)     HP_USER="${2:?}"; shift 2 ;;
    --debug)    HP_DEBUG="yes"; shift ;;
    --verbose)  HP_VERBOSE="yes"; shift ;;
    -h|--help)  usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# ---------------------------------------------------------------- preflight
[[ $EUID -eq 0 ]] || die "Run with sudo."
[[ "$(dpkg --print-architecture)" == "arm64" ]] || die "Needs 64-bit Raspberry Pi OS (arm64)."
[[ "$HP_INTERVAL" =~ ^[0-9]+$ ]] || die "--interval must be a number of seconds."
[[ "$HP_HOSTNAME" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "--hostname: lowercase letters, digits and hyphens only."
if [[ "$HP_KIOSK" == "yes" ]]; then
  [[ -n "$HP_USER" && "$HP_USER" != "root" ]] || die "Kiosk needs a non-root account: run via sudo from it, or pass --user NAME."
  id "$HP_USER" >/dev/null 2>&1 || die "User '$HP_USER' does not exist."
fi
# shellcheck source=/dev/null
. /etc/os-release
CODENAME="${VERSION_CODENAME:?}"
export DEBIAN_FRONTEND=noninteractive

# Mirror all output (ours, apt's, docker's) to a log file as well as the screen.
exec > >(tee -a "$LOG_FILE") 2>&1
[[ "$HP_DEBUG" == "yes" ]] && set -x

# Scripts version: deploy/VERSION (separate from the app's VERSION so that
# script-only changes don't rebuild the image). Next to a repo checkout, read
# it there; otherwise from GitHub; otherwise the copy saved at the last install.
SCRIPTS_VERSION=""
_self="$(realpath "$0" 2>/dev/null || true)"
if [[ -n "$_self" && -f "$(dirname "$_self")/../VERSION" ]]; then
  SCRIPTS_VERSION="$(head -n1 "$(dirname "$_self")/../VERSION")"
else
  SCRIPTS_VERSION="$(curl -fs --max-time 10 "${HP_SCRIPTS_URL%/pi}/VERSION" 2>/dev/null | head -n1 || true)"
fi
[[ -n "$SCRIPTS_VERSION" ]] || SCRIPTS_VERSION="$(cat "$HP_LIB_DIR/scripts-version" 2>/dev/null || echo unknown)"

log "Homeport installer v$SCRIPTS_VERSION — $(date '+%Y-%m-%d %H:%M:%S')"
info "OS:          $PRETTY_NAME ($(uname -m))"
info "Hostname:    $HP_HOSTNAME   (currently: $(hostname))"
info "Image:       $HP_IMAGE:$HP_TAG"
info "Watchtower:  every ${HP_INTERVAL}s"
info "Kiosk:       $HP_KIOSK${HP_USER:+ (user: $HP_USER)}"
info "Wi-Fi setup: $HP_WIFI_SETUP"
info "Log file:    $LOG_FILE"

# ---------------------------------------------------------------- change tracking
# Records what this script adds, so uninstall.sh removes only that.
STATE_DIR="/var/lib/homeport-install"
mkdir -p "$STATE_DIR"
[[ -f "$STATE_DIR/hostname" ]] || hostname > "$STATE_DIR/hostname"
pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }
# apt_install [apt options] PKG...: installs, and records packages that weren't already present.
apt_install() {
  local a new=()
  for a in "$@"; do [[ "$a" == -* ]] || pkg_installed "$a" || new+=("$a"); done
  run apt-get install -y "$@"
  for a in "${new[@]}"; do
    grep -qx "$a" "$STATE_DIR/packages" 2>/dev/null || echo "$a" >> "$STATE_DIR/packages"
  done
  if (( ${#new[@]} )); then info "Newly installed: ${new[*]}"; fi
}
# add_group USER GROUP: adds membership, and records it if it's new.
add_group() {
  if id -nG "$1" | tr ' ' '\n' | grep -qx "$2"; then return 0; fi
  usermod -aG "$2" "$1"
  echo "$1:$2" >> "$STATE_DIR/groups"
}

# ---------------------------------------------------------------- base packages
step "Installing base packages (curl, certificates, Avahi mDNS)"
run apt-get update
apt_install ca-certificates curl gnupg avahi-daemon avahi-utils

# ---------------------------------------------------------------- docker
step "Docker Engine"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  info "Not installed: adding Docker's apt repository (Debian $CODENAME) and installing"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  run apt-get update
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  info "Already installed"
fi
info "$(docker --version)"
info "$(docker compose version)"
info "Writing /etc/docker/daemon.json (rotated logs: 3 x 10 MB per container)"

# Small, rotated container logs so they can't fill or wear out the SD card.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
info "Restarting Docker to apply log settings"
systemctl enable docker >/dev/null
systemctl restart docker

if [[ -n "$HP_USER" && "$HP_USER" != "root" ]]; then
  add_group "$HP_USER" docker   # lets you run docker without sudo (next login)
  info "Added '$HP_USER' to the docker group (takes effect at next login)"
fi

# ---------------------------------------------------------------- hostname + mDNS
step "Hostname and mDNS"
CURRENT_HOST="$(hostname)"
if [[ "$CURRENT_HOST" != "$HP_HOSTNAME" ]]; then
  info "Changing hostname: $CURRENT_HOST -> $HP_HOSTNAME"
  hostnamectl set-hostname "$HP_HOSTNAME"
  if grep -qE '^127\.0\.1\.1\s' /etc/hosts; then
    sed -i -E "s/^127\.0\.1\.1\s.*/127.0.1.1\t$HP_HOSTNAME/" /etc/hosts
  else
    printf '127.0.1.1\t%s\n' "$HP_HOSTNAME" >> /etc/hosts
  fi
fi

[[ "$CURRENT_HOST" == "$HP_HOSTNAME" ]] && info "Hostname already '$HP_HOSTNAME'"
# Advertise the web UI so it appears in Bonjour/mDNS browsers.
info "Advertising http://$HP_HOSTNAME.local:$HP_PORT/ via Avahi (_http._tcp)"
cat > /etc/avahi/services/homeport.service <<EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Homeport on %h</name>
  <service>
    <type>_http._tcp</type>
    <port>$HP_PORT</port>
    <txt-record>path=/</txt-record>
  </service>
</service-group>
EOF
systemctl enable avahi-daemon >/dev/null
systemctl restart avahi-daemon

# ---------------------------------------------------------------- reliability
step "Reliability: watchdog, log caps, first-boot SSH host keys"
info "Hardware watchdog: reboot if the system hangs for 15s"
info "System journal capped at 64 MB"
mkdir -p /etc/systemd/system.conf.d /etc/systemd/journald.conf.d
cat > /etc/systemd/system.conf.d/homeport-watchdog.conf <<'EOF'
# Reboot automatically if the system hangs (Pi hardware watchdog).
[Manager]
RuntimeWatchdogSec=15
RebootWatchdogSec=2min
EOF
cat > /etc/systemd/journald.conf.d/homeport.conf <<'EOF'
[Journal]
SystemMaxUse=64M
EOF
systemctl daemon-reexec
systemctl restart systemd-journald

# Unique SSH host keys / machine-id on every unit cloned from an image.
# Only acts when prepare-image.sh has removed them; a no-op otherwise.
cat > /usr/local/sbin/homeport-firstboot <<'EOF'
#!/bin/sh
# Runs once, on the first boot of a card made from a sealed image
# (prepare-image.sh removes the SSH host keys; this puts new ones back).
set -e
if ! ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1; then
  ssh-keygen -A
  # The master's last login session writes its shell history while the Pi
  # shuts down, after prepare-image.sh has already cleared it. Remove it here,
  # before anyone can log in to the new unit.
  for h in /root /home/*; do
    rm -f "$h/.bash_history" "$h/.zsh_history" "$h/.lesshst" "$h/.python_history" "$h/.wget-hsts"
  done
fi
EOF
chmod 755 /usr/local/sbin/homeport-firstboot
cat > /etc/systemd/system/homeport-firstboot.service <<'EOF'
[Unit]
Description=Homeport first boot: generate unique SSH host keys
Before=ssh.service ssh.socket
ConditionPathExists=!/etc/ssh/ssh_host_ed25519_key

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/homeport-firstboot

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable homeport-firstboot.service >/dev/null
info "homeport-firstboot.service enabled (regenerates SSH host keys on cloned units)"

# ---------------------------------------------------------------- homeport stack
step "Homeport and Watchtower containers"
info "Writing $HP_DIR/docker-compose.yml and .env"
mkdir -p "$HP_DIR/data" "$HP_DIR/photos"
TZ_HOST="$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)"

# .env holds the knobs; edit and run `docker compose up -d` to apply.
# Rewritten on every run from the options passed to this script.
cat > "$HP_DIR/.env" <<EOF
HOMEPORT_IMAGE=$HP_IMAGE:$HP_TAG
WATCHTOWER_POLL_INTERVAL=$HP_INTERVAL
TZ=$TZ_HOST
EOF

cat > "$HP_DIR/docker-compose.yml" <<'EOF'
# Managed by deploy/pi/install.sh — re-running the installer overwrites this.
# Settings live in .env next to this file.
services:
  homeport:
    image: ${HOMEPORT_IMAGE}
    container_name: homeport
    restart: unless-stopped
    ports:
      - "19156:19156"
    volumes:
      - ./data:/app/data
      - ./photos:/app/public/photos
    environment:
      - TZ=${TZ}
      - SYNC_INTERVAL_MINUTES=15
    labels:
      - "com.centurylinklabs.watchtower.enable=true"

  # Maintained fork of Watchtower: the original containrrr/watchtower is
  # unmaintained and fails against current Docker Engine API versions.
  watchtower:
    image: nickfedor/watchtower:latest
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - TZ=${TZ}
      - WATCHTOWER_POLL_INTERVAL=${WATCHTOWER_POLL_INTERVAL}
      - WATCHTOWER_LABEL_ENABLE=true   # only update containers labelled below
      - WATCHTOWER_CLEANUP=true        # delete superseded images (SD space)
      - WATCHTOWER_INCLUDE_RESTARTING=true
    labels:
      - "com.centurylinklabs.watchtower.enable=true"   # keep itself patched
EOF

info "Timezone: $TZ_HOST"
info "Pulling images (first run downloads ~100-200 MB)"
cd "$HP_DIR"
run docker compose pull
info "Starting containers"
run docker compose up -d --remove-orphans
info "Running: $(docker compose ps --format '{{.Name}}' | paste -sd ' ')"

step "Waiting for Homeport to answer on port $HP_PORT"
for i in $(seq 1 60); do
  if curl -fs -o /dev/null "http://localhost:$HP_PORT/"; then UP=yes; break; fi
  (( i % 15 == 0 )) && info "still waiting... ($((i * 2))s)"
  sleep 2
done
if [[ "${UP:-}" == "yes" ]]; then
  info "Homeport is up"
else
  warn "Homeport did not respond within 2 minutes; recent container logs:"
  docker logs --tail 30 homeport || true
fi

# ---------------------------------------------------------------- kiosk
KIOSK_UNIT=/etc/systemd/system/homeport-kiosk.service
step "HDMI kiosk"
if [[ "$HP_KIOSK" == "yes" ]]; then
  info "Installing cage + Chromium for user '$HP_USER' (Chromium is a large download)"
  CHROMIUM_PKG=chromium
  apt-cache show chromium >/dev/null 2>&1 || CHROMIUM_PKG=chromium-browser
  apt_install --no-install-recommends cage "$CHROMIUM_PKG" fonts-noto-color-emoji
  CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser)"
  for g in video render input; do
    if getent group "$g" >/dev/null; then add_group "$HP_USER" "$g"; fi
  done

  cat > /usr/local/bin/homeport-kiosk <<EOF
#!/bin/sh
# Launched by homeport-kiosk.service inside cage (a single-app Wayland compositor).
# Waits for the local server, then opens the display full-screen.
until curl -fs -o /dev/null http://localhost:$HP_PORT/; do sleep 2; done
exec $CHROMIUM_BIN \\
  --kiosk --ozone-platform=wayland \\
  --noerrdialogs --disable-infobars --no-first-run \\
  --disable-session-crashed-bubble --disable-features=Translate \\
  --password-store=basic --check-for-update-interval=31536000 \\
  --autoplay-policy=no-user-gesture-required \\
  http://localhost:$HP_PORT/
EOF
  chmod 755 /usr/local/bin/homeport-kiosk

  # Waits (indefinitely, checking every 15s) for an HDMI display to report
  # "connected", so a headless unit just idles and plugging a display in
  # later brings the kiosk up. Unplugging it ends cage; Restart re-arms the wait.
  cat > "$KIOSK_UNIT" <<EOF
[Unit]
Description=Homeport HDMI kiosk
After=docker.service systemd-user-sessions.service network-online.target
Wants=network-online.target
Conflicts=getty@tty1.service

[Service]
User=$HP_USER
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
TimeoutStartSec=infinity
ExecStartPre=/bin/sh -c 'until cat /sys/class/drm/card*-HDMI-A-*/status 2>/dev/null | grep -qx connected; do sleep 15; done'
ExecStart=/usr/bin/cage -s -- /usr/local/bin/homeport-kiosk
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF
  # Remember the boot mode before the kiosk changes it (first run only).
  if [[ ! -f "$STATE_DIR/boot" ]]; then
    DM_STATE="$(systemctl is-enabled display-manager.service 2>/dev/null)" || true
    printf 'ORIG_TARGET=%s\nORIG_DM=%s\n' "$(systemctl get-default)" "${DM_STATE:-none}" > "$STATE_DIR/boot"
  fi
  # A desktop session would fight the kiosk for the display: boot to console.
  if systemctl list-unit-files display-manager.service >/dev/null 2>&1 && \
     systemctl is-enabled display-manager.service >/dev/null 2>&1; then
    warn "Disabling the desktop login (display manager) in favour of the kiosk."
    systemctl disable display-manager.service >/dev/null 2>&1 || true
  fi
  systemctl set-default multi-user.target >/dev/null
  systemctl disable getty@tty1.service >/dev/null 2>&1 || true
  systemctl daemon-reload
  systemctl enable homeport-kiosk.service >/dev/null
  systemctl restart --no-block homeport-kiosk.service || true
  if grep -qx connected /sys/class/drm/card*-HDMI-A-*/status 2>/dev/null; then
    info "HDMI display detected: kiosk starting now"
  else
    info "No HDMI display connected: kiosk will start when one is plugged in"
  fi
else
  if [[ ! -f "$KIOSK_UNIT" ]]; then
    info "Skipped (--no-kiosk)"
  else
    info "Removing previously installed kiosk"
    systemctl disable --now homeport-kiosk.service >/dev/null 2>&1 || true
    rm -f "$KIOSK_UNIT" /usr/local/bin/homeport-kiosk
    systemctl enable getty@tty1.service >/dev/null 2>&1 || true
    systemctl daemon-reload
  fi
fi

# ---------------------------------------------------------------- management commands
step "Management commands: homeport-install, homeport-uninstall"
mkdir -p "$HP_LIB_DIR"
echo "$HP_SCRIPTS_URL" > "$HP_LIB_DIR/scripts-url"
echo "$SCRIPTS_VERSION" > "$HP_LIB_DIR/scripts-version"
SELF="$(realpath "$0" 2>/dev/null || true)"
SELF_DIR="$(dirname "$SELF")"

# valid_script FILE NAME: syntax-check a download before trusting it.
valid_script() {
  case "$2" in
    *.py) python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read())' "$1" 2>/dev/null ;;
    *)    bash -n "$1" 2>/dev/null ;;
  esac
}
# save_script NAME LOCAL_SOURCE: keep a copy on this Pi as the offline fallback.
# Prefers the copy being run right now (so testing an unpushed edit saves that
# edit); otherwise downloads it; otherwise keeps any copy already saved.
save_script() {
  local name="$1" src="$2" dest="$HP_LIB_DIR/$1"
  if [[ -f "$src" && "$src" != "$dest" ]]; then
    install -m 755 "$src" "$dest"; info "Saved $name (from $src)"
  elif [[ "$src" == "$dest" ]]; then
    info "Saved $name is the copy running now"
  elif curl -fsSL --max-time 30 "$HP_SCRIPTS_URL/$name" -o "$dest.new" && valid_script "$dest.new" "$name"; then
    install -m 755 "$dest.new" "$dest"; rm -f "$dest.new"; info "Saved $name (latest from GitHub)"
  else
    rm -f "$dest.new"
    if [[ -f "$dest" ]]; then warn "Couldn't download $name; keeping the previously saved copy"
    else warn "Couldn't download $name"; fi
  fi
}
if [[ -n "$SELF" && "$(basename "$SELF")" == "install.sh" ]]; then
  save_script install.sh "$SELF"
  # Run via homeport-install, the saved uninstall.sh sits beside us: refresh it from GitHub instead.
  if [[ "$SELF_DIR" == "$HP_LIB_DIR" ]]; then save_script uninstall.sh ""
  else save_script uninstall.sh "$SELF_DIR/uninstall.sh"; fi
else
  save_script install.sh ""      # piped from curl: nothing on disk to copy
  save_script uninstall.sh ""
fi

# One wrapper serves both commands; it works out which script from its own name.
cat > "$HP_LIB_DIR/run-latest" <<'EOF'
#!/usr/bin/env bash
# homeport-install / homeport-uninstall: run the latest script from GitHub,
# or the copy saved on this Pi when offline. --local skips the download.
set -euo pipefail
LIB_DIR=/usr/local/lib/homeport
NAME="$(basename "$0")"; SCRIPT="${NAME#homeport-}.sh"
[[ $EUID -eq 0 ]] || exec sudo "$0" "$@"
USE_LOCAL=no; ARGS=()
for a in "$@"; do
  if [[ "$a" == "--local" ]]; then USE_LOCAL=yes; else ARGS+=("$a"); fi
done
BASE_URL="${HOMEPORT_SCRIPTS_URL:-$(cat "$LIB_DIR/scripts-url" 2>/dev/null || true)}"
if [[ "$USE_LOCAL" == "no" && -n "$BASE_URL" ]]; then
  TMP="$(mktemp)"
  if curl -fsSL --max-time 30 "$BASE_URL/$SCRIPT" -o "$TMP" && bash -n "$TMP"; then
    install -m 755 "$TMP" "$LIB_DIR/$SCRIPT"
    echo "==> Running latest $SCRIPT from $BASE_URL"
  else
    echo "[warn] Couldn't download $SCRIPT; using the copy saved on this Pi" >&2
  fi
  rm -f "$TMP"
else
  echo "==> Running saved $SCRIPT ($LIB_DIR)"
fi
[[ -f "$LIB_DIR/$SCRIPT" ]] || { echo "[error] No saved copy of $SCRIPT in $LIB_DIR" >&2; exit 1; }
exec bash "$LIB_DIR/$SCRIPT" "${ARGS[@]}"
EOF
chmod 755 "$HP_LIB_DIR/run-latest"
ln -sf "$HP_LIB_DIR/run-latest" /usr/local/sbin/homeport-install
ln -sf "$HP_LIB_DIR/run-latest" /usr/local/sbin/homeport-uninstall
info "Installed /usr/local/sbin/homeport-install and homeport-uninstall"

# ---------------------------------------------------------------- wifi setup
step "Wi-Fi setup hotspot"
WIFI_UNIT=/etc/systemd/system/homeport-wifi-setup.service
# First real Wi-Fi adapter NetworkManager knows, preferring the built-in wlan0
# (the same rule wifi-setup.py uses at runtime).
WIFI_DEV=""
if command -v nmcli >/dev/null 2>&1; then
  while IFS=: read -r dev type; do
    [[ "$type" == "wifi" && -e "/sys/class/net/$dev/device" ]] || continue
    if [[ -z "$WIFI_DEV" || "$dev" == "wlan0" ]]; then WIFI_DEV="$dev"; fi
  done < <(nmcli -t -f DEVICE,TYPE device 2>/dev/null)
fi
if [[ "$HP_WIFI_SETUP" == "yes" ]]; then
  if ! systemctl is-active --quiet NetworkManager; then
    warn "NetworkManager isn't running (needs Pi OS Bookworm or newer): skipping Wi-Fi setup"
  elif [[ -z "$WIFI_DEV" ]]; then
    warn "No Wi-Fi adapter found: skipping Wi-Fi setup"
  else
    info "Wi-Fi adapter: $WIFI_DEV"
    apt_install python3
    # Pi OS keeps Wi-Fi switched off until a country is set (radio regulations).
    if command -v raspi-config >/dev/null 2>&1; then
      WIFI_CC="$(raspi-config nonint get_wifi_country 2>/dev/null || true)"
      if [[ -z "$WIFI_CC" ]]; then
        if raspi-config nonint do_wifi_country "$HP_WIFI_COUNTRY" >/dev/null 2>&1; then
          info "Wi-Fi country set to $HP_WIFI_COUNTRY"
        else
          warn "Couldn't set the Wi-Fi country; set it with: sudo raspi-config"
        fi
      else
        info "Wi-Fi country: $WIFI_CC"
      fi
    fi
    # Wi-Fi can be off in two places: rfkill, and NetworkManager's own saved
    # switch. rfkill alone isn't enough, so turn both on.
    rfkill unblock wifi 2>/dev/null || true
    nmcli radio wifi on 2>/dev/null || true

    if [[ -n "$SELF" && "$(basename "$SELF")" == "install.sh" && "$SELF_DIR" != "$HP_LIB_DIR" ]]; then
      save_script wifi-setup.py "$SELF_DIR/wifi-setup.py"
    else
      save_script wifi-setup.py ""
    fi

    if [[ -f "$HP_LIB_DIR/wifi-setup.py" ]]; then
      mkdir -p /etc/homeport /etc/NetworkManager/dnsmasq-shared.d
      if [[ ! -f /etc/homeport/wifi-setup.conf ]]; then
        cat > /etc/homeport/wifi-setup.conf <<'EOF'
# Homeport Wi-Fi setup hotspot. Uncomment a setting to change it, then:
#   sudo systemctl restart homeport-wifi-setup
# (Keep comments on their own lines; text after a value is part of the value.)

# Wi-Fi adapter. Empty = automatic: wlan0 (built-in) if present, otherwise the
# first Wi-Fi adapter found. Set e.g. IFACE=wlan1 to force a USB adapter.
#IFACE=

# Hotspot name prefix; the last 4 characters of the Wi-Fi MAC are appended.
#SSID_PREFIX=Homeport-Setup

# Empty = open setup network. 8+ characters = WPA2-protected setup network.
#AP_PASSWORD=

# Seconds to wait for a network at boot before broadcasting.
#BOOT_GRACE=90

# Seconds offline (after having been online) before broadcasting again.
#LOST_GRACE=120

# Seconds between retries of saved networks while broadcasting.
#RETRY_SAVED_EVERY=300
EOF
      fi
      # Captive portal: while the hotspot is up, every DNS name points at the
      # setup page, so phones pop it up automatically. Only affects NetworkManager
      # "shared" connections (the hotspot), never the Pi's own DNS.
      echo "address=/#/10.42.0.1" > /etc/NetworkManager/dnsmasq-shared.d/homeport-captive.conf
      cat > "$WIFI_UNIT" <<EOF
[Unit]
Description=Homeport Wi-Fi setup hotspot
After=NetworkManager.service
Wants=NetworkManager.service

[Service]
ExecStart=/usr/bin/python3 $HP_LIB_DIR/wifi-setup.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable homeport-wifi-setup.service >/dev/null
      systemctl restart homeport-wifi-setup.service
      info "With no network for 90s at boot (2 min later on), broadcasts Homeport-Setup-$(tr -d ':' < "/sys/class/net/$WIFI_DEV/address" | tail -c 5 | tr '[:lower:]' '[:upper:]')"
      info "Settings: /etc/homeport/wifi-setup.conf   Logs: journalctl -u homeport-wifi-setup"
    else
      warn "wifi-setup.py unavailable: Wi-Fi setup not installed"
    fi
  fi
else
  if [[ -f "$WIFI_UNIT" ]]; then
    info "Removing previously installed Wi-Fi setup"
    systemctl disable --now homeport-wifi-setup.service >/dev/null 2>&1 || true
    rm -f "$WIFI_UNIT" /etc/NetworkManager/dnsmasq-shared.d/homeport-captive.conf
    nmcli connection delete homeport-setup >/dev/null 2>&1 || true
    systemctl daemon-reload
  else
    info "Skipped (--no-wifi-setup)"
  fi
fi

# ---------------------------------------------------------------- summary
IP="$(hostname -I | awk '{print $1}')"
log "Done in $((SECONDS / 60))m $((SECONDS % 60))s"
cat <<EOF
  Homeport:    http://$HP_HOSTNAME.local:$HP_PORT/   (or http://$IP:$HP_PORT/)
  Settings:    http://$HP_HOSTNAME.local:$HP_PORT/settings.html
  Image:       $HP_IMAGE:$HP_TAG
  Watchtower:  checks every ${HP_INTERVAL}s
  Kiosk:       $HP_KIOSK
  Wi-Fi setup: $HP_WIFI_SETUP
  Config:      $HP_DIR/.env  (edit, then: cd $HP_DIR && sudo docker compose up -d)
  Install log: $LOG_FILE
  Installer:   v$SCRIPTS_VERSION
  Commands:    sudo homeport-install    (update / re-run with the latest script)
               sudo homeport-uninstall  (remove everything)
EOF
if [[ "$HP_HOSTNAME" != "$CURRENT_HOST" ]]; then
  echo "  Hostname changed from '$CURRENT_HOST': reboot recommended (sudo reboot)."
fi
