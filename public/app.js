(() => {
  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const REFRESH_EVENTS_MS = 5 * 60 * 1000;   // re-pull events every 5 min
  const REFRESH_CALENDARS_MS = 10 * 60 * 1000; // re-pull calendar list/colors every 10 min

  const state = {
    view: 'month',
    dayLayout: 'stacked',           // 'stacked' | 'timeline' — applies to week/3-day views
    anchor: startOfDay(new Date()), // the date currently being viewed
    calendars: [],                  // [{id, name, color, visible}]
    eventsByDay: new Map(),         // 'YYYY-MM-DD' -> [occurrence, ...]
  };

  // ---------- date helpers ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function localYmd(d) {
    // Local calendar date (not UTC) — used for bucketing events into day cells.
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function sameDay(a, b) { return localYmd(a) === localYmd(b); }

  // All-day events (ICS VALUE=DATE) carry no real timezone — they're
  // stored as a UTC-midnight anchor for a calendar date (e.g. Sept 20
  // stores as 2026-09-20T00:00:00Z), not a real instant. Reading that
  // back out through the viewer's LOCAL timezone (as localYmd does) can
  // shift the date by a day for anyone west of UTC — an all-day event
  // meant for Sept 20 would land in the Sept 19 bucket in US timezones.
  // These read the calendar date straight out in UTC terms instead, so
  // it matches what was actually written.
  function utcYmd(d) {
    const y = d.getUTCFullYear(), m = String(d.getUTCMonth()+1).padStart(2,'0'), day = String(d.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function addUtcDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
  function utcDateOnly(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }

  function startOfMonthGrid(anchor) {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return addDays(first, -first.getDay()); // back up to the preceding Sunday
  }
  function startOfWeek(anchor) {
    return addDays(startOfDay(anchor), -anchor.getDay());
  }

  function fmtTime(d) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDateRange(start, end, allDay) {
    if (allDay) {
      // Same UTC-anchored-date reasoning as bucketEvents: format using UTC
      // so the printed date matches what was actually stored, regardless
      // of the viewer's local timezone.
      const sameDate = utcYmd(start) === utcYmd(addUtcDays(end, -1));
      if (sameDate) return start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
      return `${start.toLocaleDateString([], { month: 'long', day: 'numeric', timeZone: 'UTC' })} – ${addUtcDays(end,-1).toLocaleDateString([], { month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
    }
    if (sameDay(start, end)) {
      return `${start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(start)} – ${fmtTime(end)}`;
    }
    return `${start.toLocaleDateString([], { month:'long', day:'numeric' })} ${fmtTime(start)} – ${end.toLocaleDateString([], { month:'long', day:'numeric' })} ${fmtTime(end)}`;
  }

  // ---------- data loading ----------
  async function loadCalendars() {
    const res = await fetch('/api/calendars');
    state.calendars = await res.json();
    renderLegend();
  }

  async function loadEvents() {
    let rangeStart, rangeEnd;
    if (state.view === 'month') {
      rangeStart = startOfMonthGrid(state.anchor);
      rangeEnd = addDays(rangeStart, 42);
    } else if (state.view === '3day') {
      rangeStart = startOfDay(state.anchor);
      rangeEnd = addDays(rangeStart, 3);
    } else {
      rangeStart = startOfWeek(state.anchor);
      rangeEnd = addDays(rangeStart, 7);
    }
    document.getElementById('syncStatus').textContent = 'Updating…';
    try {
      const res = await fetch(`/api/events?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`);
      const events = await res.json();
      bucketEvents(events);
      renderSyncStatus();
    } catch (e) {
      document.getElementById('syncStatus').textContent = 'Could not reach server — will retry';
    }
    render();
  }

  function bucketEvents(events) {
    state.eventsByDay = new Map();
    for (const occ of events) {
      const start = new Date(occ.start);
      const end = new Date(occ.end);
      let cursor, last, keyFor, stepFn;
      if (occ.all_day) {
        cursor = utcDateOnly(start);
        last = utcDateOnly(addUtcDays(end, -1));
        keyFor = utcYmd;
        stepFn = (d) => addUtcDays(d, 1);
      } else {
        // For multi-day timed events, add a pill on each local day it spans.
        cursor = startOfDay(start);
        last = startOfDay(end);
        keyFor = localYmd;
        stepFn = (d) => addDays(d, 1);
      }
      let guard = 0;
      while (cursor <= last && guard < 366) {
        const key = keyFor(cursor);
        if (!state.eventsByDay.has(key)) state.eventsByDay.set(key, []);
        state.eventsByDay.get(key).push(occ);
        cursor = stepFn(cursor);
        guard++;
      }
    }
  }

  function renderSyncStatus() {
    const errored = state.calendars.filter((c) => c.last_sync_status === 'error');
    const el = document.getElementById('syncStatus');
    if (errored.length) {
      el.textContent = `⚠ ${errored.map((c) => c.name).join(', ')} couldn't sync`;
      el.classList.add('sync-warning');
    } else {
      const latest = state.calendars
        .map((c) => c.last_synced_at)
        .filter(Boolean)
        .sort()
        .pop();
      el.classList.remove('sync-warning');
      el.textContent = latest ? `Last updated ${new Date(latest + 'Z').toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}` : 'Not yet synced';
    }
  }

  // ---------- rendering ----------
  function colorFor(calendarId) {
    const c = state.calendars.find((c) => c.id === calendarId);
    return c ? c.color : '#3B6E8F';
  }

  function renderLegend() {
    const el = document.getElementById('legend');
    el.innerHTML = '';
    state.calendars.forEach((cal) => {
      const chip = document.createElement('button');
      chip.className = 'legend-chip' + (cal.visible ? '' : ' off');
      chip.innerHTML = `<span class="dot" style="background:${cal.color}"></span><span>${escapeHtml(cal.name)}</span>`;
      chip.addEventListener('click', async () => {
        cal.visible = cal.visible ? 0 : 1;
        chip.classList.toggle('off', !cal.visible);
        await fetch(`/api/calendars/${cal.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visible: !!cal.visible })
        });
        loadEvents();
      });
      el.appendChild(chip);
    });
  }

  function render() {
    updateHeaderDate();
    document.getElementById('monthGrid').hidden = state.view !== 'month';
    document.getElementById('weekGrid').hidden = state.view !== 'week';
    document.getElementById('threeDayGrid').hidden = state.view !== '3day';
    document.getElementById('weekdayRow').hidden = state.view !== 'month';
    document.getElementById('layoutToggle').hidden = state.view === 'month';
    if (state.view === 'month') renderMonthGrid();
    else if (state.view === '3day') renderThreeDayGrid();
    else renderWeekGrid();
    renderRangeLabel();
  }

  function renderRangeLabel() {
    const el = document.getElementById('rangeLabel');
    if (state.view === 'month') {
      el.textContent = `${MONTH_NAMES[state.anchor.getMonth()]} ${state.anchor.getFullYear()}`;
    } else if (state.view === '3day') {
      const s = startOfDay(state.anchor), e = addDays(s, 2);
      el.textContent = `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${MONTH_NAMES[e.getMonth()]} ${e.getDate()}`;
    } else {
      const s = startOfWeek(state.anchor), e = addDays(s, 6);
      el.textContent = `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${MONTH_NAMES[e.getMonth()]} ${e.getDate()}`;
    }
  }

  function updateHeaderDate() {
    const now = new Date();
    document.getElementById('hdrWeekday').textContent = WEEKDAY_LONG[now.getDay()];
    document.getElementById('hdrMonthDay').textContent = `${MONTH_NAMES[now.getMonth()]} ${now.getDate()}`;
    document.getElementById('hdrClock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function renderMonthGrid() {
    document.getElementById('weekdayRow').innerHTML = WEEKDAY_NAMES.map((w) => `<div>${w}</div>`).join('');
    const grid = document.getElementById('monthGrid');
    grid.innerHTML = '';
    const gridStart = startOfMonthGrid(state.anchor);
    const today = new Date();

    for (let i = 0; i < 42; i++) {
      const day = addDays(gridStart, i);
      const key = localYmd(day);
      const inMonth = day.getMonth() === state.anchor.getMonth();
      const cell = document.createElement('div');
      cell.className = 'day-cell' + (inMonth ? '' : ' outside') + (sameDay(day, today) ? ' today' : '');

      const num = document.createElement('div');
      num.className = 'day-num';
      num.textContent = day.getDate();
      cell.appendChild(num);

      const eventsWrap = document.createElement('div');
      eventsWrap.className = 'day-events';
      const dayEvents = (state.eventsByDay.get(key) || []).slice().sort((a,b) => new Date(a.start) - new Date(b.start));
      const MAX_SHOWN = 3;
      dayEvents.slice(0, MAX_SHOWN).forEach((occ) => eventsWrap.appendChild(renderPill(occ)));
      if (dayEvents.length > MAX_SHOWN) {
        const more = document.createElement('button');
        more.className = 'more-btn';
        more.textContent = `+${dayEvents.length - MAX_SHOWN} more`;
        more.addEventListener('click', () => openDayModal(day, dayEvents));
        eventsWrap.appendChild(more);
      }
      cell.appendChild(eventsWrap);
      grid.appendChild(cell);
    }
  }

  function renderWeekGrid() {
    const grid = document.getElementById('weekGrid');
    const weekStart = startOfWeek(state.anchor);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));
    renderColumns(grid, days, 'week');
  }

  function renderThreeDayGrid() {
    const grid = document.getElementById('threeDayGrid');
    const start = startOfDay(state.anchor);
    const days = [];
    for (let i = 0; i < 3; i++) days.push(addDays(start, i));
    renderColumns(grid, days, '3day');
  }

  function renderColumns(grid, days, variant) {
    grid.classList.toggle('timeline-mode', state.dayLayout === 'timeline');
    grid.innerHTML = '';
    if (state.dayLayout === 'timeline') renderTimelineColumns(grid, days, variant);
    else renderStackedColumns(grid, days, variant);
  }

  function renderStackedColumns(grid, days, variant) {
    const today = new Date();
    const colClass = variant === 'week' ? 'week-day-col' : 'three-day-col';
    const headClass = variant === 'week' ? 'week-day-head' : 'three-day-head';
    const eventsClass = variant === 'week' ? 'week-events' : 'three-day-events';

    days.forEach((day) => {
      const key = localYmd(day);
      const col = document.createElement('div');
      col.className = colClass + (sameDay(day, today) ? ' today' : '');

      const head = document.createElement('div');
      head.className = headClass;
      head.innerHTML = variant === 'week'
        ? `<span class="num">${day.getDate()}</span>${WEEKDAY_NAMES[day.getDay()]}`
        : `<span class="dayname">${WEEKDAY_LONG[day.getDay()]}</span><span class="num">${day.getDate()}</span>`;
      col.appendChild(head);

      const eventsWrap = document.createElement('div');
      eventsWrap.className = eventsClass;
      const dayEvents = (state.eventsByDay.get(key) || []).slice().sort((a,b) => new Date(a.start) - new Date(b.start));
      if (dayEvents.length === 0) {
        const empty = document.createElement('div');
        if (variant === '3day') { empty.className = 'empty'; empty.textContent = 'Nothing scheduled'; }
        else { empty.style.opacity = '0.4'; empty.style.fontSize = '12px'; empty.textContent = '—'; }
        eventsWrap.appendChild(empty);
      }
      dayEvents.forEach((occ) => eventsWrap.appendChild(renderPill(occ, true)));
      col.appendChild(eventsWrap);
      grid.appendChild(col);
    });
  }

  // ---------- Timeline layout ----------

  // Adjustable in Settings (Calendars tab → "Timeline hours") — these are
  // just the defaults shown before that fetch completes, and the fallback
  // if the setting is ever missing. Condensing to the day's usable hours
  // (rather than auto-expanding to fit outlier events) gives everything
  // within the range more vertical room, which is the whole point of a
  // timeline view. Anything outside the configured window (a 2am flight,
  // an 11:30pm event) is clamped to sit flush against the top or bottom
  // edge instead of stretching the range to include it.
  let TIMELINE_START_MIN = 4 * 60;   // 4:00 AM
  let TIMELINE_END_MIN = 23 * 60;    // 11:00 PM
  const TIMELINE_MIN_HEIGHT_PCT = 3;          // floor height so short events stay legible/tappable
  const TIMELINE_HOUR_STEP = 2;               // gridlines/labels every 2 hours

  function minutesIntoDay(date, dayStart) {
    return (date - dayStart) / 60000;
  }

  // Same shared range for every column in the grid (not computed per-day),
  // so a given vertical position means the same time-of-day on every
  // column — that alignment is the whole point of a timeline view.
  function computeTimelineRange() {
    return { startMin: TIMELINE_START_MIN, endMin: TIMELINE_END_MIN };
  }

  function clampDate(d, min, max) { return d < min ? min : (d > max ? max : d); }

  // Lane-based overlap layout, grouped by cluster of mutually-overlapping
  // events (a sweep over sorted events, starting a new cluster whenever a
  // gap appears) so two events that overlap each other split the column
  // width, without forcing unrelated non-overlapping events elsewhere in
  // the same day to also shrink.
  function layoutDayEvents(dayEvents, dayStart, dayEnd) {
    const items = dayEvents
      .filter((occ) => !occ.all_day)
      .map((occ) => ({
        occ,
        s: clampDate(new Date(occ.start), dayStart, dayEnd),
        e: clampDate(new Date(occ.end), dayStart, dayEnd)
      }))
      .sort((a, b) => a.s - b.s || a.e - b.e);

    const clusters = [];
    let current = [];
    let clusterEnd = null;
    items.forEach((item) => {
      if (current.length === 0 || item.s >= clusterEnd) {
        if (current.length) clusters.push(current);
        current = [item];
        clusterEnd = item.e;
      } else {
        current.push(item);
        if (item.e > clusterEnd) clusterEnd = item.e;
      }
    });
    if (current.length) clusters.push(current);

    clusters.forEach((cluster) => {
      const laneEnds = [];
      cluster.forEach((item) => {
        let lane = laneEnds.findIndex((end) => end <= item.s);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.e); }
        else { laneEnds[lane] = item.e; }
        item.lane = lane;
      });
      const laneCount = laneEnds.length || 1;
      cluster.forEach((item) => { item.laneCount = laneCount; });
    });

    return items;
  }

  function hourLabel(min) {
    const h = Math.floor(min / 60);
    const ampm = h < 12 || h === 24 ? 'AM' : 'PM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return `${h12} ${ampm}`;
  }

  function renderTimelineColumns(grid, days, variant) {
    const { startMin, endMin } = computeTimelineRange();
    const totalMin = endMin - startMin;
    const hourCount = totalMin / 60;
    const today = new Date();
    const gridlineCss = `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${100 / (hourCount / TIMELINE_HOUR_STEP)}%)`;

    // Precompute everything per day once, then emit in row-major order
    // (all heads, then all all-day strips, then all bodies) to match the
    // grid's explicit row structure — see the CSS comment above
    // .week-grid.timeline-mode for why that structure exists.
    const dayData = days.map((day) => {
      const dayStart = startOfDay(day);
      // Clamp event times to the 4am-11pm window (not full midnight-to-
      // midnight) — an event outside it (an overnight flight, say) sits
      // flush against whichever edge it's closest to rather than
      // stretching the range to include it.
      const windowStart = new Date(dayStart.getTime() + startMin * 60000);
      const windowEnd = new Date(dayStart.getTime() + endMin * 60000);
      const isToday = sameDay(day, today);
      const key = localYmd(day);
      const allDayEvents = (state.eventsByDay.get(key) || []).filter((occ) => occ.all_day);
      const timedEvents = layoutDayEvents(state.eventsByDay.get(key) || [], windowStart, windowEnd);
      return { day, dayStart, isToday, allDayEvents, timedEvents };
    });

    // Row 1: empty spacer under the gutter, then each day's head.
    grid.appendChild(document.createElement('div'));
    dayData.forEach(({ day, isToday }) => {
      const head = document.createElement('div');
      head.className = 'col-head ' + (variant === 'week' ? 'week-day-head' : 'three-day-head') + (isToday ? ' today' : '');
      head.innerHTML = variant === 'week'
        ? `<span class="num">${day.getDate()}</span>${WEEKDAY_NAMES[day.getDay()]}`
        : `<span class="dayname">${WEEKDAY_LONG[day.getDay()]}</span><span class="num">${day.getDate()}</span>`;
      grid.appendChild(head);
    });

    // Row 2: another empty spacer, then each day's all-day strip.
    grid.appendChild(document.createElement('div'));
    dayData.forEach(({ allDayEvents, isToday }) => {
      const allDayWrap = document.createElement('div');
      allDayWrap.className = 'timeline-allday' + (isToday ? ' today' : '');
      allDayEvents.forEach((occ) => allDayWrap.appendChild(renderPill(occ, true)));
      grid.appendChild(allDayWrap);
    });

    // Row 3: the real gutter (hour labels), then each day's timed body —
    // both sized by this row's own height, guaranteed equal by CSS Grid
    // since rows 1-2 are `auto` and this is the only `1fr` row.
    const gutter = document.createElement('div');
    gutter.className = 'timeline-gutter';
    for (let m = startMin; m <= endMin; m += 60 * TIMELINE_HOUR_STEP) {
      const label = document.createElement('div');
      label.className = 'gutter-label';
      label.style.top = `${((m - startMin) / totalMin) * 100}%`;
      label.textContent = hourLabel(m);
      gutter.appendChild(label);
    }
    grid.appendChild(gutter);

    dayData.forEach(({ dayStart, isToday, timedEvents }) => {
      const body = document.createElement('div');
      body.className = 'timeline-body' + (isToday ? ' today' : '');
      body.style.backgroundImage = gridlineCss;

      timedEvents.forEach((item) => {
        const sMin = minutesIntoDay(item.s, dayStart);
        const eMin = minutesIntoDay(item.e, dayStart);
        const topPct = ((sMin - startMin) / totalMin) * 100;
        const heightPct = Math.max(((eMin - sMin) / totalMin) * 100, TIMELINE_MIN_HEIGHT_PCT);
        const widthPct = 100 / item.laneCount;

        const block = document.createElement('button');
        block.className = 'timeline-event';
        block.style.top = `${topPct}%`;
        block.style.height = `${heightPct}%`;
        block.style.left = `${item.lane * widthPct}%`;
        block.style.width = `${widthPct - (item.laneCount > 1 ? 2 : 0)}%`;
        const color = item.occ.color || colorFor(item.occ.calendar_id);
        block.style.setProperty('--pill-bg', color);
        const timeStr = fmtTime(new Date(item.occ.start));
        block.innerHTML = `<span class="tt">${timeStr}</span><span class="tn">${escapeHtml(item.occ.summary || '(No title)')}</span>`;
        block.addEventListener('click', (e) => { e.stopPropagation(); openEventModal(item.occ); });
        body.appendChild(block);
      });

      grid.appendChild(body);
    });

    // Draw the now-line immediately on this fresh render, then hand off to
    // its own independent fast timer (see updateNowLine/boot) to keep it
    // correct going forward — its position only depends on wall-clock
    // time, not on event data, so it shouldn't have to wait on the full
    // 5-minute data-refresh cycle to stay accurate.
    updateNowLine();
  }

  // Repositions (or creates/removes) the "now" line without touching
  // anything else — cheap enough to run on a short interval independent
  // of loadEvents(), unlike a full grid rebuild.
  function updateNowLine() {
    const todayBody = document.querySelector('.timeline-body.today');
    if (!todayBody) return; // not in timeline layout, or today isn't in the visible range

    const { startMin, endMin } = computeTimelineRange();
    const totalMin = endMin - startMin;
    const now = new Date();
    const nowMin = minutesIntoDay(now, startOfDay(now));

    let line = todayBody.querySelector('.timeline-now-line');
    if (nowMin >= startMin && nowMin <= endMin) {
      if (!line) {
        line = document.createElement('div');
        line.className = 'timeline-now-line';
        todayBody.appendChild(line);
      }
      line.style.top = `${((nowMin - startMin) / totalMin) * 100}%`;
    } else if (line) {
      line.remove();
    }
  }

  function renderPill(occ, verbose) {
    const btn = document.createElement('button');
    btn.className = 'event-pill';
    const color = occ.color || colorFor(occ.calendar_id);
    btn.style.setProperty('--pill-bg', color);
    btn.style.setProperty('--pill-fg', '#fff');
    const timeStr = occ.all_day ? 'All day' : fmtTime(new Date(occ.start));
    btn.innerHTML = `<span class="t">${timeStr}</span>${escapeHtml(occ.summary || '(No title)')}`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEventModal(occ); });
    return btn;
  }

  // ---------- modals ----------
  // The starting address for directions is remembered across every event
  // (not per-event) — on a fixed kiosk display, "from" is realistically
  // always the same place, so once it's set, every future event shows a
  // route+commute time immediately with no re-typing. A per-device
  // convenience, so localStorage (not the server) is the right place for
  // it, per-viewer and never shared.
  function getSavedMapFrom() {
    try { return localStorage.getItem('mc_map_from') || ''; } catch (e) { return ''; }
  }
  function saveMapFrom(v) {
    try { localStorage.setItem('mc_map_from', v); } catch (e) { /* ignore — non-essential */ }
  }

  // Keyless embed (maps.google.com/maps?...&output=embed) rather than the
  // official Maps Embed API, which needs a Google Cloud API key — this
  // keeps the app zero-configuration. It's an unofficial-but-long-standing
  // pattern; if Google ever changes it, this is the one place to update.
  function updateMapFrame(destination, from) {
    const mapFrame = document.getElementById('modalMapFrame');
    if (from && from.trim()) {
      mapFrame.src = `https://maps.google.com/maps?saddr=${encodeURIComponent(from.trim())}&daddr=${encodeURIComponent(destination)}&output=embed`;
    } else {
      mapFrame.src = `https://maps.google.com/maps?q=${encodeURIComponent(destination)}&output=embed`;
    }
  }

  function openEventModal(occ) {
    const eventColor = occ.color || colorFor(occ.calendar_id);
    const baseColor = colorFor(occ.calendar_id);
    document.getElementById('modalAccent').style.background = eventColor;
    const calNameEl = document.getElementById('modalCalName');
    calNameEl.style.setProperty('--accent-color', baseColor);
    calNameEl.querySelector('.dot').style.background = baseColor;
    calNameEl.querySelector('span:last-child').textContent = calendarName(occ.calendar_id);
    document.getElementById('modalTitle').textContent = occ.summary || '(No title)';
    document.getElementById('modalTimeRow').innerHTML = `${clockIcon()}<span>${fmtDateRange(new Date(occ.start), new Date(occ.end), occ.all_day)}</span>`;
    const locRow = document.getElementById('modalLocationRow');
    const mapWrap = document.getElementById('modalMap');
    if (occ.location) {
      locRow.hidden = false;
      locRow.innerHTML = `${pinIcon()}<span>${escapeHtml(occ.location)}</span>`;
      mapWrap.hidden = false;
      mapWrap.dataset.destination = occ.location;
      const savedFrom = getSavedMapFrom();
      document.getElementById('modalMapFrom').value = savedFrom;
      updateMapFrame(occ.location, savedFrom);
    } else {
      locRow.hidden = true;
      mapWrap.hidden = true;
      mapWrap.dataset.destination = '';
      document.getElementById('modalMapFrame').src = ''; // stop loading / drop any stale map
    }
    document.getElementById('modalDescription').textContent = occ.description || '';
    document.getElementById('eventModal').hidden = false;
  }

  function openDayModal(day, dayEvents) {
    document.getElementById('dayModalTitle').textContent = day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const wrap = document.getElementById('dayModalEvents');
    wrap.innerHTML = '';
    dayEvents.forEach((occ) => {
      const b = document.createElement('button');
      const timeStr = occ.all_day ? 'All day' : fmtTime(new Date(occ.start));
      b.innerHTML = `<strong>${timeStr}</strong> — ${escapeHtml(occ.summary || '(No title)')}`;
      b.style.borderLeft = `4px solid ${occ.color || colorFor(occ.calendar_id)}`;
      b.addEventListener('click', () => { document.getElementById('dayModal').hidden = true; openEventModal(occ); });
      wrap.appendChild(b);
    });
    document.getElementById('dayModal').hidden = false;
  }

  function calendarName(id) {
    const c = state.calendars.find((c) => c.id === id);
    return c ? c.name : '';
  }

  function clockIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;
  }
  function pinIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-7.2-7-12a7 7 0 0 1 14 0c0 4.8-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- navigation & wiring ----------
  function goPrev() {
    if (state.view === 'month') {
      state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() - 1, 1);
    } else if (state.view === '3day') {
      state.anchor = addDays(state.anchor, -1);
    } else {
      state.anchor = addDays(state.anchor, -7);
    }
    loadEvents();
  }
  function goNext() {
    if (state.view === 'month') {
      state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 1);
    } else if (state.view === '3day') {
      state.anchor = addDays(state.anchor, 1);
    } else {
      state.anchor = addDays(state.anchor, 7);
    }
    loadEvents();
  }
  function goToday() { state.anchor = startOfDay(new Date()); loadEvents(); }

  // Shared by the toolbar buttons and by the one-time default-view/layout
  // application at boot (see applyDisplaySettings), so both paths keep
  // state and the toggle buttons' active class in sync the same way.
  function applyView(view) {
    document.querySelectorAll('.view-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    state.view = view;
  }
  function applyLayout(layout) {
    document.querySelectorAll('.layout-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));
    state.dayLayout = layout;
  }

  function wire() {
    document.getElementById('navPrev').addEventListener('click', goPrev);
    document.getElementById('navNext').addEventListener('click', goNext);
    document.getElementById('navToday').addEventListener('click', goToday);
    document.querySelectorAll('.view-toggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyView(btn.dataset.view);
        render();
        loadEvents();
      });
    });
    document.querySelectorAll('.layout-toggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyLayout(btn.dataset.layout);
        render(); // no need to re-fetch — same events, different layout
      });
    });
    document.getElementById('closeEventModal').addEventListener('click', () => document.getElementById('eventModal').hidden = true);
    document.getElementById('closeDayModal').addEventListener('click', () => document.getElementById('dayModal').hidden = true);
    document.getElementById('modalMapGoBtn').addEventListener('click', () => {
      const from = document.getElementById('modalMapFrom').value.trim();
      const destination = document.getElementById('modalMap').dataset.destination;
      if (!destination) return;
      saveMapFrom(from);
      updateMapFrame(destination, from);
    });
    document.getElementById('modalMapFrom').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('modalMapGoBtn').click(); }
    });
    document.getElementById('eventModal').addEventListener('click', (e) => { if (e.target.id === 'eventModal') e.currentTarget.hidden = true; });
    document.getElementById('dayModal').addEventListener('click', (e) => { if (e.target.id === 'dayModal') e.currentTarget.hidden = true; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { document.getElementById('eventModal').hidden = true; document.getElementById('dayModal').hidden = true; }
    });
  }

  async function applyTheme() {
    const { theme } = await window.HomeportTheme.applyActiveTheme();
    const emojiEl = document.getElementById('hdrEmoji');
    emojiEl.textContent = (theme && theme.emoji) || '';
    emojiEl.hidden = !(theme && theme.emoji);
  }

  // ---------- Idle timeout / photo frame ----------

  // Defaults; actual values are fetched from /api/settings (adjustable in
  // Settings → Photo Frame timing, and View Preferences) via
  // applyDisplaySettings() below, so these are only what's shown before
  // that first fetch completes.
  let IDLE_TIMEOUT_MS = 10 * 60 * 1000;
  let PHOTO_INTERVAL_MS = 20 * 1000;

  // Seeded from the configured default view/layout exactly once, at boot
  // (below) — later calls to applyDisplaySettings happen on a refresh
  // timer or when the tab wakes up, and shouldn't yank someone back to
  // the configured default while they're mid-browse.
  let defaultViewApplied = false;

  async function applyDisplaySettings() {
    const s = await window.HomeportTheme.fetchAllSettings();
    if (s.idle_timeout_minutes) IDLE_TIMEOUT_MS = s.idle_timeout_minutes * 60 * 1000;
    if (s.photo_interval_seconds) PHOTO_INTERVAL_MS = s.photo_interval_seconds * 1000;
    // Plain truthy checks (like above) would wrongly skip a legitimate
    // start hour of 0 (midnight) — these two need an explicit undefined
    // check instead.
    if (s.timeline_start_hour !== undefined) TIMELINE_START_MIN = s.timeline_start_hour * 60;
    if (s.timeline_end_hour !== undefined) TIMELINE_END_MIN = s.timeline_end_hour * 60;

    if (!defaultViewApplied) {
      defaultViewApplied = true;
      if (['month', 'week', '3day'].includes(s.default_view)) applyView(s.default_view);
      if (['stacked', 'timeline'].includes(s.default_layout)) applyLayout(s.default_layout);
    }
  }

  let idleTimer = null;
  let photoCycleTimer = null;
  let photoList = [];
  let photoIndex = 0;
  let activePfImgId = 'pfImgA';

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(enterPhotoFrame, IDLE_TIMEOUT_MS);
  }

  function shufflePhotos(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  async function enterPhotoFrame() {
    // Fetched fresh every time we go idle (not cached at boot) so photos
    // dropped into the folder since the display last loaded still show up
    // without needing a full page reload.
    try {
      const res = await fetch('/api/photos');
      photoList = await res.json();
    } catch (e) {
      photoList = [];
    }
    if (!photoList.length) {
      resetIdleTimer(); // nothing to show yet — just stay on the calendar and check again later
      return;
    }
    shufflePhotos(photoList);
    photoIndex = 0;
    activePfImgId = 'pfImgA';

    document.getElementById('photoFrame').hidden = false;
    updatePfClock();

    const imgA = document.getElementById('pfImgA');
    document.getElementById('pfImgB').classList.remove('active');
    imgA.classList.remove('active');
    imgA.onload = () => requestAnimationFrame(() => imgA.classList.add('active'));
    imgA.src = photoList[0].url;

    photoCycleTimer = setInterval(advancePhoto, PHOTO_INTERVAL_MS);
  }

  function advancePhoto() {
    if (!photoList.length) return;
    photoIndex = (photoIndex + 1) % photoList.length;
    const nextId = activePfImgId === 'pfImgA' ? 'pfImgB' : 'pfImgA';
    const prevId = activePfImgId;
    const nextImg = document.getElementById(nextId);
    // Wait for the image to actually load before crossfading in, so a slow
    // decode never shows as a flash of black.
    nextImg.onload = () => {
      nextImg.classList.add('active');
      document.getElementById(prevId).classList.remove('active');
      activePfImgId = nextId;
    };
    nextImg.src = photoList[photoIndex].url;
    updatePfClock();
  }

  function updatePfClock() {
    document.getElementById('pfClock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function exitPhotoFrame() {
    const frame = document.getElementById('photoFrame');
    if (frame.hidden) return;
    frame.hidden = true;
    if (photoCycleTimer) { clearInterval(photoCycleTimer); photoCycleTimer = null; }
    ['pfImgA', 'pfImgB'].forEach((id) => {
      const img = document.getElementById(id);
      img.classList.remove('active');
      img.onload = null;
      img.src = '';
    });
    // Force an immediate refresh rather than waiting for the next scheduled
    // interval — those can be throttled or fully suspended by the OS/browser
    // while the screen was off or the tab was backgrounded during the idle
    // period, so the calendar (and the timeline's "now" line specifically)
    // could otherwise sit stale for a while after waking, even though the
    // header clock self-corrects almost instantly on its own faster timer.
    refreshOnWake();
  }

  function refreshOnWake() {
    loadEvents();
    applyTheme();
    applyDisplaySettings();
  }

  function wireIdleDetection() {
    ['touchstart', 'mousedown', 'mousemove', 'keydown'].forEach((evt) => {
      document.addEventListener(evt, () => {
        exitPhotoFrame();
        resetIdleTimer();
      }, { passive: true });
    });
    // Covers the same staleness case from the other direction: the screen/
    // tab coming back to the foreground without necessarily going through
    // the photo frame at all (e.g. the browser itself was backgrounded).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshOnWake();
        resetIdleTimer();
      }
    });
  }

  async function boot() {
    wire();
    wireIdleDetection();
    updateHeaderDate();
    setInterval(updateHeaderDate, 15 * 1000);
    setInterval(updatePfClock, 15 * 1000);
    setInterval(updateNowLine, 30 * 1000);
    await applyTheme();
    await applyDisplaySettings();
    await loadCalendars();
    await loadEvents();
    setInterval(loadEvents, REFRESH_EVENTS_MS);
    setInterval(() => { loadCalendars(); applyTheme(); applyDisplaySettings(); }, REFRESH_CALENDARS_MS);
    // Re-render the "today" highlight and header shortly after local midnight.
    scheduleMidnightRefresh();
    resetIdleTimer();
  }

  function scheduleMidnightRefresh() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    setTimeout(() => { loadEvents(); scheduleMidnightRefresh(); }, next - now);
  }

  boot();
})();
