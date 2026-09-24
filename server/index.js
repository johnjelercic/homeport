const path = require('path');
const fs = require('fs');
const express = require('express');
const cron = require('node-cron');
const multer = require('multer');

const db = require('./db');
const { syncAllCalendars } = require('./sync');
const { expandEvents } = require('./expand');

const app = express();
app.use(express.json());

// Photos live under public/photos — declared up here (rather than down by
// the rest of the photo-frame routes) because the static middleware below
// needs it to decide which requests get a longer cache lifetime.
const PHOTOS_DIR = path.join(__dirname, '..', 'public', 'photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    // Photos are user-managed content that only changes when someone
    // uploads/deletes one — worth letting the browser cache them so the
    // idle photo frame (cycling every few seconds, 24/7) isn't re-fetching
    // the same image from disk on every lap. Capped at a day (not
    // "immutable") since a HEIC's converted-cache file can legitimately be
    // regenerated in place if the source photo is replaced.
    // Everything else (app.js, display.css, index.html, …) is left on
    // express.static's default ETag-based revalidation, deliberately with
    // no long max-age — the display is a long-running page that's rarely
    // reloaded, so a stale cached app bundle could otherwise outlive a
    // deploy for a while.
    if (filePath.startsWith(PHOTOS_DIR)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

const PORT = process.env.PORT || 19156;
const SYNC_INTERVAL_MINUTES = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15', 10);
const WEATHER_REFRESH_MINUTES = 30;

// ---------- Calendars ----------

function parseColorRules(json) {
  try {
    const rules = JSON.parse(json || '[]');
    return Array.isArray(rules) ? rules : [];
  } catch (e) {
    return [];
  }
}

function withParsedRules(calendar) {
  if (!calendar) return calendar;
  return { ...calendar, color_rules: parseColorRules(calendar.color_rules) };
}

app.get('/api/calendars', (req, res) => {
  const calendars = db.prepare('SELECT * FROM calendars ORDER BY id').all();
  res.json(calendars.map(withParsedRules));
});

app.post('/api/calendars', (req, res) => {
  const { name, url, color } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
  const info = db
    .prepare('INSERT INTO calendars (name, url, color) VALUES (?, ?, ?)')
    .run(name.trim(), url.trim(), color || '#3B6E8F');
  const calendar = db.prepare('SELECT * FROM calendars WHERE id = ?').get(info.lastInsertRowid);

  // Sync just this new calendar right away so it doesn't wait for the next tick.
  const { syncCalendar } = require('./sync');
  syncCalendar(calendar).catch(() => {});

  res.status(201).json(withParsedRules(calendar));
});

app.put('/api/calendars/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM calendars WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, url, color, visible, color_rules } = req.body || {};

  let colorRulesJson = existing.color_rules;
  if (color_rules !== undefined) {
    if (!Array.isArray(color_rules) || color_rules.some((r) => !r || typeof r.keyword !== 'string' || typeof r.color !== 'string')) {
      return res.status(400).json({ error: 'color_rules must be an array of {keyword, color}' });
    }
    colorRulesJson = JSON.stringify(
      color_rules.map((r) => ({ keyword: r.keyword.trim(), color: r.color })).filter((r) => r.keyword)
    );
  }

  db.prepare(
    'UPDATE calendars SET name = ?, url = ?, color = ?, visible = ?, color_rules = ? WHERE id = ?'
  ).run(
    name !== undefined ? name : existing.name,
    url !== undefined ? url : existing.url,
    color !== undefined ? color : existing.color,
    visible !== undefined ? (visible ? 1 : 0) : existing.visible,
    colorRulesJson,
    id
  );
  res.json(withParsedRules(db.prepare('SELECT * FROM calendars WHERE id = ?').get(id)));
});

app.delete('/api/calendars/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM events WHERE calendar_id = ?').run(id);
  db.prepare('DELETE FROM calendars WHERE id = ?').run(id);
  res.status(204).end();
});

app.post('/api/sync', async (req, res) => {
  const results = await syncAllCalendars();
  res.json({ results });
});

// ---------- Events ----------

app.get('/api/events', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end query params (ISO dates) are required' });

  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);
  if (isNaN(rangeStart) || isNaN(rangeEnd)) {
    return res.status(400).json({ error: 'start and end must be valid dates' });
  }

  // Pull events for visible calendars. The 400-day pre-filter only applies
  // to non-recurring events (as a performance shortcut) — a recurring
  // event's start_utc is its *original* series start, which is often years
  // old, so filtering recurring rows by it would wrongly hide any
  // long-running weekly/monthly series. Those are always included and
  // trimmed properly by expandEvents() below.
  const padded = new Date(rangeStart.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT e.*, c.name as calendar_name, c.color as calendar_color, c.color_rules as calendar_color_rules
       FROM events e JOIN calendars c ON c.id = e.calendar_id
       WHERE c.visible = 1 AND (e.rrule IS NOT NULL OR e.start_utc >= ?)`
    )
    .all(padded);

  const occurrences = expandEvents(rows, rangeStart, rangeEnd);

  // First matching keyword rule (case-insensitive, matched against the
  // event's title or description) overrides that event's display color —
  // this is what lets one shared calendar color-code by person/subject
  // without splitting it into separate feeds.
  function colorForOccurrence(occ, row) {
    const rules = parseColorRules(row && row.calendar_color_rules);
    if (rules.length) {
      const haystack = `${occ.summary || ''} ${occ.description || ''}`.toLowerCase();
      const match = rules.find((r) => r.keyword && haystack.includes(r.keyword.toLowerCase()));
      if (match) return match.color;
    }
    return row ? row.calendar_color : null;
  }

  const byId = new Map(rows.map((r) => [`${r.calendar_id}:${r.id}`, r]));
  const out = occurrences.map((occ) => {
    const row = byId.get(`${occ.calendar_id}:${occ.uid}`);
    return {
      ...occ,
      calendar_name: row ? row.calendar_name : null,
      calendar_color: row ? row.calendar_color : null,
      color: colorForOccurrence(occ, row)
    };
  });

  res.json(out);
});

// ---------- Themes & settings ----------

const THEMES_DIR = path.join(__dirname, '..', 'public', 'themes');

// Reads the themes directory fresh on every call rather than caching, so
// dropping in/editing/removing a .json file there takes effect immediately
// — no restart needed to pick up a new or changed theme.
function loadThemes() {
  if (!fs.existsSync(THEMES_DIR)) return [];
  return fs
    .readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const theme = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, f), 'utf8'));
        if (!theme.id || !theme.colors) throw new Error('missing id or colors');
        return theme;
      } catch (e) {
        console.warn(`Skipping malformed theme file "${f}": ${e.message}`);
        return null;
      }
    })
    .filter(Boolean)
    // Alphabetical by label, not by filename/directory order (which isn't
    // guaranteed alphabetical in the first place, and wouldn't match label
    // order anyway — e.g. default.json's label is "Modern").
    .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
}

const SETTINGS_DEFAULTS = {
  active_theme: 'modern',
  idle_timeout_minutes: 10,
  photo_interval_seconds: 20,
  timeline_start_hour: 4,
  timeline_end_hour: 23,
  default_view: 'month',
  default_layout: 'stacked',
  weather_zip: ''
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function getAllSettings() {
  return {
    active_theme: getSetting('active_theme') || SETTINGS_DEFAULTS.active_theme,
    idle_timeout_minutes: Number(getSetting('idle_timeout_minutes')) || SETTINGS_DEFAULTS.idle_timeout_minutes,
    photo_interval_seconds: Number(getSetting('photo_interval_seconds')) || SETTINGS_DEFAULTS.photo_interval_seconds,
    // Number(...) || default would wrongly fall back to the default when
    // the stored value is legitimately 0 (a valid start hour, midnight) —
    // these two use a null-check instead so "0" is respected as-is.
    timeline_start_hour: getSetting('timeline_start_hour') !== null ? Number(getSetting('timeline_start_hour')) : SETTINGS_DEFAULTS.timeline_start_hour,
    timeline_end_hour: getSetting('timeline_end_hour') !== null ? Number(getSetting('timeline_end_hour')) : SETTINGS_DEFAULTS.timeline_end_hour,
    // The view/layout the display boots into. Per-installation — different
    // households want different defaults — and only ever applied once at
    // load (see applyDisplaySettings in app.js), never forced mid-browse.
    default_view: getSetting('default_view') || SETTINGS_DEFAULTS.default_view,
    default_layout: getSetting('default_layout') || SETTINGS_DEFAULTS.default_layout,
    weather_zip: getSetting('weather_zip') || SETTINGS_DEFAULTS.weather_zip
  };
}

// ---------- Weather ----------
//
// Free, keyless sources only, matching the rest of this project: the
// National Weather Service (api.weather.gov) for the forecast and
// current conditions, and Zippopotam.us to turn a ZIP code into the
// lat/lon NWS actually needs (NWS has no ZIP-based lookup of its own).
// Refreshed on a timer (see start(), below) and whenever the configured
// ZIP changes — never fetched directly by the browser, so the display
// doesn't depend on reaching either API to render everything else.

const NWS_USER_AGENT = 'Homeport self-hosted calendar (https://github.com/johnjelercic/homeport)';

let weatherCache = { zip: '', place: null, current: null, todayHigh: null, todayLow: null, daily: [], fetchedAt: null, error: null };

// Very small keyword match against NWS's free-text "shortForecast" (e.g.
// "Partly Sunny", "Chance Rain Showers") — good enough for a single
// representative emoji per period without needing an icon set of our own.
function weatherEmoji(shortForecast) {
  const s = (shortForecast || '').toLowerCase();
  if (s.includes('thunder')) return '⛈️';
  if (s.includes('snow') || s.includes('flurries') || s.includes('sleet') || s.includes('ice')) return '❄️';
  if (s.includes('rain') || s.includes('showers') || s.includes('drizzle')) return '🌧️';
  if (s.includes('fog') || s.includes('haze') || s.includes('mist')) return '🌫️';
  if (s.includes('wind')) return '💨';
  if (s.includes('partly') || s.includes('mostly cloudy') || s.includes('mostly sunny')) return '⛅';
  if (s.includes('cloud') || s.includes('overcast')) return '☁️';
  if (s.includes('clear') || s.includes('sunny') || s.includes('fair')) return '☀️';
  return '🌡️';
}

async function geocodeZip(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
  if (!res.ok) throw new Error(`Could not look up ZIP ${zip}`);
  const data = await res.json();
  const place = data.places && data.places[0];
  if (!place) throw new Error(`No location found for ZIP ${zip}`);
  return {
    lat: Number(place.latitude),
    lon: Number(place.longitude),
    label: [place['place name'], place['state abbreviation']].filter(Boolean).join(', ')
  };
}

// Builds the 5-day list from NWS's raw period list, which alternates
// day/night entries (e.g. "Today", "Tonight", "Wednesday", "Wednesday
// Night", ...) — each daytime period's temperature is that day's high,
// and the night period right after it is that night's low.
function buildDailyForecast(periods) {
  const daily = [];
  for (let i = 0; i < periods.length && daily.length < 5; i++) {
    const p = periods[i];
    if (!p.isDaytime) continue;
    const night = periods[i + 1] && !periods[i + 1].isDaytime ? periods[i + 1] : null;
    daily.push({
      label: p.name,
      hi: p.temperature,
      lo: night ? night.temperature : null,
      condition: p.shortForecast,
      emoji: weatherEmoji(p.shortForecast)
    });
  }
  return daily;
}

async function refreshWeather() {
  const zip = getSetting('weather_zip') || '';
  if (!zip) {
    weatherCache = { zip: '', place: null, current: null, todayHigh: null, todayLow: null, daily: [], fetchedAt: null, error: null };
    return;
  }

  try {
    const { lat, lon, label } = await geocodeZip(zip);
    const headers = { 'User-Agent': NWS_USER_AGENT, 'Accept': 'application/geo+json' };

    const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers });
    if (!pointsRes.ok) throw new Error(`NWS location lookup failed (${pointsRes.status})`);
    const points = await pointsRes.json();
    const forecastUrl = points.properties && points.properties.forecast;
    const stationsUrl = points.properties && points.properties.observationStations;
    if (!forecastUrl) throw new Error('NWS has no forecast for this location');

    const [forecastRes, stationsRes] = await Promise.all([
      fetch(forecastUrl, { headers }),
      stationsUrl ? fetch(stationsUrl, { headers }) : Promise.resolve(null)
    ]);
    if (!forecastRes.ok) throw new Error(`NWS forecast fetch failed (${forecastRes.status})`);
    const forecast = await forecastRes.json();
    const daily = buildDailyForecast(forecast.properties.periods || []);

    // Current conditions come from the nearest observation station, not
    // the forecast itself (a daytime period's "temperature" is that
    // day's forecast HIGH, not the reading right now). Best-effort: if
    // this step fails for any reason, fall back to today's forecast
    // high rather than showing nothing.
    let current = null;
    if (stationsRes && stationsRes.ok) {
      const stations = await stationsRes.json();
      const stationId = stations.features && stations.features[0] && stations.features[0].properties.stationIdentifier;
      if (stationId) {
        const obsRes = await fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, { headers });
        if (obsRes.ok) {
          const obs = await obsRes.json();
          const tempC = obs.properties && obs.properties.temperature && obs.properties.temperature.value;
          if (tempC !== null && tempC !== undefined) {
            current = {
              tempF: Math.round((tempC * 9) / 5 + 32),
              condition: obs.properties.textDescription,
              emoji: weatherEmoji(obs.properties.textDescription)
            };
          }
        }
      }
    }
    if (!current && daily[0]) {
      current = { tempF: daily[0].hi, condition: daily[0].condition, emoji: daily[0].emoji };
    }

    weatherCache = {
      zip,
      place: label || null,
      current,
      todayHigh: daily[0] ? daily[0].hi : null,
      todayLow: daily[0] ? daily[0].lo : null,
      daily,
      fetchedAt: new Date().toISOString(),
      error: null
    };
  } catch (e) {
    // Keep whatever we last had (so a transient outage doesn't blank the
    // widget) but surface the failure for anyone checking Settings.
    weatherCache = { ...weatherCache, zip, error: e.message || 'Could not fetch weather' };
  }
}

app.get('/api/themes', (req, res) => {
  res.json(loadThemes());
});

// Read fresh each request (not cached at startup) so an update to VERSION
// takes effect without a restart — consistent with themes/settings.
app.get('/api/version', (req, res) => {
  let version = 'unknown';
  try {
    version = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
  } catch (e) { /* no VERSION file — fall back to 'unknown' */ }
  res.json({ version });
});

app.get('/api/settings', (req, res) => {
  res.json(getAllSettings());
});

app.put('/api/settings', async (req, res) => {
  const { active_theme, idle_timeout_minutes, photo_interval_seconds, timeline_start_hour, timeline_end_hour, default_view, default_layout, weather_zip } = req.body || {};

  if (active_theme !== undefined) {
    const themes = loadThemes();
    if (!themes.find((t) => t.id === active_theme)) {
      return res.status(400).json({ error: `Unknown theme "${active_theme}"` });
    }
    setSetting('active_theme', active_theme);
  }

  if (idle_timeout_minutes !== undefined) {
    const n = Number(idle_timeout_minutes);
    if (!Number.isFinite(n) || n < 1 || n > 180) {
      return res.status(400).json({ error: 'idle_timeout_minutes must be between 1 and 180' });
    }
    setSetting('idle_timeout_minutes', n);
  }

  if (photo_interval_seconds !== undefined) {
    const n = Number(photo_interval_seconds);
    if (!Number.isFinite(n) || n < 3 || n > 600) {
      return res.status(400).json({ error: 'photo_interval_seconds must be between 3 and 600' });
    }
    setSetting('photo_interval_seconds', n);
  }

  if (timeline_start_hour !== undefined || timeline_end_hour !== undefined) {
    // Validated as a pair — changing just one still has to result in a
    // sane combination with whichever value isn't being changed this call.
    const current = getAllSettings();
    const newStart = timeline_start_hour !== undefined ? Number(timeline_start_hour) : current.timeline_start_hour;
    const newEnd = timeline_end_hour !== undefined ? Number(timeline_end_hour) : current.timeline_end_hour;

    if (!Number.isInteger(newStart) || newStart < 0 || newStart > 23) {
      return res.status(400).json({ error: 'timeline_start_hour must be a whole number between 0 and 23' });
    }
    if (!Number.isInteger(newEnd) || newEnd < 1 || newEnd > 24) {
      return res.status(400).json({ error: 'timeline_end_hour must be a whole number between 1 and 24' });
    }
    if (newEnd <= newStart) {
      return res.status(400).json({ error: 'timeline_end_hour must be after timeline_start_hour' });
    }

    if (timeline_start_hour !== undefined) setSetting('timeline_start_hour', newStart);
    if (timeline_end_hour !== undefined) setSetting('timeline_end_hour', newEnd);
  }

  if (default_view !== undefined) {
    if (!['month', 'week', '3day'].includes(default_view)) {
      return res.status(400).json({ error: 'default_view must be one of month, week, 3day' });
    }
    setSetting('default_view', default_view);
  }

  if (default_layout !== undefined) {
    if (!['stacked', 'timeline'].includes(default_layout)) {
      return res.status(400).json({ error: 'default_layout must be one of stacked, timeline' });
    }
    setSetting('default_layout', default_layout);
  }

  if (weather_zip !== undefined) {
    if (weather_zip !== '' && !/^\d{5}$/.test(weather_zip)) {
      return res.status(400).json({ error: 'weather_zip must be a 5-digit US ZIP code, or empty to disable' });
    }
    setSetting('weather_zip', weather_zip);
    // Awaited so Settings can show right away whether that ZIP actually
    // resolved to a forecast, rather than reporting success blind.
    await refreshWeather();
    if (weather_zip && weatherCache.error) {
      return res.status(400).json({ error: `Saved, but couldn't fetch weather: ${weatherCache.error}` });
    }
  }

  res.json(getAllSettings());
});

app.get('/api/weather', (req, res) => {
  res.json(weatherCache);
});

// ---------- Photo frame ----------
// (PHOTOS_DIR itself is declared up near the static middleware, above.)

const heic = require('./heic');
const images = require('./images');

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Scans the photos directory, converting any HEIC/HEIF files to JPEG
// (cached to disk — see server/heic.js) and cleaning up orphaned cache
// files whose original was deleted. Shared by the /api/photos route
// (which always reflects live disk state) and the startup scan below, so
// HEIC files already present at boot are converted immediately rather
// than waiting for the display's first idle cycle to ask for them.
async function listPhotos() {
  if (!fs.existsSync(PHOTOS_DIR)) return { photos: [], converted: 0, alreadyCached: 0 };
  const allFiles = fs.readdirSync(PHOTOS_DIR);

  heic.cleanupOrphanedCaches(PHOTOS_DIR, allFiles);

  const standardFiles = allFiles.filter(
    (f) => PHOTO_EXTENSIONS.has(path.extname(f).toLowerCase()) && !f.endsWith(heic.CACHE_SUFFIX)
  );
  const heicFiles = allFiles.filter((f) => heic.isHeic(f));

  const photos = standardFiles.map((f) => ({ file: f, url: `/photos/${encodeURIComponent(f)}` }));

  let converted = 0;
  let alreadyCached = 0;
  for (const heicFile of heicFiles) {
    try {
      const result = await heic.ensureConverted(PHOTOS_DIR, heicFile);
      if (result.converted) converted++; else alreadyCached++;
      photos.push({ file: heicFile, url: `/photos/${encodeURIComponent(result.cacheFilename)}` });
    } catch (e) {
      console.warn(`Could not convert HEIC photo "${heicFile}": ${e.message}`);
    }
  }

  photos.sort((a, b) => a.file.localeCompare(b.file));
  return { photos, converted, alreadyCached };
}

app.get('/api/photos', async (req, res) => {
  const { photos } = await listPhotos();
  res.json(photos);
});

// A filename considered "photo-related" for upload/delete purposes: a
// supported image extension, a HEIC/HEIF original, or a generated HEIC
// cache file. Used to keep uploads restricted to real images and to make
// sure bulk-delete only ever touches photo files — never README.txt or
// anything else that might end up in this folder.
function isPhotoRelatedFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  return PHOTO_EXTENSIONS.has(ext) || heic.isHeic(filename) || filename.endsWith(heic.CACHE_SUFFIX);
}

const { normalizeUploadedPhoto, clearStaging, MAX_LONG_EDGE } = images;

// Uploads land here first — a hidden folder inside photos/ — and only the
// finished, resized photo is moved into photos/ itself (see
// normalizeUploadedPhoto), so the photo frame never sees a half-uploaded
// or not-yet-resized file. It's inside photos/ rather than somewhere like
// /tmp so it's on the same disk, which is what makes that final move a
// single atomic step. The photo list ignores it (a folder, not an image),
// bulk delete skips it, and express.static refuses to serve dot-folders.
const STAGING_DIR = path.join(PHOTOS_DIR, '.incoming');
fs.mkdirSync(STAGING_DIR, { recursive: true });

// Per-request cap. The Settings page sends selections of up to 100 photos
// as batches of 10 (see settings.js), so this only needs to be a sane
// ceiling for a single request, not the user-facing limit.
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, STAGING_DIR),
    // A random staging name, so simultaneous uploads of the same filename
    // never collide in here. The real (sanitized) name is applied when the
    // finished photo is moved into photos/.
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, isPhotoRelatedFilename(file.originalname))
});

// originalname is user-controlled — basename it to strip any path
// component, then drop anything that isn't a safe filename character.
function safeUploadName(originalname) {
  return path.basename(originalname).replace(/[^\w.\- ()]/g, '_');
}

app.post('/api/photos/upload', (req, res) => {
  photoUpload.array('photos', 20)(req, res, async (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'One or more files are over the 25 MB limit.' :
        err.code === 'LIMIT_FILE_COUNT' ? 'Too many files in one request (20 max).' :
        'Upload failed.';
      return res.status(400).json({ error: message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No valid image files were uploaded (check the file type).' });
    }
    // Resize each new photo down to MAX_LONG_EDGE (and convert HEIC to
    // JPEG) while it's still in staging, then move the finished file into
    // photos/. One photo at a time on purpose — decoding a full-size phone
    // photo takes a couple hundred MB of RAM, and a 50-photo batch in
    // parallel could exhaust a Pi's memory. A photo that fails to process
    // is moved into photos/ exactly as uploaded rather than lost.
    let resized = 0;
    let converted = 0;
    let failed = 0;
    for (const f of req.files) {
      const name = safeUploadName(f.originalname);
      try {
        const result = await normalizeUploadedPhoto(f.path, name, PHOTOS_DIR);
        if (result.resized) resized++;
        if (result.converted) converted++;
      } catch (e) {
        failed++;
        console.warn(`Could not resize uploaded photo "${name}" (kept as uploaded${e.publishedAs ? ` as "${e.publishedAs}"` : ''}): ${e.message}`);
      }
    }
    res.json({ uploaded: req.files.length, resized, converted, failed, maxLongEdge: MAX_LONG_EDGE });
  });
});

app.delete('/api/photos/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // strip any path component defensively
  if (!isPhotoRelatedFilename(filename)) return res.status(400).json({ error: 'not a photo file' });
  const filePath = path.join(PHOTOS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(filePath);
  const cachePath = filePath + heic.CACHE_SUFFIX;
  if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath); // also drop its HEIC cache, if any
  res.status(204).end();
});

// Deletes every photo-related file in the folder — every image, every
// HEIC/HEIF original, and every generated .converted.jpg cache. Never
// touches README.txt or anything else that isn't recognized as a photo.
// The Settings-page UI gates this behind its own multi-step confirmation;
// this endpoint itself performs no confirmation of its own.
app.delete('/api/photos', (req, res) => {
  if (!fs.existsSync(PHOTOS_DIR)) return res.json({ deleted: 0 });
  const allFiles = fs.readdirSync(PHOTOS_DIR);
  let deleted = 0;
  for (const f of allFiles) {
    if (!isPhotoRelatedFilename(f)) continue;
    try {
      fs.unlinkSync(path.join(PHOTOS_DIR, f));
      deleted++;
    } catch (e) {
      console.warn(`Could not delete "${f}": ${e.message}`);
    }
  }
  res.json({ deleted });
});

// ---------- Boot ----------

async function start() {
  console.log('Running initial calendar sync...');
  try {
    const results = await syncAllCalendars();
    results.forEach((r) => {
      if (r.ok) console.log(`  synced "${r.name}"`);
      else console.warn(`  FAILED "${r.name}": ${r.error}`);
    });
  } catch (e) {
    console.error('Initial sync failed:', e);
  }

  const leftovers = clearStaging(STAGING_DIR);
  if (leftovers) console.log(`Cleared ${leftovers} unfinished upload(s) left in photos/.incoming`);

  console.log('Scanning photos folder for HEIC/HEIF files to convert...');
  try {
    const { converted, alreadyCached } = await listPhotos();
    if (converted === 0 && alreadyCached === 0) console.log('  none found');
    else console.log(`  converted ${converted} new, ${alreadyCached} already cached`);
  } catch (e) {
    console.error('HEIC conversion scan failed:', e);
  }

  cron.schedule(`*/${SYNC_INTERVAL_MINUTES} * * * *`, () => {
    console.log('Running scheduled calendar sync...');
    syncAllCalendars().then((results) => {
      results.forEach((r) => {
        if (!r.ok) console.warn(`  FAILED "${r.name}": ${r.error}`);
      });
    });
  });

  if (getSetting('weather_zip')) {
    console.log('Fetching initial weather...');
    try {
      await refreshWeather();
      if (weatherCache.error) console.warn(`  weather fetch failed: ${weatherCache.error}`);
    } catch (e) {
      console.error('Initial weather fetch failed:', e);
    }
  }

  cron.schedule(`*/${WEATHER_REFRESH_MINUTES} * * * *`, () => {
    refreshWeather().then(() => {
      if (weatherCache.error) console.warn(`Scheduled weather refresh failed: ${weatherCache.error}`);
    });
  });

  app.listen(PORT, () => {
    console.log(`Homeport server listening on port ${PORT}`);
    console.log(`Display:  http://localhost:${PORT}/`);
    console.log(`Settings: http://localhost:${PORT}/settings.html`);
  });
}

start();
