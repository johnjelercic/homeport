#!/usr/bin/env bash
# Homeport — make a distribution image from a sealed SD card (run on your Mac)
#
# Run after prepare-image.sh has sealed the master card and the Pi has
# powered off. Put the card in your Mac, then:
#
#   deploy/pi/make-image.sh
#
# It will:
#   1. Find the Raspberry Pi card (a physical disk with a "bootfs" partition,
#      never your Mac's startup disk) and ask you to confirm it by name
#   2. Copy the whole card to an image file (dd; needs your Mac password)
#   3. Eject the card
#   4. Shrink and compress it with PiShrink in a Linux container
#      (Docker Desktop or Colima must be running), so it's small and expands
#      to fill whatever card it's flashed to
#   5. Write a SHA-256 checksum next to it
#
# Result: <out>/<name>.img.xz and <name>.img.xz.sha256
#
# Options:
#   --disk diskN    Use this disk instead of auto-detecting (still confirmed)
#   --out DIR       Output folder (default: ~/Homeport-images; keep it inside
#                   your home folder so Colima can write to it)
#   --name NAME     Image name (default: homeport-YYYY.MM.DD, -2/-3... if taken)
#   --force         Skip the "has a bootfs partition" safety check
#   -h, --help      Show this help
#
# Written for the bash 3.2 that ships with macOS.

set -euo pipefail

OUT_DIR="$HOME/Homeport-images"
NAME=""
DISK=""
FORCE="no"
PISHRINK_URL="https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    - %s\n' "$*"; }
die()  { printf '\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p;}' "$0"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --disk)  DISK="${2:?}"; shift 2 ;;
    --out)   OUT_DIR="${2:?}"; shift 2 ;;
    --name)  NAME="${2:?}"; shift 2 ;;
    --force) FORCE="yes"; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# ---------------------------------------------------------------- preflight
[ "$(uname -s)" = "Darwin" ] || die "This script is for macOS."
[ "$(id -u)" -ne 0 ] || die "Run it as yourself, not with sudo (it asks for your password when needed)."
command -v docker >/dev/null 2>&1 || die "Docker isn't installed. Install Colima (brew install colima docker) or Docker Desktop."
docker info >/dev/null 2>&1 || die "Docker isn't running. Start it with: colima start   (or open Docker Desktop)"

case "$OUT_DIR" in
  "$HOME"/*|"$HOME") ;;
  *) echo "[warn] $OUT_DIR is outside your home folder; Colima may not be able to write there." >&2 ;;
esac
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

if [ -z "$NAME" ]; then
  NAME="homeport-$(date +%Y.%m.%d)"
  n=2; base="$NAME"
  while [ -e "$OUT_DIR/$NAME.img" ] || [ -e "$OUT_DIR/$NAME.img.xz" ]; do
    NAME="$base-$n"; n=$((n + 1))
  done
fi
IMG="$OUT_DIR/$NAME.img"
[ ! -e "$IMG" ] && [ ! -e "$IMG.xz" ] || die "$NAME.img or $NAME.img.xz already exists in $OUT_DIR (use --name)."

# ---------------------------------------------------------------- find the card
say "Finding the SD card"
BOOT_DISK="$(diskutil info / | awk -F: '/Part of Whole/ {gsub(/ /, "", $2); print $2}')"
has_bootfs() { diskutil list "$1" 2>/dev/null | grep -q ' bootfs '; }

if [ -z "$DISK" ]; then
  CANDIDATES=""
  for d in $(diskutil list physical | awk '/^\/dev\/disk[0-9]+/ {sub("/dev/", "", $1); print $1}'); do
    [ "$d" = "$BOOT_DISK" ] && continue
    if has_bootfs "$d"; then CANDIDATES="$CANDIDATES $d"; fi
  done
  # shellcheck disable=SC2086  # word-splitting the list on purpose
  set -- $CANDIDATES
  [ $# -gt 0 ] || die "No Raspberry Pi card found (no disk with a 'bootfs' partition). Is the card in? See: diskutil list"
  [ $# -eq 1 ] || die "More than one Pi card found:$CANDIDATES. Remove the extras or pass --disk diskN."
  DISK="$1"
fi
DISK="${DISK#/dev/}"
case "$DISK" in disk[0-9]*) ;; *) die "--disk should look like disk4" ;; esac
DISK="${DISK%%s[0-9]*}"   # disk4s1 -> disk4
[ "$DISK" != "$BOOT_DISK" ] && [ "$DISK" != "disk0" ] || die "$DISK is your Mac's own drive. Refusing."
diskutil info "$DISK" >/dev/null 2>&1 || die "No such disk: $DISK"
if [ "$FORCE" != "yes" ] && ! has_bootfs "$DISK"; then
  die "$DISK has no 'bootfs' partition, so it doesn't look like a Raspberry Pi card (--force to override)."
fi

DISK_SIZE_BYTES="$(diskutil info "$DISK" | awk -F'[()]' '/Disk Size/ {split($2, a, " "); print a[1]}')"
DISK_SIZE_BYTES="${DISK_SIZE_BYTES:-0}"
MEDIA="$(diskutil info "$DISK" | awk -F: '/Device \/ Media Name/ {sub(/^ +/, "", $2); print $2}')"
diskutil list "$DISK"
echo
info "Card:    /dev/$DISK  ${MEDIA:-}  ($((DISK_SIZE_BYTES / 1000000000)) GB)"
info "Image:   $IMG.xz"

FREE_KB="$(df -k "$OUT_DIR" | awk 'NR==2 {print $4}')"
NEED_KB=$((DISK_SIZE_BYTES / 1024 + 1048576))
[ "$FREE_KB" -ge "$NEED_KB" ] || die "Not enough free space in $OUT_DIR: need about $((NEED_KB / 1048576)) GB, have $((FREE_KB / 1048576)) GB."

printf '\nEverything on /dev/%s will be READ (not changed). Type %s to continue: ' "$DISK" "$DISK"
read -r answer
[ "$answer" = "$DISK" ] || die "Aborted."

START=$(date +%s)

# ---------------------------------------------------------------- copy
say "Copying the card (several minutes; press Ctrl+T for progress)"
diskutil unmountDisk "/dev/$DISK" >/dev/null
DD_PROGRESS=""
if dd if=/dev/zero of=/dev/null count=1 status=progress >/dev/null 2>&1; then DD_PROGRESS="status=progress"; fi
# One sudo for both, so a long copy can't outlast the password timeout before chown.
sudo sh -c "dd if=/dev/r$DISK of='$IMG' bs=4m $DD_PROGRESS && chown $(id -u):$(id -g) '$IMG'"
diskutil eject "/dev/$DISK" >/dev/null && info "Card ejected; you can remove it"
info "Copied $(du -h "$IMG" | awk '{print $1}')"

# ---------------------------------------------------------------- shrink
say "Shrinking and compressing with PiShrink (10-25 minutes)"
docker run --rm --privileged -v "$OUT_DIR":/work -w /work debian:stable bash -c "
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq parted e2fsprogs xz-utils wget udev >/dev/null 2>&1
  wget -q -O /usr/local/bin/pishrink.sh '$PISHRINK_URL'
  chmod +x /usr/local/bin/pishrink.sh
  pishrink.sh -Za '$NAME.img'
"
[ -f "$IMG.xz" ] || die "PiShrink didn't produce $NAME.img.xz; see its output above. The full-size $NAME.img is kept."

# ---------------------------------------------------------------- checksum
say "Writing checksum"
( cd "$OUT_DIR" && shasum -a 256 "$NAME.img.xz" > "$NAME.img.xz.sha256" )
info "$(cat "$OUT_DIR/$NAME.img.xz.sha256")"

ELAPSED=$(( $(date +%s) - START ))
say "Done in $((ELAPSED / 60))m $((ELAPSED % 60))s"
cat <<EOF
  Image:     $IMG.xz  ($(du -h "$IMG.xz" | awk '{print $1}'))
  Checksum:  $IMG.xz.sha256
  Verify a copy later:  cd "$OUT_DIR" && shasum -a 256 -c $NAME.img.xz.sha256

  Flash: Raspberry Pi Imager -> Choose OS -> Use custom -> $NAME.img.xz
         and choose NO when it offers OS customization.
EOF
