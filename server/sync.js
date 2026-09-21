const ical = require('node-ical');
const db = require('./db');

function normalizeUrl(url) {
  // webcal:// is just https:// with a different scheme name
  if (url.startsWith('webcal://')) return 'https://' + url.slice('webcal://'.length);
  if (url.startsWith('webcals://')) return 'https://' + url.slice('webcals://'.length);
  return url;
}

async function fetchIcsText(url) {
  const target = normalizeUrl(url);
  const res = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; HomeportCalendar/1.0; +self-hosted family calendar sync)'
    },
    redirect: 'follow'
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function toIso(dateLike) {
  if (!dateLike) return null;
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return d.toISOString();
}

const upsertEvent = db.prepare(`
  INSERT INTO events (id, calendar_id, summary, description, location, start_utc, end_utc, all_day, rrule, exdates, recurrence_overrides, tzid, updated_at)
  VALUES (@id, @calendar_id, @summary, @description, @location, @start_utc, @end_utc, @all_day, @rrule, @exdates, @recurrence_overrides, @tzid, datetime('now'))
  ON CONFLICT(id, calendar_id) DO UPDATE SET
    summary=excluded.summary,
    description=excluded.description,
    location=excluded.location,
    start_utc=excluded.start_utc,
    end_utc=excluded.end_utc,
    all_day=excluded.all_day,
    rrule=excluded.rrule,
    exdates=excluded.exdates,
    recurrence_overrides=excluded.recurrence_overrides,
    tzid=excluded.tzid,
    updated_at=datetime('now')
`);

const deleteStaleEvents = db.prepare(`
  DELETE FROM events WHERE calendar_id = ? AND updated_at < ?
`);

// updated_at is written with SQLite's own datetime('now'), so the "since"
// marker used to find stale rows must come from the same clock/format —
// comparing it against a JS toISOString() string sorts wrong (space vs "T")
// and would delete every row just written in the same sync.
const nowMarker = db.prepare(`SELECT datetime('now') AS t`);

const setSyncOk = db.prepare(`
  UPDATE calendars SET last_synced_at = datetime('now'), last_sync_status = 'ok', last_sync_error = NULL WHERE id = ?
`);
const setSyncError = db.prepare(`
  UPDATE calendars SET last_synced_at = datetime('now'), last_sync_status = 'error', last_sync_error = ? WHERE id = ?
`);

async function syncCalendar(calendar) {
  const syncStartedAt = nowMarker.get().t;
  try {
    const text = await fetchIcsText(calendar.url);
    const parsed = ical.parseICS(text);

    const tx = db.transaction((components) => {
      for (const key in components) {
        const comp = components[key];
        if (!comp || comp.type !== 'VEVENT') continue;
        // Skip malformed events with no start
        if (!comp.start) continue;

        const uid = comp.uid || key;
        const isAllDay = comp.datetype === 'date';

        // RRULE, stored as raw text (rrule.js instance -> toString includes DTSTART+RRULE)
        let rruleText = null;
        if (comp.rrule) {
          try { rruleText = comp.rrule.toString(); } catch (e) { rruleText = null; }
        }

        // EXDATE -> array of ISO strings
        let exdates = null;
        if (comp.exdate) {
          const list = Object.keys(comp.exdate).map((k) => toIso(comp.exdate[k]));
          exdates = JSON.stringify(list);
        }

        // RECURRENCE-ID overrides (single-instance edits/cancellations of a recurring series).
        // node-ical keys these by the original occurrence's local calendar date
        // (e.g. "2026-01-20"), not an exact timestamp, so we key our stored map
        // the same way and match on date at expansion time.
        let overrides = null;
        if (comp.recurrences) {
          const map = {};
          for (const recId in comp.recurrences) {
            const o = comp.recurrences[recId];
            map[recId] = {
              summary: o.summary || comp.summary || null,
              description: o.description || null,
              location: o.location || null,
              start_utc: toIso(o.start),
              end_utc: toIso(o.end),
              all_day: o.datetype === 'date'
            };
          }
          overrides = JSON.stringify(map);
        }

        const tzid = (comp.start && comp.start.tz) ? comp.start.tz : null;

        upsertEvent.run({
          id: uid,
          calendar_id: calendar.id,
          summary: comp.summary || '(No title)',
          description: comp.description || null,
          location: comp.location || null,
          start_utc: toIso(comp.start),
          end_utc: toIso(comp.end),
          all_day: isAllDay ? 1 : 0,
          rrule: rruleText,
          exdates,
          recurrence_overrides: overrides,
          tzid
        });
      }
    });

    tx(parsed);

    // Remove events that existed before this sync but weren't touched by it
    // (they were deleted/renamed at the source).
    deleteStaleEvents.run(calendar.id, syncStartedAt);

    setSyncOk.run(calendar.id);
    return { ok: true };
  } catch (err) {
    setSyncError.run(String(err.message || err), calendar.id);
    return { ok: false, error: String(err.message || err) };
  }
}

async function syncAllCalendars() {
  const calendars = db.prepare('SELECT * FROM calendars').all();
  const results = [];
  for (const cal of calendars) {
    // Sequential, not parallel — avoids hammering multiple providers at once
    // and keeps behavior predictable on modest NAS hardware.
    const result = await syncCalendar(cal);
    results.push({ id: cal.id, name: cal.name, ...result });
  }
  return results;
}

module.exports = { syncAllCalendars, syncCalendar };
