(() => {
  'use strict';

  const mount = document.getElementById('registration-form-mount');
  const shell = document.querySelector('.registration-shell');
  const loading = document.getElementById('registration-loading');
  const eventPanel = document.getElementById('registration-event');
  const statePanel = document.getElementById('registration-state');
  const errorPanel = document.getElementById('registration-error');
  const successPanel = document.getElementById('registration-success');
  const menuButton = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('.mobile-nav');
  const departmentNames = { cse: 'CSE', ads: 'ADS', mech: 'MECH', civil: 'CIVIL', eee: 'EEE', ece: 'ECE' };
  const QR_CONFIG = {
    cse: ['/src/UPI/CSE 1.png', '/src/UPI/CSE 2.png'],
    ads: ['/src/UPI/ADS 1.png', '/src/UPI/ADS 2.png'],
    mech: ['/src/UPI/MECH 1.png', '/src/UPI/MECH 2.png'],
    civil: ['/src/UPI/Civil 1.png', '/src/UPI/Civil 2.png'],
    eee: ['/src/UPI/EEE 1.png', '/src/UPI/EEE 2.png'],
    ece: ['/src/UPI/ECE 1.png', '/src/UPI/ECE 2.png']
  };

  const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) || '');
  let currentEvent = null;

  function formatAmount(amount) {
    if (amount === null || amount === undefined || amount === '') return 'Fee to be announced';
    const value = Number(amount);
    if (!Number.isFinite(value)) return 'Fee to be announced';
    if (value === 0) return 'Free';
    return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}`;
  }

  function feeCaption(event) {
    return formatAmount(event.price_inr);
  }

  function formatPrizePool(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    const amount = Number(value);
    return `₹${Number.isFinite(amount) ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount) : String(value).trim()}`;
  }

  function setPageError(message) {
    loading.hidden = true;
    eventPanel.hidden = true;
    errorPanel.hidden = false;
    errorPanel.textContent = message;
    shell.setAttribute('aria-busy', 'false');
  }

  function addMissingQrFile(path) {
    const missingSection = document.getElementById('qr-missing-list');
    missingSection.hidden = false;
    const item = document.createElement('li');
    item.textContent = path.replace(/^\//, '');
    document.getElementById('qr-missing-items').append(item);
  }

  function appendQrFigure(grid, label, path) {
    const figure = document.createElement('figure');
    figure.className = 'payment-qr';
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    if (path) {
      const image = document.createElement('img');
      image.src = path;
      image.alt = `${label} payment QR code`;
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'payment-qr__placeholder';
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', `${label} is not supplied yet`);
        placeholder.textContent = 'QR image not supplied';
        image.replaceWith(placeholder);
        addMissingQrFile(path);
      }, { once: true });
      figure.append(caption, image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'payment-qr__placeholder';
      placeholder.setAttribute('role', 'img');
      placeholder.setAttribute('aria-label', `${label} is not supplied yet`);
      placeholder.textContent = 'QR image not supplied';
      figure.append(caption, placeholder);
    }
    grid.append(figure);
  }

  function renderPayment(event) {
    const [primary, backup] = QR_CONFIG[event.department_id] || [null, null];
    const section = document.createElement('section');
    section.className = 'payment-section';
    section.setAttribute('aria-labelledby', 'payment-heading');
    const amount = document.createElement('h3');
    amount.className = 'payment-amount';
    amount.id = 'payment-heading';
    const exactAmount = formatAmount(event.price_inr);
    amount.textContent = exactAmount === 'Fee to be announced' ? 'Payment amount to be announced' : `Pay exactly ${exactAmount}`;
    section.append(amount);
    const grid = document.createElement('div');
    grid.className = 'payment-qr-grid';
    appendQrFigure(grid, 'Scan to pay', primary);
    appendQrFigure(grid, "Backup QR (use if the first doesn't work)", backup);
    section.append(grid);
    return section;
  }

  function field(form, { key, label, type = 'text', autocomplete, inputmode, hint, placeholder, required = true }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'registration-field';
    const inputId = `registration-${key}`;
    const labelNode = document.createElement('label');
    labelNode.htmlFor = inputId;
    labelNode.textContent = label;
    const input = document.createElement('input');
    input.id = inputId;
    input.name = key;
    input.type = type;
    input.autocomplete = autocomplete || 'off';
    input.required = required;
    if (inputmode) input.inputMode = inputmode;
    if (placeholder) input.placeholder = placeholder;
    const hintNode = document.createElement('p');
    hintNode.className = 'field-hint';
    hintNode.id = `${inputId}-hint`;
    hintNode.textContent = hint || '';
    const errorNode = document.createElement('p');
    errorNode.className = 'field-error';
    errorNode.id = `${inputId}-error`;
    errorNode.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', [hint ? hintNode.id : '', errorNode.id].filter(Boolean).join(' '));
    wrapper.append(labelNode, input);
    if (hint) wrapper.append(hintNode);
    wrapper.append(errorNode);
    form.append(wrapper);
    return { input, errorNode };
  }

  function normalizePhone(value) {
    return value.replace(/^\+91/, '').replace(/^0/, '');
  }

  function validateClient(values, fieldNodes, event) {
    const errors = {};
    const controls = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
    const name = values.name;
    if (name.length < 2 || name.length > 80 || controls.test(name) || !/[\p{L}]/u.test(name) || !/^[\p{L} .'-]+$/u.test(name)) {
      errors.name = 'Enter a name using letters and basic punctuation (2–80 characters).';
    }
    if (values.college.length < 2 || values.college.length > 120 || controls.test(values.college)) {
      errors.college = 'Enter your college name (2–120 characters).';
    }
    const phone = normalizePhone(values.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
    values.phone = phone;
    if (values.college_reg_no.length < 3 || values.college_reg_no.length > 30 || !/^[A-Za-z0-9/_-]+$/.test(values.college_reg_no)) {
      errors.college_reg_no = 'Use 3–30 letters, numbers, hyphens, slashes or underscores.';
    }
    if (event.registration_mode === 'paid_online' && !/^\d{12}$/.test(values.upi_txn_id)) {
      errors.upi_txn_id = 'Enter the 12-digit UPI reference number.';
    }
    for (const [key, controlsForField] of Object.entries(fieldNodes)) {
      const message = errors[key] || '';
      controlsForField.input.setAttribute('aria-invalid', String(Boolean(message)));
      controlsForField.errorNode.textContent = message;
    }
    return Object.keys(errors).length === 0;
  }

  function showRegistrationState(event) {
    if (event.registration_state === 'closed') {
      statePanel.textContent = 'Registration closed';
      statePanel.hidden = false;
      return true;
    }
    if (event.registration_state !== 'open') {
      statePanel.textContent = 'Registration opens soon';
      statePanel.hidden = false;
      return true;
    }
    if (event.registration_mode === 'on_spot') {
      statePanel.textContent = 'Registration at the venue';
      statePanel.hidden = false;
      return true;
    }
    return false;
  }

  function showSuccess() {
    mount.replaceChildren();
    document.getElementById('qr-missing-list').hidden = true;
    document.getElementById('success-title').textContent = 'Registration submitted';
    document.getElementById('success-copy').textContent = currentEvent.registration_mode === 'paid_online'
      ? `Registration submitted for ${currentEvent.name}. The team will verify your payment.`
      : `Registration submitted for ${currentEvent.name}. The team will review your registration.`;
    successPanel.hidden = false;
    successPanel.focus();
  }

  function formErrorForCode(code) {
    return ({
      registration_closed: 'Registration is closed for this event.',
      registration_not_open: 'Registration opens soon. Check back for updates.',
      registration_at_venue: 'Registration is at the event venue.',
      registration_conflict: 'This registration could not be completed. Check the details or contact the event team.',
      try_again_later: 'Too many attempts. Please wait a moment and try again.',
      request_too_large: 'The registration could not be submitted. Check the form and try again.',
      request_rejected: 'The registration could not be submitted. Reload this page and try again.'
    })[code] || 'The registration could not be submitted. Check your details and try again.';
  }

  function renderForm(event) {
    const form = document.createElement('form');
    form.className = 'registration-form';
    form.noValidate = true;
    const heading = document.createElement('h3');
    heading.textContent = event.fee_basis === 'per_team' ? 'TEAM LEADER DETAILS' : 'PARTICIPANT DETAILS';
    form.append(heading);

    const honeypot = document.createElement('div');
    honeypot.className = 'honeypot';
    honeypot.setAttribute('aria-hidden', 'true');
    const trapLabel = document.createElement('label');
    trapLabel.htmlFor = 'registration-website';
    trapLabel.textContent = 'Leave this field empty';
    const trapInput = document.createElement('input');
    trapInput.id = 'registration-website';
    trapInput.name = 'website';
    trapInput.type = 'text';
    trapInput.tabIndex = -1;
    trapInput.autocomplete = 'off';
    honeypot.append(trapLabel, trapInput);
    form.append(honeypot);

    const fieldNodes = {};
    fieldNodes.name = field(form, { key: 'name', label: 'Name', autocomplete: 'name', placeholder: 'Your full name' });
    fieldNodes.college = field(form, { key: 'college', label: 'College', autocomplete: 'organization', placeholder: 'Your college name' });
    fieldNodes.phone = field(form, { key: 'phone', label: 'Phone No.', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '10-digit Indian mobile number' });
    fieldNodes.college_reg_no = field(form, { key: 'college_reg_no', label: 'College Registration No.', autocomplete: 'off', placeholder: 'Your college registration number' });

    if (event.registration_mode === 'paid_online') {
      form.append(renderPayment(event));
      fieldNodes.upi_txn_id = field(form, {
        key: 'upi_txn_id', label: 'UPI Transaction ID', autocomplete: 'off', inputmode: 'numeric',
        placeholder: '12-digit reference number',
        hint: '12-digit UPI reference number (also called UTR or transaction ID) from your payment app'
      });
    }

    const submitRow = document.createElement('div');
    submitRow.className = 'registration-submit-row';
    const submit = document.createElement('button');
    submit.className = 'registration-button';
    submit.type = 'submit';
    submit.textContent = 'SUBMIT REGISTRATION';
    const note = document.createElement('p');
    note.textContent = event.fee_basis === 'per_team'
      ? 'Submit once for the team as its leader.'
      : 'Submit one registration per participant.';
    submitRow.append(submit, note);
    form.append(submitRow);

    form.addEventListener('submit', async submitEvent => {
      submitEvent.preventDefault();
      errorPanel.hidden = true;
      errorPanel.textContent = '';
      const values = Object.fromEntries(Object.entries(fieldNodes).map(([key, item]) => [key, item.input.value.trim()]));
      if (!validateClient(values, fieldNodes, event)) {
        Object.values(fieldNodes).find(item => item.input.getAttribute('aria-invalid') === 'true')?.input.focus();
        return;
      }
      const payload = { slug: event.slug, ...values, website: trapInput.value };
      submit.disabled = true;
      submit.textContent = 'SUBMITTING…';
      try {
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          for (const [key, message] of Object.entries(result.field_errors || {})) {
            if (fieldNodes[key]) {
              fieldNodes[key].input.setAttribute('aria-invalid', 'true');
              fieldNodes[key].errorNode.textContent = message;
            }
          }
          errorPanel.textContent = formErrorForCode(result.error);
          errorPanel.hidden = false;
          submit.disabled = false;
          submit.textContent = 'SUBMIT REGISTRATION';
          return;
        }
        showSuccess();
      } catch {
        errorPanel.textContent = 'The registration could not be submitted. Check your connection and try again.';
        errorPanel.hidden = false;
        submit.disabled = false;
        submit.textContent = 'SUBMIT REGISTRATION';
      }
    });
    mount.append(form);
  }

  async function loadRegistration() {
    try {
      const response = await fetch('/api/events', { cache: 'no-store' });
      if (!response.ok) throw new Error('Event list unavailable');
      const payload = await response.json();
      currentEvent = payload.events.find(event => event.slug === slug);
      if (!currentEvent) {
        setPageError('This event link is not available.');
        document.title = 'Not Found — UDBHAVA ’26';
        return;
      }
      document.title = `Register for ${currentEvent.name} — UDBHAVA ’26`;
      document.getElementById('event-name').textContent = currentEvent.name;
      document.getElementById('registration-department').textContent = `${departmentNames[currentEvent.department_id] || currentEvent.department_id.toUpperCase()} / EVENT REGISTRATION`;
      const fee = document.getElementById('event-fee');
      fee.replaceChildren();
      fee.append(document.createTextNode(feeCaption(currentEvent)));
      if (currentEvent.fee_basis === 'per_team' || currentEvent.fee_basis === 'per_person') {
        const basis = document.createElement('small');
        basis.textContent = currentEvent.fee_basis === 'per_team' ? 'PER TEAM' : 'PER PERSON';
        fee.append(basis);
      }
      const prizePool = formatPrizePool(currentEvent.prize_pool);
      const prize = document.getElementById('event-prize');
      prize.hidden = !prizePool;
      prize.textContent = prizePool ? `PRIZE POOL ${prizePool}` : '';
      if (!showRegistrationState(currentEvent)) renderForm(currentEvent);
      loading.hidden = true;
      eventPanel.hidden = false;
      shell.setAttribute('aria-busy', 'false');
    } catch {
      setPageError('Event registration is temporarily unavailable. Please try again later.');
    }
  }

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
  loadRegistration();
})();
