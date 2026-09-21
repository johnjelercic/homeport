const { RRule } = require('rrule');

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Expand one stored (raw) event row into concrete occurrences that fall
 * within [rangeStart, rangeEnd]. Non-recurring events yield at most one
 * occurrence. Recurring events are expanded via RRULE, with EXDATEs removed
 * and RECURRENCE-ID overrides applied (matched by local occurrence date,
 * which is how node-ical keys them).
 */
function expandEvent(row, rangeStart, rangeEnd) {
  const occurrences = [];

  if (!row.rrule) {
    const start = new Date(row.start_utc);
    const end = row.end_utc ? new Date(row.end_utc) : start;
    if (end >= rangeStart && start <= rangeEnd) {
      occurrences.push({
        occurrence_id: row.id,
        uid: row.id,
        calendar_id: row.calendar_id,
        summary: row.summary,
        description: row.description,
        location: row.location,
        start: start.toISOString(),
        end: end.toISOString(),
        all_day: !!row.all_day
      });
    }
    return occurrences;
  }

  // Recurring event
  let rule;
  try {
    rule = RRule.fromString(row.rrule);
  } catch (e) {
    return occurrences; // malformed rrule, skip rather than crash the whole render
  }

  const baseStart = new Date(row.start_utc);
  const baseEnd = row.end_utc ? new Date(row.end_utc) : baseStart;
  const durationMs = baseEnd.getTime() - baseStart.getTime();

  const exdateKeys = new Set(
    row.exdates ? JSON.parse(row.exdates).map((iso) => dateKey(new Date(iso))) : []
  );
  const overrides = row.recurrence_overrides ? JSON.parse(row.recurrence_overrides) : {};

  // Pad the window so multi-hour/multi-day events that start just before
  // rangeStart but overlap into it are still included.
  const padMs = Math.max(durationMs, 24 * 60 * 60 * 1000);
  const queryStart = new Date(rangeStart.getTime() - padMs);

  let dates;
  try {
    dates = rule.between(queryStart, rangeEnd, true);
  } catch (e) {
    return occurrences;
  }

  for (const occStart of dates) {
    const key = dateKey(occStart);
    if (exdateKeys.has(key)) continue;

    const override = overrides[key];
    let start = occStart;
    let end = new Date(occStart.getTime() + durationMs);
    let summary = row.summary;
    let description = row.description;
    let location = row.location;
    let allDay = !!row.all_day;

    if (override) {
      if (override.start_utc) start = new Date(override.start_utc);
      if (override.end_utc) end = new Date(override.end_utc);
      if (override.summary) summary = override.summary;
      if (override.description) description = override.description;
      if (override.location) location = override.location;
      allDay = !!override.all_day;
    }

    if (end >= rangeStart && start <= rangeEnd) {
      occurrences.push({
        occurrence_id: `${row.id}_${key}`,
        uid: row.id,
        calendar_id: row.calendar_id,
        summary,
        description,
        location,
        start: start.toISOString(),
        end: end.toISOString(),
        all_day: allDay
      });
    }
  }

  return occurrences;
}

function expandEvents(rows, rangeStart, rangeEnd) {
  const out = [];
  for (const row of rows) {
    out.push(...expandEvent(row, rangeStart, rangeEnd));
  }
  out.sort((a, b) => new Date(a.start) - new Date(b.start));
  return out;
}

module.exports = { expandEvents, expandEvent };
