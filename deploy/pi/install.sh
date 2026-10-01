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
#
# Safe to re-run: every step checks or overwrites its own files, and the
# Homeport data/photos folders are never touched.
#
# Usage (on the Pi):
#   sudo ./install.sh [options]
#   curl -fsSL https://raw.githubusercontent.com/johnjelercic/homeport/main/deploy/pi/install.sh | sudo bash -s -- [options]
#
# Options:
#   --hostname NAME      mDNS/host name (default: homeport -> homeport.local)
#   --interval SECONDS   Watchtower update check interval (default: 300)
#   --tag TAG            Homeport image tag to follow (default: latest)
#   --kiosk              Install the HDMI kiosk (default)
#   --no-kiosk           Headless only; removes the kiosk if previously installed
#   --user NAME          Account the kiosk runs as (default: the sudo user)
#   -h, --help           Show this help

set -euo pipefail

# ---------------------------------------------------------------- defaults
HP_HOSTNAME="homeport"
HP_INTERVAL="300"
HP_TAG="latest"
HP_KIOSK="yes"
HP_USER="${SUDO_USER:-}"
HP_IMAGE="ghcr.io/johnjelercic/homeport"
HP_PORT="19156"
HP_DIR="/opt/homeport"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
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
    --user)     HP_USER="${2:?}"; shift 2 ;;
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

# ---------------------------------------------------------------- base packages
log "Installing base packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg avahi-daemon avahi-utils

# ---------------------------------------------------------------- docker
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Engine (Docker's apt repo, Debian $CODENAME)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Docker already installed: $(docker --version)"
fi

# Small, rotated container logs so they can't fill or wear out the SD card.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl enable docker >/dev/null
systemctl restart docker

if [[ -n "$HP_USER" && "$HP_USER" != "root" ]]; then
  usermod -aG docker "$HP_USER"   # lets you run docker without sudo (next login)
fi

# ---------------------------------------------------------------- hostname + mDNS
log "Setting hostname '$HP_HOSTNAME' and mDNS advertisement"
CURRENT_HOST="$(hostname)"
if [[ "$CURRENT_HOST" != "$HP_HOSTNAME" ]]; then
  hostnamectl set-hostname "$HP_HOSTNAME"
  if grep -qE '^127\.0\.1\.1\s' /etc/hosts; then
    sed -i -E "s/^127\.0\.1\.1\s.*/127.0.1.1\t$HP_HOSTNAME/" /etc/hosts
  else
    printf '127.0.1.1\t%s\n' "$HP_HOSTNAME" >> /etc/hosts
  fi
fi

# Advertise the web UI so it appears in Bonjour/mDNS browsers.
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
log "Enabling hardware watchdog and capping the system journal"
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
set -e
if ! ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1; then
  ssh-keygen -A
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

# ---------------------------------------------------------------- homeport stack
log "Writing $HP_DIR/docker-compose.yml"
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

log "Pulling and starting containers"
cd "$HP_DIR"
docker compose pull
docker compose up -d --remove-orphans

log "Waiting for Homeport to answer on port $HP_PORT"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:$HP_PORT/"; then UP=yes; break; fi
  sleep 2
done
[[ "${UP:-}" == "yes" ]] || warn "Homeport did not respond within 2 minutes; check: docker logs homeport"

# ---------------------------------------------------------------- kiosk
KIOSK_UNIT=/etc/systemd/system/homeport-kiosk.service
if [[ "$HP_KIOSK" == "yes" ]]; then
  log "Installing HDMI kiosk (cage + Chromium) for user '$HP_USER'"
  CHROMIUM_PKG=chromium
  apt-cache show chromium >/dev/null 2>&1 || CHROMIUM_PKG=chromium-browser
  apt-get install -y -q --no-install-recommends cage "$CHROMIUM_PKG" fonts-noto-color-emoji
  CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser)"
  for g in video render input; do
    if getent group "$g" >/dev/null; then usermod -aG "$g" "$HP_USER"; fi
  done

  cat > /usr/local/bin/homeport-kiosk <<EOF
#!/bin/sh
# Launched by homeport-kiosk.service inside cage (a single-app Wayland compositor).
# Waits for the local server, then opens the display full-screen.
until curl -fsS -o /dev/null http://localhost:$HP_PORT/; do sleep 2; done
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
else
  if [[ -f "$KIOSK_UNIT" ]]; then
    log "Removing HDMI kiosk"
    systemctl disable --now homeport-kiosk.service >/dev/null 2>&1 || true
    rm -f "$KIOSK_UNIT" /usr/local/bin/homeport-kiosk
    systemctl enable getty@tty1.service >/dev/null 2>&1 || true
    systemctl daemon-reload
  fi
fi

# ---------------------------------------------------------------- summary
IP="$(hostname -I | awk '{print $1}')"
log "Done"
cat <<EOF
  Homeport:    http://$HP_HOSTNAME.local:$HP_PORT/   (or http://$IP:$HP_PORT/)
  Settings:    http://$HP_HOSTNAME.local:$HP_PORT/settings.html
  Image:       $HP_IMAGE:$HP_TAG
  Watchtower:  checks every ${HP_INTERVAL}s
  Kiosk:       $HP_KIOSK
  Config:      $HP_DIR/.env  (edit, then: cd $HP_DIR && sudo docker compose up -d)
EOF
if [[ "$HP_HOSTNAME" != "$CURRENT_HOST" ]]; then
  echo "  Hostname changed from '$CURRENT_HOST': reboot recommended (sudo reboot)."
fi
