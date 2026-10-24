(() => {
  'use strict';

  const page = document.querySelector('.events-page');
  if (!page) return;

  const departmentTabs = document.getElementById('department-tabs');
  const categoryFilter = document.getElementById('category-filter');
  const resultsSummary = document.getElementById('results-summary');
  const eventGrid = document.getElementById('event-grid');
  const eventSearch = document.getElementById('event-search');
  const dialog = document.getElementById('event-detail-dialog');
  const dialogClose = dialog.querySelector('.dialog-close');
  const menuButton = page.querySelector('.menu-toggle');
  const mobileMenu = page.querySelector('.mobile-nav');
  const departmentPresentation = {
    udbhava: { code: 'UDBHAVA', accent: '#bd79ff' },
    cse: { code: 'CSE', accent: '#bd79ff', logo: 'techranti' },
    ece: { code: 'ECE', accent: '#8b8dff', logo: 'technova' },
    eee: { code: 'EEE', accent: '#bd65ff', logo: 'dyuthi' },
    mech: { code: 'MECH', accent: '#aa7bff', logo: 'yantra' },
    civil: { code: 'CIVIL', accent: '#9f83ff', logo: 'arcvil' },
    ads: { code: 'ADS', accent: '#8a8fff', logo: 'sankalpa' }
  };
  const departmentOrder = ['udbhava', 'cse', 'ece', 'eee', 'mech', 'civil', 'ads'];
  const registrationLabels = { closed: 'Registration closed', 'not-open': 'Registration unavailable', 'spot-only': 'Spot registration only', open: 'Register' };
  const networkArt = '<svg viewBox="0 0 340 200" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m170 43-72 39 4 54 67 35 72-39-2-53-69-36Z" stroke="currentColor" stroke-width="2"/><path d="m98 82 71 39 72-42m-69-36v78m-66 15 66-39 69 14m-67 25v35" stroke="currentColor"/><circle cx="170" cy="43" r="5" fill="#080610" stroke="currentColor" stroke-width="2"/><circle cx="98" cy="82" r="5" fill="#080610" stroke="currentColor" stroke-width="2"/><circle cx="241" cy="81" r="5" fill="#080610" stroke="currentColor" stroke-width="2"/><circle cx="102" cy="136" r="5" fill="#080610" stroke="currentColor" stroke-width="2"/><circle cx="241" cy="132" r="5" fill="#080610" stroke="currentColor" stroke-width="2"/><circle cx="169" cy="171" r="5" fill="#080610" stroke="currentColor" stroke-width="2"/></svg>';

  let events = [];
  let departments = [];
  let selectedDepartment = 'all';
  const eventTypes = ['workshops', 'lectures', 'shows', 'competitions'];
  let selectedCompetition = new URLSearchParams(window.location.search).get('category') || 'all';
  if (!eventTypes.includes(selectedCompetition)) selectedCompetition = 'all';
  let searchQuery = '';
  let searchTimer = 0;
  let returnFocus = null;

  function getDepartment(id) {
    return id === 'all' ? null : departments.find(department => department.id === id);
  }

  function formatFee(value) {
    if (!value) return 'Not available';
    const fee = String(value).trim();
    if (/^(free\b|nil\b)/i.test(fee) || fee.startsWith('₹')) return fee;
    return /^\d/.test(fee) ? `₹${fee}` : fee;
  }

  function formatEventDates(event) {
    const dates = Array.isArray(event.event_dates) ? event.event_dates : [];
    return [...dates, event.event_time].filter(Boolean).join(' · ');
  }

  function eventPrizes(event) {
    return [event.first_prize, event.second_prize, event.third_prize].filter(Boolean);
  }

  function eventType(event) {
    const text = `${event.name} ${event.event_competition || ''}`.toLocaleLowerCase();
    if (/workshop|hands-on session/.test(text)) return 'workshops';
    if (/lecture|webinar|talk|keynote|expert session/.test(text)) return 'lectures';
    if (/\bshow\b|concert|performance|stunt|paattoholic|dj night|music show/.test(text)) return 'shows';
    return 'competitions';
  }

  function renderDepartments() {
    const present = new Set(events.map(event => event.department_id));
    departments = [...present].sort((left, right) => {
      const leftOrder = departmentOrder.indexOf(left);
      const rightOrder = departmentOrder.indexOf(right);
      return (leftOrder < 0 ? departmentOrder.length : leftOrder) - (rightOrder < 0 ? departmentOrder.length : rightOrder);
    }).map(id => ({ id, ...(departmentPresentation[id] || { code: id.toUpperCase(), accent: '#b173ff' }) }));
    if (selectedDepartment !== 'all' && !departments.some(department => department.id === selectedDepartment)) selectedDepartment = 'all';

    departmentTabs.replaceChildren();
    for (const department of departments) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'department-tab';
      button.dataset.department = department.id;
      button.style.setProperty('--dept-accent', department.accent);
      button.setAttribute('aria-pressed', String(department.id === selectedDepartment));
      button.setAttribute('aria-label', `Show ${department.code} events`);
      if (department.logo) {
        const logo = document.createElement('img');
        logo.className = 'department-tab__logo';
        logo.src = `./src/assets/logos/${department.logo}.png`;
        logo.alt = '';
        logo.draggable = false;
        button.append(logo);
      }
      const label = document.createElement('span');
      label.textContent = department.code;
      button.append(label);
      departmentTabs.append(button);
    }
    categoryFilter.disabled = false;
  }

  function activeEvents() {
    const query = searchQuery.trim().toLocaleLowerCase();
    return events.filter(event => selectedDepartment === 'all' || event.department_id === selectedDepartment)
      .filter(event => selectedCompetition === 'all' || eventType(event) === selectedCompetition)
      .filter(event => !query || [event.name, event.department_id, event.event_competition, event.registration_fee, event.description, event.venue, event.audience].join(' ').toLocaleLowerCase().includes(query))
      .sort((left, right) => Number(right.department_id === 'udbhava') - Number(left.department_id === 'udbhava'));
  }

  function createEventCard(event) {
    const card = document.createElement('article');
    card.className = 'event-card';
    card.dataset.event = event.slug;
    card.style.setProperty('--event-accent', departmentPresentation[event.department_id]?.accent || '#b173ff');

    const detailsButton = document.createElement('button');
    detailsButton.type = 'button';
    detailsButton.className = 'event-card__details';
    detailsButton.dataset.eventDetails = '';
    detailsButton.setAttribute('aria-label', `View ${event.name} details`);

    const top = document.createElement('span');
    top.className = 'event-card__topline';
    if (String(event.audience || '').trim().toLocaleLowerCase() === 'school students') {
      const audience = document.createElement('span');
      audience.className = 'event-badge event-badge--audience';
      audience.textContent = 'For School Students';
      top.append(audience);
    }
    const department = document.createElement('span');
    department.className = 'event-department';
    department.textContent = getDepartment(event.department_id)?.code || event.department_id.toUpperCase();
    top.append(department);

    const imageFrame = document.createElement('span');
    imageFrame.className = 'event-card__image-frame';
    imageFrame.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.className = 'event-card__image';
    const imageSlug = ['ece-robo-soccer', 'ads-robo-soccer-5kg'].includes(event.slug) ? 'ads-robo-soccer' : event.slug;
    image.src = `./src/assets/events/${imageSlug}.webp`;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('load', () => imageFrame.classList.add('is-loaded'), { once: true });
    imageFrame.append(image);
    const fallback = document.createElement('span');
    fallback.className = 'event-art';
    fallback.innerHTML = networkArt;
    imageFrame.append(fallback);

    const copy = document.createElement('span');
    copy.className = 'event-copy';
    const name = document.createElement('span');
    name.className = 'event-name';
    name.textContent = event.name;
    copy.append(name);

    const metadata = document.createElement('span');
    metadata.className = 'event-card__metadata';
    const appendInfoRow = (label, value, icon, className = '') => {
      const row = document.createElement('span');
      row.className = `event-card__info-row${className ? ` ${className}` : ''}`;
      const symbol = document.createElement('span');
      symbol.className = 'event-card__info-icon';
      symbol.setAttribute('aria-hidden', 'true');
      symbol.innerHTML = icon;
      const content = document.createElement('span');
      content.className = 'event-card__info-content';
      const heading = document.createElement('span');
      heading.className = 'event-card__info-label';
      heading.textContent = label;
      const detail = document.createElement('span');
      detail.className = 'event-card__info-value';
      detail.textContent = value;
      content.append(heading, detail);
      row.append(symbol, content);
      metadata.append(row);
    };
    appendInfoRow('Fee', formatFee(event.registration_fee), '<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="5" rx="7.5" ry="3"/><path d="M4.5 5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5M4.5 10v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5M4.5 15v4c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-4"/></svg>');
    const prizes = eventPrizes(event);
    if (prizes.length) appendInfoRow('Prizes', prizes.join(' · '), '<svg viewBox="0 0 24 24" fill="none"><path d="m12 2 2.3 6.7L21 11l-6.7 2.3L12 20l-2.3-6.7L3 11l6.7-2.3L12 2Z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/></svg>', 'event-card__info-row--prize');
    const dateText = formatEventDates(event);
    if (dateText) appendInfoRow('Date & Time', dateText, '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01"/></svg>');
    const registration = document.createElement(event.registration_state === 'open' ? 'a' : 'button');
    if (registration instanceof HTMLButtonElement) registration.type = 'button';
    registration.className = 'event-card__register';
    registration.dataset.eventRegister = '';
    registration.dataset.registrationState = event.registration_state;
    registration.textContent = event.slug === 'ads-robot-expo'
      ? 'No registration required'
      : event.registration_state === 'open' && event.department_id === 'udbhava'
      ? 'Spot Registration'
      : registrationLabels[event.registration_state] || 'Registration status unavailable';
    if (event.registration_state === 'open') {
      registration.href = `/register/${encodeURIComponent(event.slug)}`;
      registration.setAttribute('aria-label', `Register for ${event.name}`);
    } else registration.disabled = true;

    detailsButton.append(top, imageFrame, copy, metadata);
    card.append(detailsButton, registration);
    return card;
  }

  function renderEvents() {
    const list = activeEvents();
    resultsSummary.textContent = `${list.length} ${list.length === 1 ? 'EVENT' : 'EVENTS'} FOUND`;
    eventGrid.replaceChildren();
    eventGrid.setAttribute('aria-busy', 'false');
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = searchQuery ? `No events match “${searchQuery}”. Try another search or change the filters.` : 'No events match this event type.';
      eventGrid.append(empty);
      return;
    }
    eventGrid.append(...list.map(createEventCard));
  }

  function openDetails(event, trigger) {
    returnFocus = trigger;
    const department = getDepartment(event.department_id);
    const kicker = document.getElementById('dialog-kicker');
    kicker.textContent = `${department?.code || event.department_id.toUpperCase()} / ${event.event_competition || 'EVENT'}`;
    document.getElementById('dialog-title').textContent = event.name;
    const subtitle = document.getElementById('dialog-subtitle');
    subtitle.textContent = formatEventDates(event);
    subtitle.hidden = !subtitle.textContent;
    document.getElementById('dialog-tagline').hidden = true;
    const description = document.getElementById('dialog-description');
    description.textContent = event.description || '';
    description.hidden = !description.textContent;
    const facts = document.getElementById('dialog-facts');
    facts.replaceChildren();
    const addFact = (label, value) => {
      if (!value) return;
      const fact = document.createElement('div');
      fact.className = 'dialog-fact';
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      fact.append(term, description);
      facts.append(fact);
    };
    addFact('DEPARTMENT', department?.code || event.department_id.toUpperCase());
    addFact('EVENT', event.event_competition);
    addFact('FEE', formatFee(event.registration_fee));
    addFact('VENUE', event.venue);
    addFact('CONTACT', event.contact_numbers);
    if (event.slug === 'ads-robot-expo') addFact('REGISTRATION', 'No registration required. The exhibition is open to festival participants and visitors.');
    else if (event.registration_state === 'spot-only') addFact('REGISTRATION', 'Spot registration only. Online registration is closed; register and pay at the event spot.');
    else if (event.department_id === 'udbhava') addFact('REGISTRATION', 'Spot registration. Any fee is collected at the registration spot.');
    else if (eventType(event) === 'competitions') addFact('REGISTRATION', 'Online and spot registration available.');
    const prizesSection = document.getElementById('dialog-prizes-section');
    const prizesList = document.getElementById('dialog-prizes');
    prizesList.replaceChildren(...eventPrizes(event).map(prize => {
      const item = document.createElement('li');
      item.textContent = prize;
      return item;
    }));
    prizesSection.hidden = prizesList.childElementCount === 0;
    document.getElementById('dialog-rules-section').hidden = true;
    const registration = document.getElementById('dialog-registration');
    const registerButton = document.getElementById('dialog-register-button');
    registration.textContent = event.slug === 'ads-robot-expo'
      ? 'No registration is required to visit this exhibition.'
      : event.registration_state === 'spot-only'
      ? 'Spot registration only. Online registration is closed; register at the event spot.'
      : event.department_id === 'udbhava' && event.registration_state === 'open'
      ? 'Spot registration is available. Any fee is collected at the registration spot.'
      : event.registration_state === 'open'
      ? 'Registration is open. Complete the form to reserve your place.'
      : event.registration_state === 'closed'
        ? 'Registration is closed for this event.'
        : 'Registration is unavailable for this event.';
    const canRegister = event.registration_state === 'open';
    registerButton.hidden = !canRegister;
    if (canRegister) registerButton.href = `/register/${encodeURIComponent(event.slug)}`;
    if (!dialog.open) dialog.showModal();
    dialogClose.focus();
  }

  function setLoading(message) {
    eventGrid.setAttribute('aria-busy', 'true');
    eventGrid.replaceChildren();
    const status = document.createElement('p');
    status.className = 'loading-state';
    status.setAttribute('role', 'status');
    status.textContent = message;
    eventGrid.append(status);
    departmentTabs.replaceChildren();
    const departmentStatus = document.createElement('p');
    departmentStatus.className = 'loading-state';
    departmentStatus.setAttribute('role', 'status');
    departmentStatus.textContent = message;
    departmentTabs.append(departmentStatus);
  }

  async function loadEvents() {
    setLoading('Loading events from the festival server…');
    categoryFilter.disabled = true;
    try {
      const response = await fetch('/api/events', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load events (${response.status}).`);
      const payload = await response.json();
      if (!Array.isArray(payload.events) || payload.events.some(event => !event.slug || !event.name || !event.department_id)) {
        throw new Error('The server returned an invalid event list.');
      }
      events = payload.events;
      categoryFilter.replaceChildren(
        new Option('All event types', 'all'),
        new Option('Workshops', 'workshops'),
        new Option('Lectures', 'lectures'),
        new Option('Shows', 'shows'),
        new Option('Competitions', 'competitions')
      );
      categoryFilter.value = selectedCompetition;
      renderDepartments();
      renderEvents();
    } catch (error) {
      console.error('Events data could not be loaded:', error);
      categoryFilter.disabled = true;
      departmentTabs.replaceChildren();
      const errorMessage = document.createElement('p');
      errorMessage.className = 'error-state';
      errorMessage.setAttribute('role', 'alert');
      errorMessage.append(document.createTextNode('The event list could not be loaded. Confirm the Udbhava server is running.'));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.dataset.retry = 'true';
      retry.textContent = 'TRY AGAIN';
      errorMessage.append(retry);
      eventGrid.replaceChildren(errorMessage);
      eventGrid.setAttribute('aria-busy', 'false');
    }
  }

  departmentTabs.addEventListener('click', event => {
    const button = event.target.closest('[data-department]');
    if (!button) return;
    selectedDepartment = selectedDepartment === button.dataset.department ? 'all' : button.dataset.department;
    for (const tab of departmentTabs.querySelectorAll('[data-department]')) tab.setAttribute('aria-pressed', String(tab.dataset.department === selectedDepartment));
    renderEvents();
  });
  categoryFilter.addEventListener('change', () => {
    selectedCompetition = categoryFilter.value;
    renderEvents();
  });
  eventSearch.addEventListener('input', () => {
    searchQuery = eventSearch.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderEvents, 150);
  });
  eventGrid.addEventListener('click', event => {
    if (event.target.closest('[data-retry]')) {
      loadEvents();
      return;
    }
    const detailsButton = event.target.closest('[data-event-details]');
    const trigger = detailsButton;
    if (!trigger) return;
    const selected = events.find(item => item.slug === trigger.closest('[data-event]')?.dataset.event);
    if (selected) openDetails(selected, trigger);
  });
  dialogClose.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected) returnFocus.focus();
  });

  function setMenuOpen(open) {
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    mobileMenu.classList.toggle('open', open);
    mobileMenu.inert = !open;
  }
  menuButton.addEventListener('click', () => setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true'));
  mobileMenu.addEventListener('click', event => {
    if (event.target.closest('a')) setMenuOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') setMenuOpen(false);
  });
  loadEvents();
})();
