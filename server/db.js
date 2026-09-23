const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'calendar.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// SQLite ignores FOREIGN KEY constraints per-connection unless this is set
// explicitly — without it, the `ON DELETE CASCADE` below is just a comment,
// not actual behavior. The calendar-delete route already deletes a
// calendar's events manually before removing the calendar, so this is a
// safety net for any future code path that deletes a calendar without
// remembering to do the same.
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B6E8F',
  visible INTEGER NOT NULL DEFAULT 1,
  color_rules TEXT NOT NULL DEFAULT '[]', -- JSON array of {keyword, color} — per-event color overrides
  last_synced_at TEXT,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT NOT NULL,               -- ICS UID
  calendar_id INTEGER NOT NULL,
  summary TEXT,
  description TEXT,
  location TEXT,
  start_utc TEXT NOT NULL,        -- ISO string, UTC
  end_utc TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  rrule TEXT,                     -- raw RRULE text, if recurring
  exdates TEXT,                   -- JSON array of ISO dates to exclude
  recurrence_overrides TEXT,      -- JSON map of recurrence-id -> override fields
  tzid TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, calendar_id),
  FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_utc);

-- Small key/value store for app-wide state (currently just the active
-- theme). Deliberately generic so future settings don't need a migration.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Migration: add color_rules to calendars if upgrading from a DB created
// before this column existed. Guarded so it's a no-op on fresh installs
// (where CREATE TABLE above already includes it) and safe to run every
// boot.
const calendarColumns = db.prepare(`PRAGMA table_info(calendars)`).all().map((c) => c.name);
if (!calendarColumns.includes('color_rules')) {
  db.exec(`ALTER TABLE calendars ADD COLUMN color_rules TEXT NOT NULL DEFAULT '[]'`);
}

module.exports = db;
