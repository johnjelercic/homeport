const msal = require('@azure/msal-node');
const db = require('./db');
const cryptoStore = require('./crypto');
const { graphRecurrenceToRRuleString } = require('./graphRecurrence');

// Registered per-installation (see Settings → Connected accounts → the
// Application (client) ID field, for the one-time setup steps) since
// Homeport is a self-hosted, publicly-shared app — there's no single
// client ID that could be baked into source the way a hosted SaaS product
// would; every installation registers its own free Entra app and gets its
// own ID. A missing value just means the feature is unconfigured, not an
// error.
//
// Deliberately stored in the `settings` table (same as every other
// per-installation preference — theme, weather ZIP, etc.), not read
// directly from an environment variable, so it's set once from the
// Settings page itself rather than by editing docker-compose.yml — and so
// it's never at risk of ending up checked into a shared/example compose
// file, which would otherwise mean every household running that example
// unwittingly shares one installation's Microsoft app registration.
// MSGRAPH_CLIENT_ID is still honored as a fallback, purely for anyone who
// prefers managing it as infra-as-code instead — the DB value always wins
// when both are set.
const AUTHORITY = 'https://login.microsoftonline.com/common';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Delegated scopes: Calendars.ReadWrite for actual event access,
// offline_access for a refresh token (without it MSAL only ever gets a
// short-lived access token and the connection would need re-authorizing
// every ~time it's used).
const SCOPES = ['Calendars.ReadWrite', 'offline_access'];

const CLIENT_ID_SETTING_KEY = 'msgraph_client_id';

function getStoredClientId() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CLIENT_ID_SETTING_KEY);
  return row ? row.value : '';
}

function setClientId(value) {
  const trimmed = String(value || '').trim();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(CLIENT_ID_SETTING_KEY, trimmed);
}

function getClientId() {
  return getStoredClientId() || process.env.MSGRAPH_CLIENT_ID || '';
}

function isConfigured() {
  return !!getClientId();
}

function newPca() {
  return new msal.PublicClientApplication({
    auth: { clientId: getClientId(), authority: AUTHORITY }
  });
}

// ---------- account persistence ----------

const getAccountRow = db.prepare('SELECT * FROM oauth_accounts WHERE id = ?');
const listAccountRows = db.prepare(`SELECT id, provider, display_name, email, status, last_error, created_at FROM oauth_accounts ORDER BY id`);
const insertAccount = db.prepare(`
  INSERT INTO oauth_accounts (provider, display_name, email, token_cache, status, updated_at)
  VALUES (@provider, @display_name, @email, @token_cache, 'ok', datetime('now'))
`);
const updateAccountCache = db.prepare(`
  UPDATE oauth_accounts SET token_cache = ?, status = 'ok', last_error = NULL, updated_at = datetime('now') WHERE id = ?
`);
const markAccountNeedsReauth = db.prepare(`
  UPDATE oauth_accounts SET status = 'needs_reauth', last_error = ?, updated_at = datetime('now') WHERE id = ?
`);
const deleteAccountRow = db.prepare('DELETE FROM oauth_accounts WHERE id = ?');

function listAccounts() {
  return listAccountRows.all();
}

function deleteAccount(id) {
  // ON DELETE CASCADE (calendars.oauth_account_id) drops any calendars tied
  // to this account; their events cascade in turn via events.calendar_id.
  deleteAccountRow.run(id);
}

// Loads a persisted account's MSAL cache into a fresh PublicClientApplication
// instance. MSAL doesn't expose a raw refresh token API for public clients —
// instead, the whole serialized token cache is persisted (encrypted) and
// restored, letting MSAL's own silent-refresh logic do the rotation.
function loadPcaForAccount(row) {
  const pca = newPca();
  pca.getTokenCache().deserialize(cryptoStore.decrypt(row.token_cache));
  return pca;
}

// Re-serializes and persists a PCA's cache back to its account row — MSAL
// rotates the refresh token on every use, so this must run after every
// silent/interactive token acquisition to avoid stranding the row on a
// token that's about to go stale.
function persistPca(accountId, pca) {
  const serialized = pca.getTokenCache().serialize();
  updateAccountCache.run(cryptoStore.encrypt(serialized), accountId);
}

// Returns a valid Graph access token for this account, transparently
// refreshing via MSAL's cache if the cached one has expired. Throws (and
// flags the account needs_reauth) if the refresh token itself is no longer
// valid — e.g. a password change or revoked consent — since that's a
// routine, recoverable event the caller should surface as "reconnect this
// account," not a fatal error.
async function getAccessToken(accountId) {
  const row = getAccountRow.get(accountId);
  if (!row) throw new Error('No such connected account');
  const pca = loadPcaForAccount(row);
  const accounts = await pca.getTokenCache().getAllAccounts();
  const account = accounts[0];
  if (!account) {
    markAccountNeedsReauth.run('No cached account found — please reconnect.', accountId);
    throw new Error('No cached account found — please reconnect.');
  }
  try {
    const result = await pca.acquireTokenSilent({ account, scopes: SCOPES });
    persistPca(accountId, pca);
    return result.accessToken;
  } catch (e) {
    markAccountNeedsReauth.run(String(e.message || e), accountId);
    throw new Error(`This Microsoft account needs to be reconnected: ${e.message || e}`);
  }
}

// ---------- device code connect flow ----------
//
// Device Code flow (RFC 8628) is used instead of the more common
// authorization-code + browser-redirect flow deliberately: Homeport's
// Settings page is typically opened from a phone/laptop pointed at the
// Pi's LAN address, not "localhost" — and Microsoft's redirect-URI rules
// only exempt a literal http://localhost from needing HTTPS, not an
// arbitrary LAN IP. Device code sidesteps redirect URIs entirely: Homeport
// shows a one-time code, the person enters it at microsoft.com/devicelogin
// on *any* device (their phone is fine), and Homeport polls in the
// background until that completes. No inbound connectivity, no TLS
// certificate, no "localhost" assumption required.

// One in-flight connect attempt at a time is plenty for a household app —
// keyed by a random token handed to the browser so it can poll status
// without another user's attempt colliding with it.
const pendingConnections = new Map();

function startConnect() {
  if (!isConfigured()) throw new Error('MSGRAPH_CLIENT_ID is not configured on this server.');
  const pca = newPca();
  const connectId = require('crypto').randomBytes(16).toString('hex');
  const state = { status: 'pending', userCode: null, verificationUri: null, message: null };
  pendingConnections.set(connectId, state);

  pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (resp) => {
      state.userCode = resp.userCode;
      state.verificationUri = resp.verificationUri;
      state.message = resp.message;
    }
  }).then(async (result) => {
    try {
      // /me needs User.Read, which MSAL/Graph grant implicitly alongside
      // any other delegated scope on the same consent — no separate scope
      // request needed just to read the signed-in user's own profile.
      const me = await graphFetch(result.accessToken, '/me?$select=displayName,mail,userPrincipalName');
      const accountId = insertAccount.run({
        provider: 'microsoft',
        display_name: me.displayName || null,
        email: me.mail || me.userPrincipalName || null,
        token_cache: cryptoStore.encrypt(pca.getTokenCache().serialize())
      }).lastInsertRowid;

      // Auto-add this account's default calendar as a Homeport calendar,
      // the same way adding an ICS feed immediately creates one — so
      // connecting an account is a single step rather than a "connect,
      // then separately go add its calendar" two-step. Additional
      // calendars from this same account (or additional accounts
      // entirely — each family member connecting their own) can be added
      // the same way later; this just seeds the common case.
      const graphCalendars = await listGraphCalendars(accountId);
      const defaultCal = graphCalendars.find((c) => c.isDefaultCalendar) || graphCalendars[0];
      if (defaultCal) {
        const calendarId = db.prepare(
          'INSERT INTO calendars (name, source_type, oauth_account_id, graph_calendar_id) VALUES (?, ?, ?, ?)'
        ).run(defaultCal.name || 'Outlook', 'msgraph', accountId, defaultCal.id).lastInsertRowid;
        const calendarRow = db.prepare('SELECT * FROM calendars WHERE id = ?').get(calendarId);
        // Fire-and-forget, matching the existing "sync a newly-added ICS
        // calendar right away" behavior in POST /api/calendars — the
        // person doesn't have to wait for this to see the connect finish.
        syncCalendarFromGraph(calendarRow).catch(() => {});
        state.calendarId = calendarId;
      }

      state.status = 'done';
      state.accountId = accountId;
    } catch (e) {
      state.status = 'error';
      state.error = String(e.message || e);
    }
  }).catch((e) => {
    state.status = 'error';
    state.error = String(e.message || e);
  });

  return connectId;
}

function getConnectStatus(connectId) {
  return pendingConnections.get(connectId) || null;
}

// Pending attempts are small and short-lived (a person either completes
// the code within a few minutes or gives up) — swept opportunistically
// rather than with a timer, since nothing about this app needs
// second-level precision here.
setInterval(() => {
  // no explicit TTL stored — MSAL's own device code flow expires the
  // underlying code after ~15 minutes, at which point acquireTokenByDeviceCode
  // rejects and the entry above moves to 'error'; this just caps how long
  // finished (done/error) entries linger in memory.
  if (pendingConnections.size > 20) pendingConnections.clear();
}, 30 * 60 * 1000).unref();

// ---------- Graph REST helpers ----------

async function graphFetch(accessToken, pathAndQuery, options = {}) {
  const res = await fetch(`${GRAPH_BASE}${pathAndQuery}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // Forces Graph to return every date/time in UTC directly, rather
      // than whichever timezone the event was originally created in —
      // this is what lets the rest of Homeport keep treating start_utc/
      // end_utc as always-UTC, exactly like the ICS sync path already
      // does, with no per-event timezone math of its own.
      Prefer: 'outlook.timezone="UTC"',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body && body.error && body.error.message) || `Graph request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

async function listGraphCalendars(accountId) {
  const token = await getAccessToken(accountId);
  const data = await graphFetch(token, '/me/calendars?$select=id,name,isDefaultCalendar,canEdit');
  return data.value || [];
}

// ---------- delta sync (read path) ----------

const upsertEvent = db.prepare(`
  INSERT INTO events (id, calendar_id, summary, description, location, start_utc, end_utc, all_day, rrule, exdates, recurrence_overrides, tzid, updated_at)
  VALUES (@id, @calendar_id, @summary, @description, @location, @start_utc, @end_utc, @all_day, @rrule, @exdates, @recurrence_overrides, @tzid, datetime('now'))
  ON CONFLICT(id, calendar_id) DO UPDATE SET
    summary=excluded.summary, description=excluded.description, location=excluded.location,
    start_utc=excluded.start_utc, end_utc=excluded.end_utc, all_day=excluded.all_day,
    rrule=excluded.rrule, exdates=excluded.exdates, recurrence_overrides=excluded.recurrence_overrides,
    tzid=excluded.tzid, updated_at=datetime('now')
`);
const deleteEventRow = db.prepare('DELETE FROM events WHERE calendar_id = ? AND id = ?');
const getEventRow = db.prepare('SELECT * FROM events WHERE calendar_id = ? AND id = ?');
const setCalendarDeltaLink = db.prepare('UPDATE calendars SET delta_link = ? WHERE id = ?');
const setSyncOk = db.prepare(`UPDATE calendars SET last_synced_at = datetime('now'), last_sync_status = 'ok', last_sync_error = NULL WHERE id = ?`);
const setSyncError = db.prepare(`UPDATE calendars SET last_synced_at = datetime('now'), last_sync_status = 'error', last_sync_error = ? WHERE id = ?`);

function dateKeyFromIso(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// Graph's exception-occurrence `originalStart` field is documented as
// always UTC, but doesn't consistently carry a trailing "Z" the way
// start/end do once the Prefer header (below) is honored — normalizing it
// here (rather than trusting Date's local-timezone fallback for a
// zone-less string) is what keeps exdates/override keys aligned with the
// UTC-anchored dates start_utc/end_utc already use everywhere else.
function normalizeUtcIso(iso) {
  const withZone = /[Zz]$|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z';
  return new Date(withZone).toISOString();
}

function toUtcIso(dt) {
  // Graph returns { dateTime: "2026-01-05T09:00:00.0000000", timeZone: "UTC" }
  // once the Prefer header above is honored — dateTime has no zone suffix,
  // so it must be read as UTC explicitly rather than left to the local
  // Date parser (which would otherwise assume the server's own timezone).
  if (!dt || !dt.dateTime) return null;
  return new Date(dt.dateTime + 'Z').toISOString();
}

// Master (seriesMaster) events and plain single events both apply directly;
// exception occurrences of a recurring series get folded into their
// master's recurrence_overrides, matched to the existing ICS-derived
// override shape (keyed by the *original* occurrence's local calendar
// date) so expand.js needs no changes to understand either source.
function applyGraphEvent(calendarId, item) {
  if (item['@removed']) {
    deleteEventRow.run(calendarId, item.id);
    return;
  }

  if (item.type === 'exception' || item.type === 'occurrence') {
    if (!item.seriesMasterId) return; // shouldn't happen, but don't crash sync over it
    const master = getEventRow.get(calendarId, item.seriesMasterId);
    if (!master) return; // master not synced yet (out-of-order page) — next sync catches it up

    if (!item.originalStart) return;
    const originalStartUtc = normalizeUtcIso(item.originalStart);
    const key = dateKeyFromIso(originalStartUtc);

    if (item.isCancelled) {
      const exdates = master.exdates ? JSON.parse(master.exdates) : [];
      if (!exdates.includes(originalStartUtc)) exdates.push(originalStartUtc);
      db.prepare('UPDATE events SET exdates = ? WHERE calendar_id = ? AND id = ?')
        .run(JSON.stringify(exdates), calendarId, master.id);
      return;
    }

    const overrides = master.recurrence_overrides ? JSON.parse(master.recurrence_overrides) : {};
    overrides[key] = {
      summary: item.subject || master.summary,
      description: (item.body && item.body.content) || null,
      location: (item.location && item.location.displayName) || null,
      start_utc: toUtcIso(item.start),
      end_utc: toUtcIso(item.end),
      all_day: !!item.isAllDay
    };
    db.prepare('UPDATE events SET recurrence_overrides = ? WHERE calendar_id = ? AND id = ?')
      .run(JSON.stringify(overrides), calendarId, master.id);
    return;
  }

  // seriesMaster or a plain non-recurring singleInstance event.
  upsertEvent.run({
    id: item.id,
    calendar_id: calendarId,
    summary: item.subject || '(No title)',
    description: (item.body && item.body.content) || null,
    location: (item.location && item.location.displayName) || null,
    start_utc: toUtcIso(item.start),
    end_utc: toUtcIso(item.end),
    all_day: item.isAllDay ? 1 : 0,
    rrule: item.type === 'seriesMaster' ? graphRecurrenceToRRuleString(item) : null,
    exdates: null,
    recurrence_overrides: null,
    tzid: 'UTC'
  });
}

async function syncCalendarFromGraph(calendar) {
  try {
    const token = await getAccessToken(calendar.oauth_account_id);
    let url = calendar.delta_link
      ? calendar.delta_link
      : `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendar.graph_calendar_id)}/events/delta?$select=id,subject,body,location,start,end,isAllDay,type,seriesMasterId,originalStart,isCancelled,recurrence`;

    const tx = db.transaction((items) => {
      for (const item of items) applyGraphEvent(calendar.id, item);
    });

    let deltaLink = null;
    // The delta link is an absolute URL from Graph itself, already carrying
    // whatever $select/etc it needs — graphFetch is given the bare
    // path+query it expects, so strip GRAPH_BASE back off when following one.
    let guard = 0;
    while (url && guard < 50) {
      const relative = url.startsWith(GRAPH_BASE) ? url.slice(GRAPH_BASE.length) : url;
      const page = await graphFetch(token, relative);
      tx(page.value || []);
      url = page['@odata.nextLink'] || null;
      if (page['@odata.deltaLink']) deltaLink = page['@odata.deltaLink'];
      guard++;
    }

    if (deltaLink) setCalendarDeltaLink.run(deltaLink, calendar.id);
    setSyncOk.run(calendar.id);
    return { ok: true };
  } catch (err) {
    setSyncError.run(String(err.message || err), calendar.id);
    return { ok: false, error: String(err.message || err) };
  }
}

// ---------- write path: create / update / delete ----------

function toGraphDateTime(iso) {
  // Graph wants a bare local-looking dateTime + separate timeZone field;
  // since Homeport always works in UTC internally, timeZone is always
  // "UTC" and dateTime is just the ISO string with its trailing Z dropped.
  return { dateTime: iso.replace(/Z$/, ''), timeZone: 'UTC' };
}

// All-day events in Graph use whole calendar dates at midnight UTC with
// isAllDay: true, and Graph's own convention (like ICS) is an exclusive
// end date — mirrors how all_day events are already stored (see sync.js).
function buildGraphEventBody({ title, detail, location, allDay, start, end }) {
  return {
    subject: title || '(No title)',
    body: { contentType: 'text', content: detail || '' },
    location: location ? { displayName: location } : null,
    isAllDay: !!allDay,
    start: toGraphDateTime(start),
    end: toGraphDateTime(end)
  };
}

async function createEvent(calendar, fields) {
  const token = await getAccessToken(calendar.oauth_account_id);
  const body = buildGraphEventBody(fields);
  const created = await graphFetch(token, `/me/calendars/${encodeURIComponent(calendar.graph_calendar_id)}/events`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  applyGraphEvent(calendar.id, { ...created, type: 'singleInstance' });
  return getEventRow.get(calendar.id, created.id);
}

async function updateEvent(calendar, eventId, fields) {
  const token = await getAccessToken(calendar.oauth_account_id);
  const body = buildGraphEventBody(fields);
  const updated = await graphFetch(token, `/me/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
  applyGraphEvent(calendar.id, { ...updated, type: 'singleInstance' });
  return getEventRow.get(calendar.id, updated.id);
}

async function deleteEvent(calendar, eventId) {
  const token = await getAccessToken(calendar.oauth_account_id);
  await graphFetch(token, `/me/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  deleteEventRow.run(calendar.id, eventId);
}

module.exports = {
  isConfigured,
  getClientId,
  setClientId,
  listAccounts,
  deleteAccount,
  startConnect,
  getConnectStatus,
  listGraphCalendars,
  syncCalendarFromGraph,
  createEvent,
  updateEvent,
  deleteEvent,
  // Exposed for testing (pure-ish DB-application logic with no network of
  // its own) — not used elsewhere in the app.
  _internal: { applyGraphEvent, buildGraphEventBody, toUtcIso }
};
