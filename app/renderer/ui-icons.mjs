// Decorative icons for navigation; visible labels remain the accessible names.
const paths = {
  settings: '<path d="M9.7 4.3 10.2 2h3.6l.5 2.3 1.7 1 2.2-.7 1.8 3.1-1.7 1.6v2l1.7 1.6-1.8 3.1-2.2-.7-1.7 1-.5 2.3h-3.6l-.5-2.3-1.7-1-2.2.7L4 13.9l1.7-1.6v-2L4 8.7l1.8-3.1 2.2.7z" transform="translate(0 1.5)"/><circle cx="12" cy="12" r="3"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  general: '<path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  lolping: '<path d="m5 3 14 9-7 1-3 7-4-17ZM16 3v3m3 1h3"/>',
  network: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  chat: '<path d="M7 19 3 21V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7Z"/><path d="M7 8h10M7 12h7"/>',
  voice: '<path d="M4 13v-2a8 8 0 0 1 16 0v2M20 17v1a3 3 0 0 1-3 3h-3"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/>',
  sharing: '<rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8m-4-4v4m0-14v7m-3-4 3-3 3 3"/>',
  picture: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  audio: '<path d="M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  capture: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
  relay: '<path d="M4 7h13m-3-3 3 3-3 3M20 17H7m3-3-3 3 3 3"/><circle cx="4" cy="17" r="2"/><circle cx="20" cy="7" r="2"/>',
  window: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M7 5.5h.01m3 0h.01"/>',
  screen: '<rect x="3" y="3" width="18" height="14" rx="3"/><path d="M8 21h8m-4-4v4"/>',
  obs: '<rect x="3" y="5" width="12" height="14" rx="3"/><path d="m15 10 6-4v12l-6-4"/>',
  members: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v3"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M16 6.5h2m-2 11h2"/>',
};

export function addButtonIcon(button, kind) {
  if (!paths[kind] || button.querySelector(':scope > .ui-icon')) return;
  button.insertAdjacentHTML('afterbegin', `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${kind === 'settings' ? '1.8' : '1.6'}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[kind]}</svg>`);
}
