/* Search-as-you-type member picker (combobox). Shared by the member,
   deposit, withdrawal and report forms so a big <select> never has to
   render thousands of options. Loupe → dropdown → selected chip. */
import { el, esc } from './util.js';
import { t } from './i18n.js';
import { statusTag } from './ui.js';

/**
 * @param {Array}  members  all member docs (sorted by ID inside)
 * @param {string} value    pre-selected member doc id (edit deep-links)
 * @param {string} placeholder
 * @param {Function} filter optional extra predicate (e.g. active-only)
 * @param {Function} onPick called with the member doc (or null on clear)
 * @param {string} name    form field name for the hidden memberDocId input
 */
export function memberPicker({ members = [], value = '', placeholder = '', filter = null, onPick = null, name = 'memberDocId' } = {}) {
  const list = (members || []).slice()
    .sort((a, b) => String(a.memberId || '').localeCompare(String(b.memberId || '')));

  const root = el('div', { class: 'mpick' });
  const hidden = el('input', { type: 'hidden', name, value: '' });
  const box = el('div', { class: 'mpick-box' });
  const input = el('input', {
    type: 'text', class: 'mpick-in', autocomplete: 'off', role: 'combobox',
    'aria-expanded': 'false', 'aria-autocomplete': 'list',
    placeholder: placeholder || t('নাম / ID / মোবাইল লিখুন…', 'Type name / ID / mobile…'),
  });
  const clearBtn = el('button', {
    type: 'button', class: 'mpick-x', hidden: true,
    'aria-label': t('মুছুন', 'Clear'), html: '&times;',
  });
  const drop = el('div', { class: 'mpick-drop', role: 'listbox', hidden: true });
  box.append(input, clearBtn);
  root.append(box, drop, hidden);

  let items = [];
  let hi = -1;
  let selected = null;

  const hay = m => [m.memberId, m.nameBn, m.nameEn, m.mobile, m.whatsapp]
    .map(x => String(x || '').toLowerCase()).join(' ');
  const applyFilter = q => {
    const query = String(q || '').trim().toLowerCase();
    items = list.filter(m => (!filter || filter(m)) && (!query || hay(m).includes(query))).slice(0, 8);
  };
  const paint = () => {
    drop.replaceChildren();
    if (!items.length) {
      drop.appendChild(el('div', { class: 'mpick-empty', text: t('কোনো সদস্য পাওয়া যায়নি', 'No members found') }));
      return;
    }
    items.forEach((m, i) => {
      const o = el('button', {
        type: 'button', role: 'option', class: 'mpick-opt' + (i === hi ? ' on' : ''),
        'aria-selected': i === hi ? 'true' : 'false',
      });
      o.innerHTML = `<span class="mo-t">${esc(m.nameBn || m.nameEn || '')}</span>`
        + `<span class="mo-s">${esc(m.memberId)} · ${esc(m.mobile || '')}</span>`;
      o.appendChild(el('span', { class: 'mo-tag', html: statusTag(m.status) }));
      o.addEventListener('click', () => choose(m));
      drop.appendChild(o);
    });
  };
  const open = () => { drop.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { drop.hidden = true; input.setAttribute('aria-expanded', 'false'); hi = -1; };
  const isOpen = () => !drop.hidden;

  function choose(m) {
    selected = m || null;
    hidden.value = m ? m.id : '';
    if (m) {
      input.value = `${m.memberId} — ${m.nameBn || m.nameEn || ''}`;
      input.readOnly = true;
      clearBtn.hidden = false;
    } else {
      input.value = '';
      input.readOnly = false;
      clearBtn.hidden = true;
    }
    close();
    if (onPick) onPick(selected);
  }

  input.addEventListener('input', () => {
    if (input.readOnly) return;
    applyFilter(input.value);
    hi = items.length ? 0 : -1;
    paint();
    open();
  });
  input.addEventListener('focus', () => {
    if (input.readOnly) return;
    applyFilter(input.value);
    hi = -1;
    paint();
    open();
  });
  input.addEventListener('keydown', e => {
    if (!isOpen()) {
      if (e.key === 'ArrowDown' && !input.readOnly) {
        applyFilter(input.value);
        hi = items.length ? 0 : -1;
        paint();
        open();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') { hi = items.length ? (hi + 1) % items.length : -1; paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hi = items.length ? (hi - 1 + items.length) % items.length : -1; paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (hi >= 0 && items[hi]) { choose(items[hi]); e.preventDefault(); } }
    else if (e.key === 'Escape') { close(); }
  });
  /* mousedown-first so option clicks land before blur closes the list */
  drop.addEventListener('mousedown', e => e.preventDefault());
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
  document.addEventListener('pointerdown', function h(e) {
    if (!root.isConnected) { document.removeEventListener('pointerdown', h); return; }
    if (!root.contains(e.target)) close();
  });
  clearBtn.addEventListener('click', () => { choose(null); input.focus(); });

  if (value) {
    const m = list.find(x => x.id === value);
    if (m) choose(m);
  }

  return {
    root, input, hidden,
    get value() { return hidden.value; },
    get member() { return selected; },
    set(id) { choose(list.find(x => x.id === id) || null); },
    focus() { input.focus(); },
  };
}
