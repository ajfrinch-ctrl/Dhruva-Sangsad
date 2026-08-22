/* Inline SVG icon set (stroke-based, consistent 24x24 grid) */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21h14V9.8"/><path d="M9.5 21v-6h5v6"/>',
  member: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  members: '<circle cx="9" cy="8" r="3.2"/><path d="M2.6 19.5a6.4 6.4 0 0 1 12.8 0"/><path d="M16.5 5.4a3.2 3.2 0 0 1 0 6.2"/><path d="M17.4 14.2a6.4 6.4 0 0 1 4 5.3"/>',
  register: '<path d="M15 20.5H4.5V3.5H19v6"/><path d="M8 8h7M8 12h5"/><circle cx="17.5" cy="16.5" r="4"/><path d="M17.5 14.8v3.4M15.8 16.5h3.4"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
  deposit: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.2 4.5v4h4"/><path d="M12 7.6V12l3 1.8"/>',
  report: '<path d="M6.5 3.5h7l4.5 4.5v12h-11.5z"/><path d="M13.5 3.5V8H18"/><path d="M9 12h6M9 15.5h6"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="12" width="3" height="5"/><rect x="12.5" y="8.5" width="3" height="8.5"/><rect x="17" y="5.5" width="3" height="11.5"/>',
  due: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 9.5v4.2M12 16.6h.01"/>',
  advance: '<path d="M12 20V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>',
  withdraw: '<path d="M12 4v11"/><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/><path d="M5 21h14"/>',
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 4.2 1.4 5.7 1.4 5.7H4.6S6 13.7 6 9.5Z"/><path d="M10 18.6a2.2 2.2 0 0 0 4 0"/>',
  log: '<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  approve: '<circle cx="12" cy="12" r="8.6"/><path d="m8.4 12.2 2.5 2.5 4.7-5"/>',
  reject: '<circle cx="12" cy="12" r="8.6"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4.2h5v2.3"/><path d="M6.5 6.5 7.6 20h8.8l1.1-13.5"/><path d="M10.4 10v6M13.6 10v6"/>',
  save: '<path d="M5 4.5h11L19.5 8v11.5H5z"/><path d="M8.5 4.5v5h7v-5"/><rect x="8" y="13" width="8" height="6.5"/>',
  clear: '<path d="M3.5 12.5 11 5a2.2 2.2 0 0 1 3.1 0l4.4 4.4a2.2 2.2 0 0 1 0 3.1L13 18"/><path d="M7 9 15 17"/><path d="M8.5 20h12"/>',
  pdf: '<path d="M6.5 3.5h7l4.5 4.5v12H6.5z"/><path d="M13.5 3.5V8H18"/><path d="M9 16.5v-4h1.4a1.3 1.3 0 0 1 0 2.6H9"/><path d="M13.5 16.5v-4h1a2 2 0 0 1 0 4z"/>',
  excel: '<path d="M6.5 3.5h7l4.5 4.5v12H6.5z"/><path d="M13.5 3.5V8H18"/><path d="m9.5 12.5 4 5M13.5 12.5l-4 5"/>',
  csv: '<path d="M6.5 3.5h7l4.5 4.5v12H6.5z"/><path d="M13.5 3.5V8H18"/><path d="M11.5 13a2.3 2.3 0 1 0 0 4"/>',
  whatsapp: '<path d="M3.8 20.2 5 16.4a7.7 7.7 0 1 1 3 2.9z"/><path d="M9.3 9.2c-.2 1.2.5 2.6 1.6 3.6s2.5 1.6 3.6 1.4l.7-1.4-1.9-1-.8.8a5 5 0 0 1-1.6-1.6l.8-.8-1-1.9z"/>',
  admin: '<path d="M12 3.2 4.8 6v6c0 4.3 3 7.7 7.2 8.8 4.2-1.1 7.2-4.5 7.2-8.8V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  maker: '<circle cx="12" cy="7.6" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17.5 4.5 20 6.2l-2.5 1.7"/>',
  settings: '<circle cx="12" cy="12" r="2.9"/><path d="M19.2 14.2a1.5 1.5 0 0 0 .3 1.6l.1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.5 1.5 0 0 0-2.5 1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.5-1l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.5 1.5 0 0 0-1-2.5h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1-2.5l-.1-.1A1.8 1.8 0 1 1 8.2 4.7l.1.1a1.5 1.5 0 0 0 2.5-1v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.5 1l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.5 1.5 0 0 0 1 2.5h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.3.9z"/>',
  backup: '<path d="M12 3.5v10"/><path d="m8 10 4 4 4-4"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  restore: '<path d="M12 20.5v-10"/><path d="m8 14 4-4 4 4"/><path d="M4.5 8.5v-3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/>',
  sync: '<path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5"/><path d="M4 12.5a8 8 0 0 0 13.7 5.2L20 15.5"/><path d="M4 4.5v4h4M20 19.5v-4h-4"/>',
  online: '<path d="M2.5 9.5a13 13 0 0 1 19 0"/><path d="M6 13a8 8 0 0 1 12 0"/><path d="M9.4 16.4a3.6 3.6 0 0 1 5.2 0"/><circle cx="12" cy="19.6" r="1" class="i-fill"/>',
  offline: '<path d="M2.5 9.5a13 13 0 0 1 5.3-3.2"/><path d="M16.2 6.4a13 13 0 0 1 5.3 3.1"/><path d="M6 13a8 8 0 0 1 3.2-2"/><path d="M14.9 11a8 8 0 0 1 3.1 2"/><circle cx="12" cy="19.6" r="1" class="i-fill"/><path d="m3.5 3.5 17 17"/>',
  logout: '<path d="M14.5 4.5h-8v15h8"/><path d="M11 12h9.5"/><path d="m17.5 8.5 3.5 3.5-3.5 3.5"/>',
  login: '<path d="M9.5 4.5h8v15h-8"/><path d="M13 12H3.5"/><path d="M7 8.5 3.5 12 7 15.5"/>',
  money: '<path d="M12 3.5v17"/><path d="M16 7.2a3.7 3.7 0 0 0-3.4-1.9h-1a3 3 0 0 0-.5 6l2.6.5a3 3 0 0 1-.5 6h-1A3.7 3.7 0 0 1 8 15.8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3.2v3.5M16 3.2v3.5"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6 18 18M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2M12 7.9h.01"/>',
  warn: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 9.5v4.2M12 16.6h.01"/>',
  filter: '<path d="M3.5 5h17l-6.6 7.8v5.4l-3.8 2v-7.4z"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  key: '<circle cx="8" cy="14" r="4.2"/><path d="m11.2 11 8.3-8.3M16.5 5.5l2.2 2.2M14.2 7.8l2.2 2.2"/>',
  file: '<path d="M6.5 3.5h7l4.5 4.5v12H6.5z"/><path d="M13.5 3.5V8H18"/><path d="M9 12.5h6M9 16h4"/>',
  upload: '<path d="M12 16.5v-11"/><path d="m7.5 9.5 4.5-4 4.5 4"/><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  pending: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.5V12l3 1.8"/>',
  phone: '<path d="M7.4 3.8 9.6 8 8 10a11 11 0 0 0 6 6l2-1.6 4.2 2.2v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 3 6a2 2 0 0 1 2-2.2z"/>',
  dashboard: '<rect x="3.5" y="3.5" width="7" height="7.5" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5"/><rect x="3.5" y="14" width="7" height="6.5" rx="1.5"/><rect x="13.5" y="11" width="7" height="9.5" rx="1.5"/>',
};

export function icon(name, cls = '') {
  const d = P[name] || P.info;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
}
export function iconEl(name, cls = '') {
  const span = document.createElement('span');
  span.innerHTML = icon(name, cls);
  return span.firstElementChild;
}
export const ICONS = P;
