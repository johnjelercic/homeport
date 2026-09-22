(() => {
  const PALETTE = [
    '#4F46E5', '#2563EB', '#0891B2', '#0D9488', '#059669', '#4D7C0F',
    '#D97706', '#EA580C', '#DC2626', '#E11D48', '#DB2777', '#C026D3',
    '#7C3AED', '#92400E', '#475569', '#334155'
  ];
  let selectedColor = PALETTE[0];

  // Reusable palette + custom-color picker. `initial` is the starting
  // selected color, `onChange(hex)` fires whenever the user picks one
  // (from the palette or the native color input). Returns the current
  // color via a getter so callers can read the latest pick on demand.
  function buildColorPicker(container, initial, onChange) {
    container.innerHTML = '';
    let current = initial;

    const swatchWrap = document.createElement('div');
    swatchWrap.className = 'color-picker';
    PALETTE.forEach((hex) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'color-swatch' + (hex.toLowerCase() === (initial || '').toLowerCase() ? ' selected' : '');
      sw.style.background = hex;
      sw.addEventListener('click', () => {
        current = hex;
        swatchWrap.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
        sw.classList.add('selected');
        customInput.value = hex;
        onChange(hex);
      });
      swatchWrap.appendChild(sw);
    });
    container.appendChild(swatchWrap);

    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.className = 'custom-color-input';
    customInput.title = 'Choose a custom color';
    customInput.value = /^#[0-9a-f]{6}$/i.test(initial) ? initial : '#888888';
    customInput.addEventListener('input', () => {
      current = customInput.value;
      swatchWrap.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      onChange(current);
    });
    container.appendChild(customInput);

    return { get: () => current };
  }

  function statusLabel(cal) {
    if (!cal.last_synced_at) return { text: 'Not yet synced', cls: 'pending' };
    if (cal.last_sync_status === 'error') return { text: `Sync failed: ${cal.last_sync_error || 'unknown error'}`, cls: 'error' };
    const d = new Date(cal.last_synced_at + 'Z');
    return { text: `Synced ${d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, cls: 'ok' };
  }

  async function updateCalendar(id, patch) {
    const res = await fetch(`/api/calendars/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    return res.json();
  }

  async function loadCalendars() {
    const res = await fetch('/api/calendars');
    const calendars = await res.json();
    const list = document.getElementById('calList');
    const emptyNote = document.getElementById('emptyNote');
    list.innerHTML = '';
    emptyNote.hidden = calendars.length > 0;

    calendars.forEach((cal) => renderCalendarCard(list, cal));
  }

  function renderCalendarCard(list, cal) {
    const card = document.createElement('div');
    card.className = 'cal-card';
    const status = statusLabel(cal);

    const row = document.createElement('div');
    row.className = 'cal-row';
    row.innerHTML = `
      <button type="button" class="cal-color-dot" style="background:${cal.color}" title="Change color"></button>
      <div class="cal-info">
        <div class="name">${escapeHtml(cal.name)}</div>
        <div class="url">${escapeHtml(cal.url)}</div>
        <div class="status ${status.cls}">${escapeHtml(status.text)}</div>
      </div>
      <div class="cal-actions">
        <button class="toggle ${cal.visible ? 'on' : ''}" title="Show on display" aria-label="Toggle visible"></button>
        <button class="customize-btn" type="button">Customize</button>
        <button class="danger" type="button">Remove</button>
      </div>
    `;
    card.appendChild(row);

    const panel = document.createElement('div');
    panel.className = 'cal-customize';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="customize-section">
        <div class="customize-label">Calendar color</div>
        <div class="picker-slot" data-role="calendar-color"></div>
      </div>
      <div class="customize-section">
        <div class="customize-label">Color by keyword
          <span class="hint">Overrides this calendar's color for any event whose title or description contains the keyword — handy for a shared calendar where different events belong to different people.</span>
        </div>
        <div class="rule-list"></div>
        <div class="add-rule-row">
          <input type="text" class="rule-keyword" placeholder="e.g. a name, like &quot;John&quot;" />
          <div class="picker-slot" data-role="rule-color"></div>
          <button type="button" class="add-rule-btn">Add</button>
        </div>
      </div>
    `;
    card.appendChild(panel);
    list.appendChild(card);

    // -- visibility toggle --
    row.querySelector('.toggle').addEventListener('click', async (e) => {
      const newVisible = !cal.visible;
      e.currentTarget.classList.toggle('on', newVisible);
      await updateCalendar(cal.id, { visible: newVisible });
      cal.visible = newVisible ? 1 : 0;
    });

    // -- remove --
    row.querySelector('.danger').addEventListener('click', async () => {
      if (!confirm(`Remove "${cal.name}"? This deletes its events from the display.`)) return;
      await fetch(`/api/calendars/${cal.id}`, { method: 'DELETE' });
      loadCalendars();
    });

    // -- customize expand/collapse --
    let builtPanel = false;
    row.querySelector('.customize-btn').addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !builtPanel) {
        buildCustomizePanel(panel, cal, row);
        builtPanel = true;
      }
    });

    // -- click the dot as a shortcut to open Customize --
    row.querySelector('.cal-color-dot').addEventListener('click', () => {
      row.querySelector('.customize-btn').click();
    });
  }

  function buildCustomizePanel(panel, cal, row) {
    // Calendar (base) color picker
    const colorSlot = panel.querySelector('[data-role="calendar-color"]');
    buildColorPicker(colorSlot, cal.color, async (hex) => {
      await updateCalendar(cal.id, { color: hex });
      cal.color = hex;
      row.querySelector('.cal-color-dot').style.background = hex;
    });

    // Existing rules list. cal.color_rules is the live source of truth —
    // kept current every time a rule is added or removed, unlike a local
    // snapshot would be (which would go stale after the first add and
    // silently overwrite earlier rules on every add after that).
    if (!Array.isArray(cal.color_rules)) cal.color_rules = [];
    renderRuleList(panel, cal, cal.color_rules);

    // Add-rule mini form
    let newRuleColor = PALETTE[1];
    const ruleColorSlot = panel.querySelector('[data-role="rule-color"]');
    buildColorPicker(ruleColorSlot, newRuleColor, (hex) => { newRuleColor = hex; });

    panel.querySelector('.add-rule-btn').addEventListener('click', async () => {
      const input = panel.querySelector('.rule-keyword');
      const keyword = input.value.trim();
      if (!keyword) { input.focus(); return; }
      const updated = [...cal.color_rules, { keyword, color: newRuleColor }];
      const saved = await updateCalendar(cal.id, { color_rules: updated });
      cal.color_rules = saved.color_rules || updated;
      input.value = '';
      renderRuleList(panel, cal, cal.color_rules);
    });
  }

  function renderRuleList(panel, cal, rules) {
    const wrap = panel.querySelector('.rule-list');
    wrap.innerHTML = '';
    if (rules.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rule-empty';
      empty.textContent = 'No keyword rules yet — every event uses the calendar color above.';
      wrap.appendChild(empty);
      return;
    }
    rules.forEach((rule, i) => {
      const item = document.createElement('div');
      item.className = 'rule-item';
      item.innerHTML = `
        <span class="rule-dot" style="background:${rule.color}"></span>
        <span class="rule-keyword-text">${escapeHtml(rule.keyword)}</span>
        <button type="button" class="rule-remove" title="Remove rule">✕</button>
      `;
      item.querySelector('.rule-remove').addEventListener('click', async () => {
        const updated = rules.filter((_, idx) => idx !== i);
        const saved = await updateCalendar(cal.id, { color_rules: updated });
        cal.color_rules = saved.color_rules || updated;
        renderRuleList(panel, cal, cal.color_rules);
      });
      wrap.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function wire() {
    document.querySelectorAll('.settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        document.querySelectorAll('.settings-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('tabCalendars').hidden = tab !== 'calendars';
        document.getElementById('tabPhotoFrame').hidden = tab !== 'photoframe';
        if (tab === 'photoframe') {
          // Deliberately not loaded until this tab is actually opened —
          // the photo grid can be a lot of images, and there's no reason
          // to fetch or render any of it while looking at Calendars.
          // Refetched fresh every time, so it reflects whatever changed
          // since the last visit (e.g. an upload from another device).
          loadTimingForm();
          loadPhotosGrid();
        }
      });
    });

    const addColorSlot = document.getElementById('colorPicker');
    buildColorPicker(addColorSlot, PALETTE[0], (hex) => { selectedColor = hex; });

    document.getElementById('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('calName').value.trim();
      const url = document.getElementById('calUrl').value.trim();
      const msg = document.getElementById('formMsg');
      msg.textContent = '';
      msg.className = 'form-msg';

      if (!/^(https?|webcal):\/\//i.test(url)) {
        msg.textContent = 'That link should start with https:// or webcal://';
        msg.classList.add('error');
        return;
      }

      const res = await fetch('/api/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, color: selectedColor })
      });
      if (res.ok) {
        msg.textContent = 'Added — syncing now.';
        msg.classList.add('ok');
        document.getElementById('addForm').reset();
        buildColorPicker(addColorSlot, PALETTE[0], (hex) => { selectedColor = hex; });
        selectedColor = PALETTE[0];
        loadCalendars();
        setTimeout(loadCalendars, 3000);
      } else {
        const body = await res.json().catch(() => ({}));
        msg.textContent = body.error || 'Could not add that calendar.';
        msg.classList.add('error');
      }
    });

    document.getElementById('syncAllBtn').addEventListener('click', async (e) => {
      e.target.textContent = 'Syncing…';
      e.target.disabled = true;
      await fetch('/api/sync', { method: 'POST' });
      await loadCalendars();
      e.target.textContent = 'Sync now';
      e.target.disabled = false;
    });

    document.getElementById('timingForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const idle = Number(document.getElementById('idleTimeoutInput').value);
      const interval = Number(document.getElementById('photoIntervalInput').value);
      const msg = document.getElementById('timingMsg');
      msg.textContent = '';
      msg.className = 'form-msg';

      if (!Number.isFinite(idle) || idle < 1 || idle > 180) {
        msg.textContent = 'Idle timeout should be between 1 and 180 minutes.';
        msg.classList.add('error');
        return;
      }
      if (!Number.isFinite(interval) || interval < 3 || interval > 600) {
        msg.textContent = 'Seconds per photo should be between 3 and 600.';
        msg.classList.add('error');
        return;
      }

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idle_timeout_minutes: idle, photo_interval_seconds: interval })
      });
      if (res.ok) {
        msg.textContent = 'Saved.';
        msg.classList.add('ok');
      } else {
        const body = await res.json().catch(() => ({}));
        msg.textContent = body.error || 'Could not save.';
        msg.classList.add('error');
      }
    });

    document.getElementById('timelineHoursForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const start = Number(document.getElementById('timelineStartInput').value);
      const end = Number(document.getElementById('timelineEndInput').value);
      const msg = document.getElementById('timelineHoursMsg');
      msg.textContent = '';
      msg.className = 'form-msg';

      if (!Number.isInteger(start) || start < 0 || start > 23) {
        msg.textContent = 'Start hour should be a whole number between 0 and 23.';
        msg.classList.add('error');
        return;
      }
      if (!Number.isInteger(end) || end < 1 || end > 24) {
        msg.textContent = 'End hour should be a whole number between 1 and 24.';
        msg.classList.add('error');
        return;
      }
      if (end <= start) {
        msg.textContent = 'End hour must be after the start hour.';
        msg.classList.add('error');
        return;
      }

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeline_start_hour: start, timeline_end_hour: end })
      });
      if (res.ok) {
        msg.textContent = 'Saved.';
        msg.classList.add('ok');
      } else {
        const body = await res.json().catch(() => ({}));
        msg.textContent = body.error || 'Could not save.';
        msg.classList.add('error');
      }
    });

    // -- photo upload --
    document.getElementById('photoUploadInput').addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const statusEl = document.getElementById('uploadStatus');
      statusEl.textContent = `Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`;
      statusEl.className = 'form-msg';

      const formData = new FormData();
      for (const f of files) formData.append('photos', f);

      try {
        const res = await fetch('/api/photos/upload', { method: 'POST', body: formData });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          const convertedNote = body.converted ? ` (converted ${body.converted} HEIC file${body.converted !== 1 ? 's' : ''})` : '';
          statusEl.textContent = `Uploaded ${body.uploaded} photo${body.uploaded !== 1 ? 's' : ''}${convertedNote}.`;
          statusEl.classList.add('ok');
          loadPhotosGrid();
        } else {
          statusEl.textContent = body.error || 'Upload failed.';
          statusEl.classList.add('error');
        }
      } catch (err) {
        statusEl.textContent = 'Upload failed — check your connection.';
        statusEl.classList.add('error');
      }
      e.target.value = ''; // reset so selecting the same file(s) again still triggers change
    });

    // -- delete all photos: three deliberate steps (reveal panel, check
    // the box, click the now-enabled confirm button) before anything is
    // actually deleted, per the requested friction against doing this
    // by accident. --
    document.getElementById('deleteAllPhotosBtn').addEventListener('click', () => {
      document.getElementById('deleteConfirmPanel').hidden = false;
      document.getElementById('deleteConfirmCheckbox').checked = false;
      document.getElementById('confirmDeleteBtn').disabled = true;
    });
    document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
      document.getElementById('deleteConfirmPanel').hidden = true;
    });
    document.getElementById('deleteConfirmCheckbox').addEventListener('change', (e) => {
      document.getElementById('confirmDeleteBtn').disabled = !e.target.checked;
    });
    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
      const btn = document.getElementById('confirmDeleteBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      await fetch('/api/photos', { method: 'DELETE' });
      document.getElementById('deleteConfirmPanel').hidden = true;
      btn.textContent = 'Yes, delete all photos';
      loadPhotosGrid();
    });
  }

  async function loadPhotosGrid() {
    const res = await fetch('/api/photos');
    const photos = await res.json();
    const grid = document.getElementById('photosGrid');
    grid.innerHTML = '';
    document.getElementById('deletePhotoCount').textContent = photos.length;
    document.getElementById('deleteAllPhotosBtn').disabled = photos.length === 0;

    if (photos.length === 0) {
      grid.innerHTML = '<div class="empty-note">No photos yet — upload some above.</div>';
      return;
    }
    photos.forEach((p) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      cell.innerHTML = `
        <img src="${p.url}" alt="${escapeHtml(p.file)}" loading="lazy" />
        <button type="button" class="photo-delete-btn" title="Delete this photo">✕</button>
      `;
      cell.querySelector('.photo-delete-btn').addEventListener('click', async () => {
        await fetch(`/api/photos/${encodeURIComponent(p.file)}`, { method: 'DELETE' });
        loadPhotosGrid();
      });
      grid.appendChild(cell);
    });
  }

  async function loadTimingForm() {
    const settings = await window.HomeportTheme.fetchAllSettings();
    document.getElementById('idleTimeoutInput').value = settings.idle_timeout_minutes ?? 10;
    document.getElementById('photoIntervalInput').value = settings.photo_interval_seconds ?? 20;
  }

  async function loadTimelineHoursForm() {
    const settings = await window.HomeportTheme.fetchAllSettings();
    document.getElementById('timelineStartInput').value = settings.timeline_start_hour ?? 4;
    document.getElementById('timelineEndInput').value = settings.timeline_end_hour ?? 23;
  }

  async function loadThemePicker() {
    const [themes, activeId] = await Promise.all([
      window.HomeportTheme.fetchThemes(),
      window.HomeportTheme.fetchActiveThemeId()
    ]);
    renderThemeDropdown(themes, activeId);
  }

  function themeSwatchDots(theme) {
    const c = theme.colors || {};
    return `<span class="dot-row"><span style="background:${c.bg || '#ccc'}"></span><span style="background:${c.surface || '#fff'}"></span><span style="background:${c.accent || '#888'}"></span></span>`;
  }

  function renderThemeDropdown(themes, activeId) {
    const dropdown = document.getElementById('themeDropdown');
    const trigger = document.getElementById('themeDropdownTrigger');
    const currentEl = document.getElementById('themeDropdownCurrent');
    const menu = document.getElementById('themeDropdownMenu');

    const active = themes.find((t) => t.id === activeId) || themes[0];
    if (active) {
      currentEl.innerHTML = `${themeSwatchDots(active)}<span>${active.emoji ? active.emoji + ' ' : ''}${escapeHtml(active.label || active.id)}</span>`;
    }

    menu.innerHTML = '';
    themes.forEach((theme) => {
      const isActive = theme.id === activeId;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'theme-option' + (isActive ? ' active' : '');
      row.innerHTML = `
        ${themeSwatchDots(theme)}
        <span class="theme-option-text">
          <span class="theme-option-label">${theme.emoji ? theme.emoji + ' ' : ''}${escapeHtml(theme.label || theme.id)}</span>
          <span class="theme-option-desc">${escapeHtml(theme.description || '')}</span>
        </span>
        ${isActive ? '<span class="theme-option-check">✓</span>' : ''}
      `;
      row.addEventListener('click', async () => {
        closeThemeDropdown();
        if (isActive) return;
        await window.HomeportTheme.setActiveTheme(theme.id);
        await window.HomeportTheme.applyActiveTheme(); // live-preview on this page
        renderThemeDropdown(themes, theme.id);
      });
      menu.appendChild(row);
    });

    // Wire the toggle/outside-click/Escape handling once — this function
    // re-runs on every selection (to refresh the checkmark), but these
    // listeners should only ever be attached a single time.
    if (!trigger.dataset.wired) {
      trigger.dataset.wired = '1';
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const opening = !dropdown.classList.contains('open');
        dropdown.classList.toggle('open', opening);
        menu.hidden = !opening;
      });
      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) closeThemeDropdown();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeThemeDropdown();
      });
    }
  }

  function closeThemeDropdown() {
    const dropdown = document.getElementById('themeDropdown');
    dropdown.classList.remove('open');
    document.getElementById('themeDropdownMenu').hidden = true;
  }

  async function loadVersion() {
    try {
      const res = await fetch('/api/version');
      const data = await res.json();
      document.getElementById('appVersion').textContent = `Homeport · v${data.version}`;
    } catch (e) { /* non-essential — leave the footer blank rather than error */ }
  }

  wire();
  window.HomeportTheme.applyActiveTheme();
  loadThemePicker();
  loadTimelineHoursForm();
  loadCalendars();
  loadVersion();
})();
