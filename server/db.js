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
-- One row per connected OAuth account (currently just Microsoft/Outlook).
-- token_cache holds an encrypted, serialized MSAL token cache (see
-- server/crypto.js + server/msgraph.js) rather than a raw refresh token
-- directly, so MSAL's own cache/refresh bookkeeping can be persisted and
-- restored as-is. "provider" is deliberately free text (not an enum) so a
-- future Google account can reuse this same table without a migration.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  token_cache TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok', -- 'ok' | 'needs_reauth'
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT,                          -- ICS calendars only; NULL for OAuth-backed calendars
  color TEXT NOT NULL DEFAULT '#3B6E8F',
  visible INTEGER NOT NULL DEFAULT 1,
  color_rules TEXT NOT NULL DEFAULT '[]', -- JSON array of {keyword, color} — per-event color overrides
  source_type TEXT NOT NULL DEFAULT 'ics', -- 'ics' | 'msgraph'
  oauth_account_id INTEGER REFERENCES oauth_accounts(id) ON DELETE CASCADE,
  graph_calendar_id TEXT,            -- Microsoft Graph calendar id — msgraph calendars only
  delta_link TEXT,                   -- Graph delta-query cursor — msgraph calendars only
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

// Migration: relax calendars.url to nullable and add the columns needed
// for OAuth-backed (non-ICS) calendars, if upgrading from a DB created
// before oauth_accounts existed. Guarded so it's a no-op on fresh installs
// (whose CREATE TABLE above already matches this shape) and safe to run
// every boot. SQLite can't ALTER a column's NOT NULL constraint in place,
// so this recreates the table — foreign_keys is turned off for the
// duration since `events` references `calendars` by name and would
// otherwise trip its FK check the moment the RENAME makes that name
// disappear, even mid-transaction.
const calendarsInfo = db.prepare(`PRAGMA table_info(calendars)`).all();
const urlCol = calendarsInfo.find((c) => c.name === 'url');
if (urlCol && urlCol.notnull) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`ALTER TABLE calendars RENAME TO calendars_old;`);
    db.exec(`
      CREATE TABLE calendars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT,
        color TEXT NOT NULL DEFAULT '#3B6E8F',
        visible INTEGER NOT NULL DEFAULT 1,
        color_rules TEXT NOT NULL DEFAULT '[]',
        source_type TEXT NOT NULL DEFAULT 'ics',
        oauth_account_id INTEGER REFERENCES oauth_accounts(id) ON DELETE CASCADE,
        graph_calendar_id TEXT,
        delta_link TEXT,
        last_synced_at TEXT,
        last_sync_status TEXT,
        last_sync_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO calendars (id, name, url, color, visible, color_rules, source_type, last_synced_at, last_sync_status, last_sync_error, created_at)
      SELECT id, name, url, color, visible, color_rules, 'ics', last_synced_at, last_sync_status, last_sync_error, created_at FROM calendars_old;
    `);
    db.exec(`DROP TABLE calendars_old;`);
  })();
  db.pragma('foreign_keys = ON');
}

module.exports = db;
