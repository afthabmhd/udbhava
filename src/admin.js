(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const loginPanel = $('#login-panel');
  const dashboard = $('#dashboard');
  const tokenKey = 'udbhava-admin-token';
  let token = sessionStorage.getItem(tokenKey) || '';
  let eventRows = [];
  let page = 1;
  const pageSize = 50;
  let total = 0;

  function text(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value == null ? '' : String(value);
    if (className) node.className = className;
    return node;
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function setMode(mode) {
    const badge = $('#mode-badge');
    badge.hidden = !mode;
    badge.textContent = mode === 'test' ? 'TEST' : 'LIVE';
    badge.classList.toggle('is-test', mode === 'test');
  }

  function showDashboard() {
    loginPanel.hidden = true;
    dashboard.hidden = false;
    $('#logout-button').hidden = false;
  }

  function showLogin(message = '') {
    token = '';
    sessionStorage.removeItem(tokenKey);
    loginPanel.hidden = false;
    dashboard.hidden = true;
    $('#logout-button').hidden = true;
    $('#mode-badge').hidden = true;
    $('#login-error').textContent = message;
    $('#login-error').hidden = !message;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
    if (response.status === 401) {
      showLogin('Your session ended. Sign in again.');
      throw new Error('session_expired');
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'request_failed');
    return result;
  }

  function displayState(value) {
    return ({ 'spot-only': 'Spot only', 'not-open': 'N/A' })[value] || value || 'N/A';
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
  }

  function fillSelect(select, values, labelKey, valueKey) {
    const first = select.options[0];
    select.replaceChildren(first);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value[valueKey];
      option.textContent = value[labelKey];
      select.append(option);
    }
  }

  function renderEvents() {
    const body = $('#events-body');
    body.replaceChildren();
    const query = $('#event-search').value.trim().toLocaleLowerCase();
    const department = $('#event-department').value;
    const state = $('#event-state').value;
    const visible = eventRows.filter(event =>
      (!department || event.department_id === department) &&
      (!state || event.registration_state === state) &&
      (!query || `${event.name} ${event.slug}`.toLocaleLowerCase().includes(query))
    );
    if (!visible.length) {
      $('#events-message').textContent = 'No events match these filters.';
      return;
    }
    $('#events-message').textContent = `${visible.length} event${visible.length === 1 ? '' : 's'}`;
    for (const event of visible) {
      const row = document.createElement('tr');
      const eventCell = document.createElement('td');
      eventCell.append(text('span', event.name || 'Unnamed event', 'row-title'), text('span', event.slug, 'row-subtitle'));
      const departmentCell = text('td', String(event.department_id || '').toUpperCase());
      const stateCell = text('td', displayState(event.registration_state));
      const updatedCell = text('td', formatDate(event.updated_at));
      const actionCell = document.createElement('td');
      const edit = text('button', 'Edit', 'row-action');
      edit.type = 'button';
      edit.dataset.slug = event.slug;
      actionCell.append(edit);
      row.append(eventCell, departmentCell, stateCell, updatedCell, actionCell);
      body.append(row);
    }
  }

  async function loadEvents() {
    $('#events-message').textContent = 'Loading events…';
    try {
      const result = await api('/api/admin/events');
      eventRows = result.events || [];
      const departments = [...new Set(eventRows.map(event => event.department_id))].sort();
      fillSelect($('#event-department'), departments.map(value => ({ label: value.toUpperCase(), value })), 'label', 'value');
      fillSelect($('#registration-department'), departments.map(value => ({ label: value.toUpperCase(), value })), 'label', 'value');
      fillSelect($('#registration-event'), eventRows.map(event => ({ label: `${event.name} · ${event.department_id.toUpperCase()}`, value: event.slug })), 'label', 'value');
      renderEvents();
    } catch (error) {
      if (error.message !== 'session_expired') $('#events-message').textContent = 'Could not load events. Try refreshing.';
    }
  }

  function eventEditor(event) {
    const fields = [
      ['name', 'Name'], ['department_id', 'Department'], ['audience', 'Audience'],
      ['event_competition', 'Competition / type'], ['event_dates', 'Dates (comma separated)'],
      ['event_time', 'Time'], ['first_prize', 'First prize'], ['second_prize', 'Second prize'],
      ['third_prize', 'Third prize'], ['description', 'Description'], ['contact_numbers', 'Contact numbers'],
      ['registration_fee', 'Registration fee'], ['venue', 'Venue'],
    ];
    const form = document.createElement('form');
    form.className = 'event-edit-form';
    const slug = document.createElement('div');
    slug.className = 'slug-display wide';
    slug.textContent = `Slug (immutable): ${event.slug}`;
    form.append(slug);
    const controls = {};
    for (const [key, label] of fields) {
      const wrapper = document.createElement('label');
      if (['description', 'contact_numbers'].includes(key)) wrapper.className = 'wide';
      wrapper.append(text('span', label));
      const control = key === 'description' ? document.createElement('textarea') : document.createElement('input');
      control.name = key;
      control.value = key === 'event_dates' ? (event.event_dates || []).join(', ') : (event[key] ?? '');
      wrapper.append(control);
      form.append(wrapper);
      controls[key] = control;
    }
    const stateLabel = document.createElement('label');
    stateLabel.append(text('span', 'Registration state'));
    const state = document.createElement('select');
    state.name = 'registration_state';
    for (const [value, label] of [['open', 'Open'], ['closed', 'Closed'], ['spot-only', 'Spot only'], ['not-open', 'N/A']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; state.append(option);
    }
    state.value = event.registration_state;
    stateLabel.append(state); form.append(stateLabel); controls.registration_state = state;
    const dialog = $('#confirm-dialog');
    $('#dialog-title').textContent = 'Edit event';
    $('#dialog-copy').textContent = 'Review the event details. Changes go live only after confirmation.';
    $('#change-list').replaceChildren(form);
    $('#dialog-confirm').textContent = 'Review changes';
    $('#dialog-cancel').hidden = false;
    dialog.showModal();
    return new Promise(resolve => {
      const finish = confirm => {
        dialog.close();
        if (!confirm) { resolve(null); return; }
        const updated = {};
        for (const [key, control] of Object.entries(controls)) {
          let value = control.value.trim();
          if (key === 'event_dates') value = value ? value.split(',').map(part => part.trim()) : null;
          if (key === 'registration_state') value = control.value;
          const oldValue = event[key];
          const oldComparable = key === 'event_dates' ? (oldValue || []).join(', ') : (oldValue ?? '');
          const newComparable = key === 'event_dates' ? (value || []).join(', ') : (value ?? '');
          if (oldComparable !== newComparable) updated[key] = value;
        }
        resolve(updated);
      };
      $('#dialog-cancel').onclick = () => finish(false);
      $('#dialog-confirm').onclick = () => finish(true);
      dialog.oncancel = () => resolve(null);
    });
  }

  function confirmChanges(title, copy, changes) {
    const dialog = $('#confirm-dialog');
    $('#dialog-title').textContent = title;
    $('#dialog-copy').textContent = copy;
    $('#dialog-confirm').textContent = 'Confirm';
    $('#dialog-cancel').hidden = false;
    const list = $('#change-list');
    list.replaceChildren();
    for (const [label, before, after] of changes) {
      const item = document.createElement('div'); item.className = 'change-item';
      item.append(text('strong', label), text('span', `${before} → ${after}`));
      list.append(item);
    }
    dialog.showModal();
    return new Promise(resolve => {
      $('#dialog-cancel').onclick = () => { dialog.close(); resolve(false); };
      $('#dialog-confirm').onclick = () => { dialog.close(); resolve(true); };
      dialog.oncancel = () => resolve(false);
    });
  }

  const eventLabels = {
    name: 'Name', department_id: 'Department', audience: 'Audience', event_competition: 'Competition / type',
    event_dates: 'Dates', event_time: 'Time', first_prize: 'First prize', second_prize: 'Second prize',
    third_prize: 'Third prize', description: 'Description', contact_numbers: 'Contact numbers',
    registration_fee: 'Registration fee', venue: 'Venue', registration_state: 'Registration state'
  };

  async function editEvent(slug) {
    const event = eventRows.find(row => row.slug === slug);
    if (!event) return;
    const changed = await eventEditor(event);
    if (!changed || !Object.keys(changed).length) return;
    const display = value => Array.isArray(value) ? value.join(', ') : displayState(value);
    const confirmed = await confirmChanges('Confirm event changes', 'Only these changed fields will be saved.', Object.entries(changed).map(([key, value]) => [eventLabels[key] || key, display(event[key]), display(value)]));
    if (!confirmed) return;
    try {
      await api(`/api/admin/events/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(changed) });
      showToast('Live on website');
      await loadEvents();
    } catch (error) {
      if (error.message !== 'session_expired') $('#events-message').textContent = 'Could not save this event. Check the values and try again.';
    }
  }

  function renderSummary(summary) {
    setMode(summary.mode);
    const cards = $('#summary-cards');
    cards.replaceChildren();
    const statuses = summary.statuses || {};
    for (const [label, value] of [['Total', summary.total || 0], ['Pending', statuses.pending || 0], ['Confirmed', statuses.confirmed || 0], ['Rejected', statuses.rejected || 0]]) {
      const card = document.createElement('div'); card.className = 'summary-card';
      card.append(text('span', label), text('strong', value)); cards.append(card);
    }
  }

  async function loadSummary() {
    try { renderSummary(await api('/api/admin/summary')); }
    catch (error) { if (error.message !== 'session_expired') $('#registrations-message').textContent = 'Could not load registration summary.'; }
  }

  function renderRegistrations(rows) {
    const body = $('#registrations-body'); body.replaceChildren();
    if (!rows.length) { $('#registrations-message').textContent = 'No registrations match these filters.'; return; }
    $('#registrations-message').textContent = `${total} registration${total === 1 ? '' : 's'} found.`;
    for (const registration of rows) {
      const row = document.createElement('tr');
      const participant = document.createElement('td'); participant.append(text('span', registration.name, 'row-title'), text('span', registration.college || '—', 'row-subtitle'));
      row.append(participant, text('td', registration.event_slug), text('td', String(registration.department_id || '').toUpperCase()), text('td', registration.phone), text('td', registration.college_reg_no || '—'), text('td', registration.upi_txn_id || '—'), text('td', formatDate(registration.submitted_at)));
      const statusCell = document.createElement('td'); const select = document.createElement('select'); select.className = 'status-select'; select.dataset.id = registration.id;
      for (const value of ['pending', 'confirmed', 'rejected']) { const option = document.createElement('option'); option.value = value; option.textContent = value[0].toUpperCase() + value.slice(1); select.append(option); }
      select.value = registration.status; statusCell.append(select); row.append(statusCell); body.append(row);
    }
  }

  function filterQuery() {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    for (const [key, selector] of [['event', '#registration-event'], ['department', '#registration-department'], ['status', '#registration-status'], ['q', '#registration-search']]) {
      const value = $(selector).value.trim(); if (value) params.set(key, value);
    }
    return params.toString();
  }

  async function loadRegistrations() {
    $('#registrations-message').textContent = 'Loading registrations…';
    try {
      const result = await api(`/api/admin/registrations?${filterQuery()}`);
      total = result.total || 0; setMode(result.mode); renderRegistrations(result.rows || []);
      $('#page-label').textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / pageSize))}`;
      $('#page-prev').disabled = page <= 1;
      $('#page-next').disabled = page * pageSize >= total;
    } catch (error) { if (error.message !== 'session_expired') $('#registrations-message').textContent = 'Could not load registrations. Try again.'; }
  }

  async function updateStatus(id, status, select) {
    try {
      await api(`/api/admin/registrations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      showToast('Payment status updated');
      await Promise.all([loadRegistrations(), loadSummary()]);
    } catch (error) {
      if (error.message !== 'session_expired') { select.value = select.dataset.previous; $('#registrations-message').textContent = 'Could not update payment status.'; }
    }
  }

  async function exportCsv() {
    try {
      const response = await fetch(`/api/admin/registrations.csv?${filterQuery()}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (response.status === 401) { showLogin('Your session ended. Sign in again.'); return; }
      if (!response.ok) throw new Error('export_failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'registrations.csv'; link.click(); URL.revokeObjectURL(url);
    } catch { $('#registrations-message').textContent = 'Could not export registrations.'; }
  }

  async function activateTab(name) {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('is-active', button.dataset.tab === name));
    $('#events-panel').hidden = name !== 'events'; $('#registrations-panel').hidden = name !== 'registrations';
    if (name === 'events') await loadEvents(); else { await loadSummary(); await loadRegistrations(); }
  }

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = $('#login-error'); error.hidden = true;
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), password: form.get('password') }), cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Sign-in failed. Check your account and try again.');
      token = result.access_token; sessionStorage.setItem(tokenKey, token); showDashboard(); await activateTab('events');
    } catch (error) { $('#login-error').textContent = error.message || 'Sign-in failed. Try again.'; $('#login-error').hidden = false; }
  });
  const recoveryForm = $('#recovery-form');
  const recoveryEmail = recoveryForm.elements.email;
  $('#recovery-toggle').addEventListener('click', () => {
    recoveryForm.querySelector('button[type="submit"]').hidden = false;
    recoveryEmail.value = $('#login-form').elements.email.value.trim();
    $('#login-form').hidden = true;
    $('#login-error').hidden = true;
    $('#recovery-toggle').hidden = true;
    $('#recovery-message').hidden = true;
    $('#recovery-error').hidden = true;
    recoveryForm.hidden = false;
    recoveryEmail.focus();
  });
  $('#recovery-cancel').addEventListener('click', () => {
    recoveryForm.hidden = true;
    recoveryForm.querySelector('button[type="submit"]').hidden = false;
    $('#login-form').hidden = false;
    $('#recovery-toggle').hidden = false;
    $('#recovery-message').hidden = true;
    $('#recovery-error').hidden = true;
  });
  recoveryForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = recoveryForm.querySelector('button[type="submit"]');
    const message = $('#recovery-message');
    const error = $('#recovery-error');
    submit.disabled = true;
    message.hidden = true;
    error.hidden = true;
    try {
      const response = await fetch('/api/admin/recover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail.value.trim() }), cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 429) throw new Error('Too many reset emails were requested. Please wait before trying again.');
      if (!response.ok) throw new Error('Could not send a password link right now. Try again later.');
      message.textContent = 'If this is an organizer account, a password link has been sent. Check the inbox and spam folder.';
      message.hidden = false;
      recoveryForm.querySelector('button[type="submit"]').hidden = true;
    } catch (requestError) {
      error.textContent = requestError.message || 'Could not send a password link right now. Try again later.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  $('#logout-button').addEventListener('click', () => showLogin());
  document.querySelectorAll('.admin-tab').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  $('#events-body').addEventListener('click', event => { const button = event.target.closest('button[data-slug]'); if (button) editEvent(button.dataset.slug); });
  $('#event-search').addEventListener('input', renderEvents);
  $('#event-department').addEventListener('change', renderEvents);
  $('#event-state').addEventListener('change', renderEvents);
  $('#events-refresh').addEventListener('click', loadEvents);
  $('#registrations-refresh').addEventListener('click', () => { loadSummary(); loadRegistrations(); });
  ['#registration-event', '#registration-department', '#registration-status'].forEach(selector => $(selector).addEventListener('change', () => { page = 1; loadRegistrations(); }));
  let searchTimer;
  $('#registration-search').addEventListener('input', () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { page = 1; loadRegistrations(); }, 250); });
  $('#registrations-body').addEventListener('focusin', event => { if (event.target.matches('.status-select')) event.target.dataset.previous = event.target.value; });
  $('#registrations-body').addEventListener('change', async event => {
    const select = event.target;
    if (!select.matches('.status-select')) return;
    const previous = select.dataset.previous || 'pending';
    if (select.value === 'rejected') {
      const yes = await confirmChanges('Reject registration?', 'This changes only its payment status.', [['Status', previous, 'rejected']]);
      if (!yes) { select.value = previous; return; }
    }
    await updateStatus(select.dataset.id, select.value, select);
  });
  $('#page-prev').addEventListener('click', () => { if (page > 1) { page -= 1; loadRegistrations(); } });
  $('#page-next').addEventListener('click', () => { if (page * pageSize < total) { page += 1; loadRegistrations(); } });
  $('#export-button').addEventListener('click', exportCsv);
  $('#dialog-cancel').addEventListener('click', event => { event.preventDefault(); $('#confirm-dialog').close(); });

  if (token) { showDashboard(); activateTab('events'); } else showLogin();
})();
