# Homeport

A self-hosted family calendar display, in the spirit of Skylight/Jam,
built to run full-screen on a wall-mounted tablet. It subscribes to
any number of public ICS/webcal calendar feeds, stores the events in
a local SQLite database, and re-syncs on a schedule so the display
always reflects the source calendars — even if the display device
itself is offline for a while and then reconnects.

- **Display** (`/`) — full-screen month or week view. Tap any event
  for its full details (time, location, description). Tap a calendar
  chip in the header to show/hide that calendar for everyone.
- **Settings** (`/settings.html`) — add, recolor, hide, or remove
  calendars, see each one's last sync status, and force a manual sync.

## How it works

A background job (every 15 minutes by default) fetches each
subscribed calendar's ICS feed, parses it, and upserts the events
into a SQLite database (including recurring events — weekly/monthly
series, skipped occurrences, and single-instance edits are all
handled). The display and settings pages talk to a small REST API
backed by that database, so multiple devices (e.g. a hallway tablet
*and* someone's phone) always show the same synced state.

Only **public** calendar links are supported — anything that requires
you to log in isn't reachable by a background job. See "Finding your
calendar's link" below.

## Run it locally (no Docker)

```bash
npm install
npm start
```

Then open http://localhost:19156. Data is stored in `./data/calendar.db`.

## Deploy on a Synology NAS (Container Manager, DSM 7.2+)

Deployment is pull-based now, not build-based: GitHub Actions builds the
image automatically and publishes it to GitHub Container Registry (GHCR)
every time a change is pushed to `main`, and the NAS just pulls whatever's
current — it never builds anything itself. This is the fix for Container
Manager's build step not reliably picking up file changes (a real,
repeated problem in earlier versions of this setup): there's no build
step on the NAS to go stale in the first place.

### One-time setup: publish your own image

1. Push this repo to GitHub (see "Updating from GitHub" below if you
   haven't set that up yet).
2. Push to `main` once. Check the **Actions** tab on GitHub — you should
   see "Build and publish image" run and succeed. That builds and
   publishes `ghcr.io/<you>/homeport:latest`.
3. On GitHub, go to your profile → **Packages** → the new `homeport`
   package → **Package settings** → change visibility to **Public**.
   This lets the NAS pull it without needing to authenticate — skip this
   and Container Manager won't be able to pull the image at all.
4. Edit `docker-compose.yml` in this repo: replace
   `<your-github-username>` in the `image:` line with your actual GitHub
   username, then push that change too.

### Deploying to the NAS

1. On the NAS, create a folder (e.g. `/docker/homeport`) and put
   **`docker-compose.yml`** in it — that's the only file actually needed
   now, since nothing gets built locally anymore.
2. **Create the `data` and `photos` folders yourself first**, right next
   to `docker-compose.yml` (i.e. `/docker/homeport/data` and
   `/docker/homeport/photos`). Container Manager's bind mounts — unlike
   plain `docker compose` on Linux — don't auto-create a missing host
   folder, so skipping this causes a "Bind mount failed: ... does not
   exist" error on first start.
3. Open **Container Manager** → **Project** → **Create**.
   - Project name: `homeport`
   - Path: the folder from step 1
   - Source: "Existing docker-compose.yml" (pointing at the file you
     just placed there)
4. Build and start the project. This step is fast now — it's pulling one
   finished image, not compiling anything.
5. Visit `http://<synology-ip>:19156` from any device on your network.
6. Go to **Settings** and add your calendars.

### Updating, from here on

This project's own `docker-compose.yml` doesn't run an auto-updater —
that's a deliberate choice, not an oversight. Whether you want automatic
updates, and how, is really a decision about your NAS as a whole, not
about this one app specifically:

- **If you already run [Watchtower](https://github.com/containrrr/watchtower)
  (or something similar) elsewhere on your NAS**, point it at the
  `homeport` container the same way you would anything else. It already
  carries the `com.centurylinklabs.watchtower.enable=true` label, so if
  your existing Watchtower is running with `--label-enable`, it'll pick
  this container up with no extra configuration.
- **If you don't run one and want automatic updates**, Watchtower is
  worth setting up as its own separate Container Manager project — one
  Watchtower instance can watch every labeled container on the NAS, not
  just this one, so it belongs at the NAS level rather than duplicated
  into every individual project's compose file.
- **If you'd rather update manually**, that's just as easy either way —
  over SSH, from the project folder:
```bash
docker compose pull && docker compose up -d
```

Data persists in a `data/` folder next to `docker-compose.yml` (mapped
as a volume), so updates never touch your synced events or calendar
list. Photos for the idle-timeout photo frame work the same way via the
`photos/` folder — see "Idle timeout" below. Note the container runs as
root internally, so files inside `data/` will show as owned by
root/admin in File Station — that's normal and doesn't affect the app,
but you won't be able to casually edit them as a regular user. Files you
add to `photos/` yourself keep your own ownership, since you're the one
creating them.

**Firewall**: if you have Synology's firewall enabled (Control Panel →
Security → Firewall), add a rule allowing inbound TCP on port `19156`,
or the display/settings pages won't be reachable from other devices.

**Don't port-forward this to the internet.** Neither the display nor
the Settings page has a login — anyone who can reach port `19156` can
view, add, or delete calendars. That's fine on your home network, but
if you ever want it reachable outside your house, put it behind a
reverse proxy (Synology's own Web Station, Tailscale, or similar) that
adds authentication, rather than forwarding the port directly on your
router.

To change the sync frequency, edit `SYNC_INTERVAL_MINUTES` in
`docker-compose.yml` and restart the project.

### Building from source instead (optional)

If you'd rather not use GitHub Actions/GHCR at all — e.g. testing a
local change before pushing, or you just prefer building it yourself —
swap the `image:` line in `docker-compose.yml` back to `build: .`, and
make sure the full project (`Dockerfile`, `server/`, `public/`, not just
the compose file) is present in the folder. This reverts to the
original build-on-the-NAS behavior, first build taking a few extra
minutes to compile a native SQLite module from source.

### Plain `docker` instead of Compose (also builds from source)

```bash
docker build -t homeport .
docker run -d --name homeport \
  -p 19156:19156 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/photos:/app/public/photos \
  -e SYNC_INTERVAL_MINUTES=15 \
  --restart unless-stopped \
  homeport
```

## Updating from GitHub

The repo is the source of truth; GitHub Actions (`.github/workflows/publish.yml`)
handles turning a push into a published, pullable image automatically.
If you haven't set the repo up yet:

```bash
cd homeport
git init
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/homeport.git
git push -u origin main
```

That first push triggers the workflow above, which is what "One-time
setup" a few sections up is walking through. After that, shipping an
update is just:
```bash
git add -A
git commit -m "whatever changed"
git push
```
— GitHub builds and publishes it automatically; whether a given device
picks that up right away depends on how *that* device handles updates
(manual `docker compose pull`, or its own Watchtower — see "Updating,
from here on" above), but there's no manual rebuild step involved
anywhere in the chain either way.

## Setting up the wall display

Any tablet or mini PC with a modern browser works. Point it at
`http://<server-ip>:19156/` and put the browser in full-screen/kiosk
mode so there's no address bar or chrome:

- **Android tablet**: the free "Fully Kiosk Browser" app is the
  simplest route — set its start URL to the display address, enable
  "keep screen on," and enable auto-start on boot.
- **iPad**: Safari's "Add to Home Screen" launches as a full-screen
  web app with no browser chrome; use Guided Access to lock it there.
- **Mini PC / old laptop**: Chrome with `--kiosk http://<server-ip>:19156/`
  as a launch flag, run on startup.

The display re-checks for new events every 5 minutes on its own and
refreshes its "today" highlight automatically after midnight, so once
it's up you shouldn't need to touch it.

## Finding your calendar's link

You need each calendar's public ICS/webcal link, not a login-based
share link.

- **Google Calendar**: Settings → select the calendar → "Integrate
  calendar" → copy the **Secret address in iCal format** (or the
  **Public address**, if you've made the calendar public).
- **Apple Calendar/iCloud**: right-click the calendar → Share Calendar
  → turn on Public Calendar → copy the `webcal://` link.
- **Outlook/Office 365**: calendar settings → "Shared calendars" →
  Publish a calendar → copy the ICS link.
- Most sports leagues, school portals, and scheduling tools (TeamSnap,
  SignUpGenius, etc.) also expose an "Add to calendar" or "Subscribe"
  link in the same ICS/webcal format.

Paste that link into Settings → "Add a calendar."

## Themes

The display's color scheme is themeable — pick one from the dropdown in
Settings → Calendars tab → Theme, and it applies everywhere (every
device showing the display, and the Settings page itself), the same way
calendar visibility does. It's a dropdown rather than a grid of cards
deliberately — with a dozen-plus themes, a card per theme would make
this one section dominate the page; the dropdown keeps it compact, with
a small color-swatch preview next to it.

Ships with 12 themes: Modern (the default, year-round), Fall,
Thanksgiving, Christmas, New Year's, St. Patrick's Day, Easter, Spring,
Winter, Summer, Memorial Day, and 4th of July.

Themes are just JSON files in `public/themes/`. To add a new one, copy
an existing file (e.g. `public/themes/fall.json`), give it a unique
`id`, and adjust the colors:

```json
{
  "id": "halloween",
  "label": "Halloween",
  "description": "Pumpkin orange on near-black.",
  "emoji": "🎃",
  "colors": {
    "bg": "#1C1A22",
    "surface": "#26232C",
    "surfaceMuted": "#332F3B",
    "ink": "#F1EDE6",
    "inkSoft": "#A79FAE",
    "border": "#3D3948",
    "borderStrong": "#524C60",
    "accent": "#E8791A",
    "accentInk": "#1C1A22"
  }
}
```

`emoji` is optional — if set, it shows next to the date in the display's
header. No server restart or rebuild is needed: the theme list is read
from that folder on every request, so a new file (or an edit to an
existing one) is available the next time Settings is opened. Deleting a
file removes it from the list; if it was the active theme, the display
falls back to "Modern" (`default.json`) automatically.

Calendar colors (chosen per-calendar in Settings) are independent of
themes — a theme only changes the app's background/surface/text/accent
colors, not the colors you've assigned to individual calendars.

## Calendar colors

Each calendar's color isn't fixed at creation time — in Settings, click
a calendar's color dot (or "Customize") to change it, from either the
built-in palette or a custom color picker. No need to remove and re-add
the calendar.

**Color-coding individual events within one calendar** (e.g. a shared
family calendar where different events belong to different people) is
also supported, via keyword rules: in that same "Customize" panel,
add a rule like `John → teal` or `Marla → pink`. Any event whose title
or description contains that word (case-insensitive) shows in that
color instead of the calendar's base color — everything else on that
calendar keeps the base color. Rules apply automatically to future
synced events too, not just what's on the calendar today.

## View Preferences

Settings → View Preferences tab controls what the display looks like
when the page loads:

- **Default view** — Month, Week, or 3-Day.
- **Default layout** — Stacked or Timeline, for Week/3-Day (see below).
- **Timeline view hours** — the start/end hour Timeline layout uses
  (see below).

Like the theme, these are stored server-side, so every device showing
the display starts on the same view. The toggle buttons in the header
still work as a live, temporary override during a session — switching
views or layouts by hand doesn't change these saved defaults, it just
resets back to them the next time the page does a full reload (not a
routine data refresh, which happens every few minutes without
disturbing whatever you're currently looking at).

### Stacked vs. Timeline

When Week or 3-Day view is active, a second toggle appears
(**Stacked** / **Timeline**):

- **Stacked** (the original behavior) — events listed top to bottom in
  order, regardless of gaps between them.
- **Timeline** — events positioned by actual time of day, spaced
  proportionally within a fixed 4 AM–11 PM window so the same vertical
  position means the same time across every day column (like a real
  day planner). Condensing the range to the day's usable hours (rather
  than stretching to fit every event) gives everything in it more room
  to breathe — easier to read at a glance. Anything outside that window
  (a very early or very late event) sits flush against the top or
  bottom edge instead of expanding the range. Overlapping events on the
  same day split the column width between them; non-overlapping events
  elsewhere that day aren't affected. All-day events show as a small
  strip above the timed area rather than being placed on the timeline.
  Today's column also shows a red line marking the current time. The
  window's start/end hour (4 AM–11 PM by default) is adjustable in
  Settings → View Preferences tab → "Timeline view hours" — including a
  full 0–24 setting for a true 24-hour view.

## Weather

A small weather widget sits next to the date/clock in the header —
current temperature and today's forecasted high/low — once a ZIP code
is set in Settings → Weather tab. Tap it for a popout with a 5-day
forecast (styled like the event-location map popup below). If no ZIP
is set, the widget stays hidden rather than showing an empty or error
state.

Data comes from the National Weather Service (`api.weather.gov`) — free
and keyless, but US-only — plus Zippopotam.us to resolve the configured
ZIP code to a latitude/longitude, since NWS itself only accepts
coordinates. The server fetches and caches this the same way it already
does for calendar syncing (refreshed every 30 minutes, and immediately
whenever the ZIP is changed) — the browser never calls either API
directly.

Because this depends on resolving a ZIP code to a US location, it isn't
useful outside the US — there's no non-US equivalent built in.

## Event location maps

Opening an event that has a location shows a small embedded map of it
underneath, automatically — no setup needed. This uses Google's keyless
embed pattern (no API key or billing account required), which keeps the
app zero-configuration; it's a long-standing but technically unofficial
endpoint, so if Google ever changes it, this is the one place to update
(swap in the official Maps Embed API plus a key).

A "Starting address for directions" field sits above the map — type an
address and hit **Directions** (or Enter) to see the route and commute
time to that event, all inline. That address is remembered on this
device going forward (stored in the browser, not synced across
devices), so on a kiosk that's realistically always routing from the
same place, you set it once and every event after that shows the route
immediately. The map iframe is also sandboxed (`allow-scripts
allow-same-origin`, deliberately without popup/navigation permissions)
so nothing inside it can hijack the kiosk browser into a new tab —
important on a touchscreen where switching tabs back isn't easy.

## Idle timeout / photo frame

Settings has four tabs: **Calendars** (theme, subscribed calendars —
the default tab), **View Preferences** (default view/layout, Timeline
hours — see above), **Photo Frame** (timing and photo management,
covered below), and **Weather** (ZIP code for the weather widget — see
above). The Photo Frame tab's content — including the photo grid — is
only fetched once you actually click into it, not on page load, so
having a lot of photos never slows down opening Settings to do
something calendar-related.

After 10 minutes (adjustable) with no touch, click, or key press, the
display fades into a fullscreen photo frame — cycling through whatever's
in the `photos/` folder (next to `data/`), one photo every 20 seconds
(also adjustable), with a small clock overlaid. Each photo is shown in
full, never cropped: a softly blurred, darkened copy of the same photo
fills whatever space is left around it, so a portrait phone photo on a
landscape display doesn't lose its top/bottom the way a hard
fill-the-screen crop would. Any interaction (a tap is enough) instantly
returns to the live calendar. Calendar syncing and theme updates keep
running the whole time in the background, so the moment you tap back
in, everything's current — it doesn't need to "catch up."

**Adjusting the timing**: Settings → Photo Frame tab → "Photo frame timing" — idle
timeout in minutes (1–180) and seconds per photo (3–600). Like the
theme, this is stored server-side, so it applies to every device
showing the display, not just whichever one you changed it from. A
change takes effect from the *next* idle cycle on an already-running
display (it won't interrupt a photo frame that's already showing, or
reset a countdown that's already in progress) — every device re-checks
this roughly every 10 minutes, or immediately on its next full page
load.

**Adding photos**: Settings → Photo Frame tab → "Photos" has an upload button (accepts
multiple files at once, including straight from a phone's camera roll —
this page works fine from any device on the network, not just the
kiosk) plus a grid of everything currently in rotation with a small ✕ on
each to remove just that one. Under the hood this still writes into the
same `photos/` folder next to `data/`, so dropping files in directly via
File Station works exactly the same way it always has — the upload
button is just a more convenient way to do the same thing from a phone
or laptop without needing NAS file-browser access. A file with the same
name as an existing one is automatically renamed rather than overwriting
it, and only recognized image types are accepted either way.

**Deleting all photos at once**: the same "Photos" section (Photo Frame
tab) in Settings
has a "Delete all photos…" button, deliberately built with real friction
against doing it by accident — clicking it reveals a confirmation panel
(nothing is deleted yet), which requires checking a box before an
actual "Yes, delete all photos" button becomes clickable. Three
separate, deliberate actions before anything is destroyed. This only
ever removes photo files (and their HEIC conversion caches) — it never
touches `README.txt` or anything else that might be in that folder.

**Photo sizing on upload**: every photo uploaded through Settings is
scaled down so its long edge is at most **3840px**, keeping its aspect
ratio. That's enough to fill a 4K display with no upscaling in either
orientation (a landscape 3840×2160 screen, or one mounted vertically at
2160×3840), since the photo frame letterboxes each photo to fit rather
than cropping it. A 24–48MP phone photo drops from roughly 5–10MB to
about 1.5–3MB, which matters on a Raspberry Pi's SD card. Details:

- A photo whose long edge is already 3840px or less is left completely
  untouched, never enlarged. GIFs are always left alone (they may be
  animated).
- JPEG stays JPEG, PNG stays PNG (so transparency survives), WebP stays
  WebP.
- When a phone photo is resized, its EXIF orientation (the "rotate this
  90°" note phones attach instead of rotating the pixels) is applied to
  the pixels first, so it never comes out sideways. This is about the
  photo, not the screen — how the display is mounted is handled by the
  device's own rotation setting and the letterboxing, not here.
- Uploads land in a hidden staging folder, `photos/.incoming/`, and are
  resized there. Only the finished photo is moved into `photos/`, in one
  atomic step, so the photo frame never picks up a half-uploaded or
  not-yet-resized file. Anything left in staging by a crash or power cut
  is cleared at the next startup. The photo list, bulk delete, and the
  web server all ignore this folder.
- Photos are processed one at a time, since decoding a full-size phone
  photo briefly takes a couple hundred MB of memory. A photo that can't
  be processed is kept at its original size rather than lost, and the
  upload status says so.

Only uploads are resized. Files dropped directly into `photos/` (File
Station, `scp`, …) are left as they are, apart from HEIC below.

**HEIC/HEIF** (the default format on iPhones) needs a conversion step
most browsers can't do themselves — only Safari can display HEIC
natively, and a kiosk display almost certainly isn't running Safari.

- **Uploaded** HEIC/HEIF files are converted to a JPEG (capped at 3840px
  like everything else) with the same name — `IMG_1234.HEIC` becomes
  `IMG_1234.jpg`. The HEIC original never reaches `photos/`, so no
  cache file is needed.
- **Dropped-in** HEIC/HEIF files can't be converted the moment they
  arrive, so they're converted the first time they're needed and the
  result (also capped at 3840px) is cached right next to the original as
  `<filename>.converted.jpg`. That happens once at server startup for
  whatever's already in the folder, and on demand the first time the
  display asks for the photo list after a new one appears. If you later
  delete the original HEIC file, its cached JPEG is cleaned up
  automatically the next time the photo list loads.

If nothing's in the folder yet, the display just stays on the calendar
indefinitely rather than showing a blank screen — the photo frame only
kicks in once there's at least one photo to show.

## Version

A small "Homeport · v2026.09.20" line at the bottom of every
Settings tab (fetched from `/api/version`, which reads the plain-text
`VERSION` file at the project root — same "read fresh, no restart
needed" pattern as themes and settings).

Versioning is date-based (`YYYY.MM.DD`) rather than semantic (`1.4.2`),
since what's actually useful to know here is *when* a given build
shipped, not how large the change was. A second build on the same day
gets a suffix — `2026.09.20.2`, `.3`, and so on — resetting to a plain
date the next day. There's no build script; bumping `VERSION` is a
manual step taken alongside packaging any update.

## Project layout

```
server/
  index.js   Express app + REST API + cron scheduler
  db.js      SQLite schema
  sync.js    Fetches & parses ICS feeds into the database
  expand.js  Expands recurring events into concrete occurrences
  images.js  Resizes uploaded photos to a 3840px long edge; HEIC→JPEG
  heic.js    Cached HEIC→JPEG conversion for files dropped into photos/
public/
  index.html, app.js, display.css   The kiosk display
  settings.html, settings.js, settings.css  Calendar & theme management
  style.css  Shared design tokens
  theme-loader.js  Fetches/applies the active theme (shared by both pages)
  themes/*.json  Theme definitions — see "Themes" above
  photos/  Idle-timeout photo frame images — see "Idle timeout" above
.github/workflows/
  publish.yml  Builds and publishes the image to GHCR on every push to main
```

## Notes & limitations

- Calendars requiring authentication aren't supported — only public
  ICS/webcal links.
- Recurrence handling covers the common cases (daily/weekly/monthly
  RRULEs, skipped occurrences via EXDATE, and single-instance edits
  via RECURRENCE-ID). Exotic recurrence patterns should still expand,
  but are less battle-tested.
- If a feed fails to sync (bad URL, source temporarily down), its
  last-known events stay on the display and the error shows on the
  Settings page and in the display's footer — it won't silently go
  blank.
- All-day events (no specific time, just a date) are bucketed by their
  actual calendar date regardless of the viewing device's timezone —
  important because these carry no timezone info in the ICS format to
  begin with, so naively converting through the local timezone can
  shift them a day off for anyone west of UTC.
- The display refreshes itself (events, theme, timing settings) the
  moment it detects the tablet waking up — either by exiting the photo
  frame or the browser tab/screen becoming visible again — rather than
  waiting on its normal 5-minute cycle. This matters because Android can
  throttle or suspend background JS timers while a kiosk screen is off
  or backgrounded. The Week/3-Day timeline's "now" line goes further and
  doesn't depend on any of this at all: it repositions itself on its own
  independent 30-second timer, the same way the header clock runs on its
  own timer separate from data refreshes — so its accuracy never depends
  on a full calendar reload happening on schedule.
- Every multi-column grid (month, week, 3-day, both stacked and timeline
  layouts) explicitly uses `minmax(0, 1fr)` columns rather than plain
  `1fr`. Without that, a CSS Grid track's default minimum size is based
  on its content's natural width — and a long all-day event title (with
  `white-space: nowrap`, so its ellipsis-truncation actually works) is
  exactly the kind of content that would otherwise force its whole
  column, and the entire grid, wider than the viewport instead of
  truncating.
