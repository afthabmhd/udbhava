(() => {
  'use strict';

  const params = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const isRecovery = params.get('type') === 'recovery' || query.has('error_code');
  if (!isRecovery) return;

  window.location.replace(`/admin/reset-password${window.location.search}${window.location.hash}`);
})();
