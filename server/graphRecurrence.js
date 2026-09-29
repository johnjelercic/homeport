// Translates a Microsoft Graph event's `recurrence` object (a structured
// recurrencePattern/recurrenceRange pair — see
// https://learn.microsoft.com/en-us/graph/api/resources/recurrencepattern)
// into an RRULE text string that rrule.js's RRule.fromString() can parse,
// so the existing ICS-oriented expand.js can display Outlook's recurring
// events with zero changes of its own. There's no off-the-shelf npm
// package for this conversion (confirmed during research for this
// feature) — Graph's pattern space is narrower than full RFC 5545 RRULE
// syntax, so this only needs to cover Graph's six fixed pattern types,
// not general RRULE parsing.
//
// Read-path only: this is used when pulling events *from* Graph. Homeport
// only creates non-recurring events itself (see msgraph.js), so there's no
// reverse (RRULE -> Graph recurrence) direction to maintain yet.

const DAY_MAP = { sunday: 'SU', monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH', friday: 'FR', saturday: 'SA' };

function fmtUtcCompact(iso) {
  // RRULE DTSTART wants YYYYMMDDTHHMMSSZ.
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function fmtDateCompact(dateStr) {
  // recurrenceRange dates are plain "YYYY-MM-DD" with no time component.
  return dateStr.replace(/-/g, '');
}

// `event` is a raw Microsoft Graph event resource (with `recurrence` and
// `start`/`end` already normalized to UTC — see the `Prefer:
// outlook.timezone="UTC"` header set in msgraph.js). Returns an RRULE
// string (including DTSTART) or null if the pattern can't be represented.
function graphRecurrenceToRRuleString(event) {
  const rec = event.recurrence;
  if (!rec || !rec.pattern || !rec.range) return null;
  const { pattern, range } = rec;

  const parts = [];
  switch (pattern.type) {
    case 'daily':
      parts.push('FREQ=DAILY', `INTERVAL=${pattern.interval || 1}`);
      break;
    case 'weekly': {
      parts.push('FREQ=WEEKLY', `INTERVAL=${pattern.interval || 1}`);
      const days = (pattern.daysOfWeek || []).map((d) => DAY_MAP[d]).filter(Boolean);
      if (days.length) parts.push(`BYDAY=${days.join(',')}`);
      break;
    }
    case 'absoluteMonthly':
      parts.push('FREQ=MONTHLY', `INTERVAL=${pattern.interval || 1}`);
      if (pattern.dayOfMonth) parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
      break;
    case 'relativeMonthly': {
      parts.push('FREQ=MONTHLY', `INTERVAL=${pattern.interval || 1}`);
      const day = (pattern.daysOfWeek || [])[0];
      const ord = { first: 1, second: 2, third: 3, fourth: 4, last: -1 }[pattern.index || 'first'];
      if (day && DAY_MAP[day]) parts.push(`BYDAY=${ord}${DAY_MAP[day]}`);
      break;
    }
    case 'absoluteYearly':
      parts.push('FREQ=YEARLY', `INTERVAL=${pattern.interval || 1}`);
      if (pattern.month) parts.push(`BYMONTH=${pattern.month}`);
      if (pattern.dayOfMonth) parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
      break;
    case 'relativeYearly': {
      parts.push('FREQ=YEARLY', `INTERVAL=${pattern.interval || 1}`);
      if (pattern.month) parts.push(`BYMONTH=${pattern.month}`);
      const day = (pattern.daysOfWeek || [])[0];
      const ord = { first: 1, second: 2, third: 3, fourth: 4, last: -1 }[pattern.index || 'first'];
      if (day && DAY_MAP[day]) parts.push(`BYDAY=${ord}${DAY_MAP[day]}`);
      break;
    }
    default:
      return null; // unrecognized pattern type — skip rather than guess
  }

  if (range.type === 'numbered' && range.numberOfOccurrences) {
    parts.push(`COUNT=${range.numberOfOccurrences}`);
  } else if (range.type === 'endDate' && range.endDate) {
    parts.push(`UNTIL=${fmtDateCompact(range.endDate)}T235959Z`);
  }
  // range.type === 'noEnd' -> no COUNT/UNTIL, matches RRULE's own "forever" default.

  const dtstart = event.start && event.start.dateTime ? fmtUtcCompact(event.start.dateTime + 'Z') : null;
  const dtstartLine = dtstart ? `DTSTART:${dtstart}\n` : '';
  return `${dtstartLine}RRULE:${parts.join(';')}`;
}

module.exports = { graphRecurrenceToRRuleString };
