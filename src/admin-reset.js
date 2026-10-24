(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const form = $('#reset-form');
  const message = $('#reset-message');
  const error = $('#reset-error');
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  let accessToken = fragment.get('access_token') || '';
  const recoveryError = fragment.get('error_description') || fragment.get('error') || query.get('error_description') || query.get('error');
  const isRecovery = fragment.get('type') === 'recovery' && accessToken;

  // Recovery tokens must not remain in the address bar or browsing history.
  window.history.replaceState(null, '', window.location.pathname);

  if (isRecovery) {
    form.hidden = false;
  } else {
    error.textContent = recoveryError
      ? 'This password link is invalid or expired. Request a new one from admin sign in.'
      : 'Open the password link from your email on this device. If it expired, request a new one from admin sign in.';
    error.hidden = false;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = form.elements.password.value;
    const confirmation = form.elements['confirm-password'].value;
    message.hidden = true;
    error.hidden = true;

    if (password !== confirmation) {
      error.textContent = 'The passwords do not match.';
      error.hidden = false;
      return;
    }
    if (Array.from(password).length < 12 || Array.from(password).length > 72) {
      error.textContent = 'Use a password between 12 and 72 characters.';
      error.hidden = false;
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken, password }),
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('This password link is invalid or expired. Request a new one from admin sign in.');
      if (response.status === 400) throw new Error('Supabase did not accept that password. Choose a different password and try again.');
      if (!response.ok) throw new Error('Could not save the password right now. Try again later.');

      accessToken = '';
      form.reset();
      form.hidden = true;
      message.textContent = 'Password saved. You can now sign in to the admin dashboard.';
      message.hidden = false;
    } catch (requestError) {
      error.textContent = requestError.message || 'Could not save the password right now. Try again later.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
})();
