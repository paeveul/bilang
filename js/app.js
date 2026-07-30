// js/app.js
//
// Main SPA controller for Bilang (MVP-1). Single-page app: one
// index.html, several <section data-screen="..."> panels shown/hidden by
// this file. No framework, no build step — vanilla ES modules, loaded
// directly by the browser (index.html loads this with type="module").
//
// Router: if the URL matches /s/<id>, this is a payer opening a shared
// link — fetch the split read-only and render it. Otherwise this is the
// bill creator's flow, starting at the "landing" screen.
//
// State lives only in memory (the `state` object below) until the creator
// hits "Create the split" — nothing is persisted before that point, per the
// product's core privacy design constraint (roadmap E1/§1).

import { computeTotals, formatRM } from './totals.js';
import { parseReceipt, createSplit, getSplit } from './api-client.js';

/** @type {{
 *   receiptImageBase64: string|null,
 *   receiptMimeType: string|null,
 *   parsed: null | {items: Array<object>, subtotal:number, service_charge:number, tax:number, grand_total:number},
 *   payers: string[],
 *   assignments: Object<string, string[]>,
 *   ownerPaymentHandle: string,
 * }}
 */
const state = {
  receiptImageBase64: null,
  receiptMimeType: null,
  parsed: null,
  payers: ['Me'],
  assignments: {},
  ownerPaymentHandle: '',
};

let itemIdCounter = 0;
function nextItemId() {
  itemIdCounter += 1;
  return `item-${itemIdCounter}`;
}

// ---------------------------------------------------------------------------
// Screen management
// ---------------------------------------------------------------------------

function showScreen(name) {
  document.querySelectorAll('.app-screen').forEach((el) => {
    el.classList.add('hidden');
  });
  const target = document.querySelector(`[data-screen="${name}"]`);
  if (target) target.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  showScreen('error');
}

// ---------------------------------------------------------------------------
// Router — decide payer view vs creator flow on load
// ---------------------------------------------------------------------------

async function initRouter() {
  const match = window.location.pathname.match(/^\/s\/([A-Za-z0-9]+)\/?$/);
  if (match) {
    await renderPayerView(match[1]);
    return;
  }
  showScreen('landing');
}

// ---------------------------------------------------------------------------
// Screen: landing
// ---------------------------------------------------------------------------

function bindLanding() {
  const checkbox = document.getElementById('consent-checkbox');
  const startBtn = document.getElementById('start-btn');

  checkbox.addEventListener('change', () => {
    startBtn.disabled = !checkbox.checked;
  });

  document.getElementById('privacy-link').addEventListener('click', () => {
    document.getElementById('privacy-panel').classList.remove('hidden');
  });
  document.getElementById('tos-link').addEventListener('click', () => {
    document.getElementById('tos-panel').classList.remove('hidden');
  });
  document.querySelectorAll('.close-legal-panel').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.target.closest('[id$="-panel"]').classList.add('hidden');
    });
  });

  startBtn.addEventListener('click', () => {
    if (!checkbox.checked) return;
    showScreen('capture');
  });
}

// ---------------------------------------------------------------------------
// Screen: capture
// ---------------------------------------------------------------------------

function bindCapture() {
  const input = document.getElementById('receipt-input');
  const previewWrap = document.getElementById('capture-preview-wrap');
  const preview = document.getElementById('capture-preview');

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    preview.src = dataUrl;
    previewWrap.classList.remove('hidden');

    const [meta, base64] = dataUrl.split(',');
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    state.receiptMimeType = mimeMatch ? mimeMatch[1] : file.type || 'image/jpeg';
    state.receiptImageBase64 = base64;

    await runParse();
  });

  document.getElementById('back-to-landing-btn').addEventListener('click', () => {
    showScreen('landing');
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function runParse() {
  showScreen('parsing');
  try {
    const parsed = await parseReceipt(state.receiptImageBase64, state.receiptMimeType);
    // Assign a stable client-side id to every item so review/assign screens
    // can key off something other than array index (index breaks once items
    // are added/removed/reordered during the review step).
    parsed.items = (parsed.items || []).map((item) => ({ id: nextItemId(), ...item }));
    state.parsed = parsed;
    renderReviewScreen();
    showScreen('review');
  } catch (err) {
    console.error(err);
    showError(err.message || 'Could not read this receipt.');
  } finally {
    // The receipt image has done its one job — drop it from memory now.
    // (The image was never sent anywhere except the single /api/parse call;
    // this just stops the app itself from holding onto it any longer.)
    state.receiptImageBase64 = null;
  }
}

// ---------------------------------------------------------------------------
// Screen: review (item review/correct step — non-negotiable per the roadmap)
// ---------------------------------------------------------------------------

function renderReviewScreen() {
  const container = document.getElementById('review-items');
  container.innerHTML = '';

  state.parsed.items.forEach((item) => {
    container.appendChild(buildReviewItemRow(item));
  });

  document.getElementById('field-subtotal').value = state.parsed.subtotal ?? '';
  document.getElementById('field-service').value = state.parsed.service_charge ?? '';
  document.getElementById('field-tax').value = state.parsed.tax ?? '';
  document.getElementById('field-grand-total').value = state.parsed.grand_total ?? '';

  document.getElementById('review-error').classList.add('hidden');
}

function buildReviewItemRow(item) {
  const row = document.createElement('div');
  row.className = 'assign-item-row space-y-2';
  row.dataset.itemId = item.id;

  row.innerHTML = `
    <div class="flex gap-2">
      <input type="text" class="item-name flex-1 text-sm" value="${escapeAttr(item.name)}" placeholder="Item name" />
      <select class="item-category text-sm rounded-md border-slate-300">
        ${['food', 'drink', 'tax', 'service', 'other']
          .map((c) => `<option value="${c}" ${c === item.category ? 'selected' : ''}>${c}</option>`)
          .join('')}
      </select>
    </div>
    <div class="grid grid-cols-3 gap-2 text-sm">
      <label class="space-y-1">
        <span class="text-xs text-slate-500">Qty</span>
        <input type="number" step="1" min="0" class="item-qty w-full" value="${item.qty ?? 1}" />
      </label>
      <label class="space-y-1">
        <span class="text-xs text-slate-500">Unit price</span>
        <input type="number" step="0.01" min="0" class="item-unit-price w-full" value="${item.unit_price ?? 0}" />
      </label>
      <label class="space-y-1">
        <span class="text-xs text-slate-500">Line total</span>
        <input type="number" step="0.01" min="0" class="item-line-total w-full" value="${item.line_total ?? 0}" />
      </label>
    </div>
    <button type="button" class="remove-item-btn text-xs text-red-500">Remove item</button>
  `;

  row.querySelector('.remove-item-btn').addEventListener('click', () => {
    state.parsed.items = state.parsed.items.filter((i) => i.id !== item.id);
    delete state.assignments[item.id];
    row.remove();
  });

  return row;
}

function collectReviewedItems() {
  const rows = document.querySelectorAll('#review-items .assign-item-row');
  const items = [];
  rows.forEach((row) => {
    const id = row.dataset.itemId;
    items.push({
      id,
      name: row.querySelector('.item-name').value.trim(),
      category: row.querySelector('.item-category').value,
      qty: Number(row.querySelector('.item-qty').value) || 0,
      unit_price: Number(row.querySelector('.item-unit-price').value) || 0,
      line_total: Number(row.querySelector('.item-line-total').value) || 0,
    });
  });
  return items;
}

function bindReview() {
  document.getElementById('add-item-btn').addEventListener('click', () => {
    const newItem = { id: nextItemId(), name: '', category: 'food', qty: 1, unit_price: 0, line_total: 0 };
    state.parsed.items.push(newItem);
    document.getElementById('review-items').appendChild(buildReviewItemRow(newItem));
  });

  document.getElementById('confirm-items-btn').addEventListener('click', () => {
    const items = collectReviewedItems();
    if (items.length === 0 || items.some((i) => !i.name)) {
      const errEl = document.getElementById('review-error');
      errEl.textContent = 'Every item needs a name, and there must be at least one item.';
      errEl.classList.remove('hidden');
      return;
    }

    state.parsed.items = items;
    state.parsed.subtotal = Number(document.getElementById('field-subtotal').value) || 0;
    state.parsed.service_charge = Number(document.getElementById('field-service').value) || 0;
    state.parsed.tax = Number(document.getElementById('field-tax').value) || 0;
    state.parsed.grand_total = Number(document.getElementById('field-grand-total').value) || 0;

    renderAssignScreen();
    showScreen('assign');
  });

  document.getElementById('back-to-capture-btn').addEventListener('click', () => {
    showScreen('capture');
  });
}

// ---------------------------------------------------------------------------
// Screen: assign
// ---------------------------------------------------------------------------

function renderAssignScreen() {
  renderPayerChips();
  renderAssignItems();
  updateLiveTotals();
}

function renderPayerChips() {
  const wrap = document.getElementById('payer-chips');
  wrap.innerHTML = '';
  state.payers.forEach((name) => {
    const chip = document.createElement('span');
    chip.className = 'payer-chip';
    chip.innerHTML = `${escapeHtml(name)} <button type="button" aria-label="Remove ${escapeAttr(name)}">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      if (state.payers.length <= 1) return; // always keep at least one payer
      state.payers = state.payers.filter((p) => p !== name);
      Object.keys(state.assignments).forEach((itemId) => {
        state.assignments[itemId] = (state.assignments[itemId] || []).filter((p) => p !== name);
      });
      renderAssignScreen();
    });
    wrap.appendChild(chip);
  });
}

function renderAssignItems() {
  const container = document.getElementById('assign-items');
  container.innerHTML = '';

  state.parsed.items.forEach((item) => {
    if (!state.assignments[item.id]) {
      // Default: assign every new item to everyone currently listed.
      state.assignments[item.id] = [...state.payers];
    }

    const row = document.createElement('div');
    row.className = 'assign-item-row';
    row.innerHTML = `
      <div class="flex justify-between text-sm font-medium mb-2">
        <span>${escapeHtml(item.name)}</span>
        <span>${formatRM(item.line_total)}</span>
      </div>
      <div class="flex flex-wrap gap-3 text-sm assign-checkboxes"></div>
    `;

    const checkboxWrap = row.querySelector('.assign-checkboxes');
    state.payers.forEach((name) => {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-1';
      const checked = state.assignments[item.id].includes(name);
      label.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /> <span>${escapeHtml(name)}</span>`;
      label.querySelector('input').addEventListener('change', (e) => {
        const list = state.assignments[item.id];
        if (e.target.checked) {
          if (!list.includes(name)) list.push(name);
        } else {
          state.assignments[item.id] = list.filter((p) => p !== name);
        }
        updateLiveTotals();
      });
      checkboxWrap.appendChild(label);
    });

    container.appendChild(row);
  });
}

function updateLiveTotals() {
  const { perPerson } = computeTotals(state.parsed.items, state.assignments, state.parsed, state.payers);
  const wrap = document.getElementById('assign-live-totals');
  wrap.innerHTML = state.payers
    .map((name) => `<div class="flex justify-between"><span>${escapeHtml(name)}</span><span class="font-semibold">${formatRM(perPerson[name].totalCents / 100)}</span></div>`)
    .join('');
}

function bindAssign() {
  document.getElementById('add-payer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('add-payer-input');
    const name = input.value.trim();
    if (!name) return;
    if (state.payers.includes(name)) {
      input.value = '';
      return;
    }
    state.payers.push(name);
    input.value = '';
    renderAssignScreen();
  });

  document.getElementById('confirm-assign-btn').addEventListener('click', () => {
    const unassigned = state.parsed.items.filter((item) => (state.assignments[item.id] || []).length === 0);
    if (unassigned.length > 0) {
      const errEl = document.getElementById('assign-error');
      errEl.textContent = `${unassigned.length} item(s) have no one assigned to them. Tick at least one payer per item.`;
      errEl.classList.remove('hidden');
      return;
    }
    document.getElementById('assign-error').classList.add('hidden');
    showScreen('payment');
  });

  document.getElementById('back-to-review-btn').addEventListener('click', () => {
    showScreen('review');
  });
}

// ---------------------------------------------------------------------------
// Screen: payment (bill owner's payment handle — display-only, never validated)
// ---------------------------------------------------------------------------

function bindPayment() {
  document.getElementById('create-split-btn').addEventListener('click', async () => {
    const handle = document.getElementById('field-payment-handle').value.trim();
    if (!handle) {
      const errEl = document.getElementById('payment-error');
      errEl.textContent = 'Enter how people should pay you before continuing.';
      errEl.classList.remove('hidden');
      return;
    }
    document.getElementById('payment-error').classList.add('hidden');
    state.ownerPaymentHandle = handle;
    await submitSplit();
  });

  document.getElementById('back-to-assign-btn').addEventListener('click', () => {
    showScreen('assign');
  });
}

async function submitSplit() {
  showScreen('creating');

  const { perPerson } = computeTotals(state.parsed.items, state.assignments, state.parsed, state.payers);
  const totalsPayload = {
    subtotal: state.parsed.subtotal,
    service_charge: state.parsed.service_charge,
    tax: state.parsed.tax,
    grand_total: state.parsed.grand_total,
    per_person: Object.fromEntries(
      Object.entries(perPerson).map(([name, p]) => [name, Math.round(p.totalCents) / 100])
    ),
  };

  try {
    const { url } = await createSplit({
      items: state.parsed.items,
      assignments: state.assignments,
      totals: totalsPayload,
      ownerPaymentHandle: state.ownerPaymentHandle,
    });
    renderShareScreen(url);
    showScreen('share');
  } catch (err) {
    console.error(err);
    showError(err.message || 'Could not create this split.');
  }
}

// ---------------------------------------------------------------------------
// Screen: share
// ---------------------------------------------------------------------------

function renderShareScreen(relativeUrl) {
  const fullUrl = `${window.location.origin}${relativeUrl}`;

  document.getElementById('share-url-field').value = fullUrl;
  document.getElementById('whatsapp-share-btn').href =
    `https://wa.me/?text=${encodeURIComponent(`Here's the bill split: ${fullUrl}`)}`;

  const qrContainer = document.getElementById('share-qr');
  qrContainer.innerHTML = '';
  try {
    // Vendored qrcode.js global — see js/vendor/qrcode.js (MIT, Kazuhiko Arase).
    // Type 0 = auto-detect smallest version for the data length.
    const qr = window.qrcode(0, 'M');
    qr.addData(fullUrl);
    qr.make();
    qrContainer.innerHTML = qr.createSvgTag(4);
  } catch (err) {
    console.error('QR render failed:', err);
    qrContainer.textContent = '(QR code unavailable — use the link above)';
  }
}

function bindShare() {
  document.getElementById('copy-link-btn').addEventListener('click', async () => {
    const field = document.getElementById('share-url-field');
    field.select();
    try {
      await navigator.clipboard.writeText(field.value);
      const btn = document.getElementById('copy-link-btn');
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    } catch (err) {
      // Clipboard API can fail on non-HTTPS/insecure contexts — the field is
      // already selected as a fallback so the user can copy manually.
      console.warn('Clipboard write failed, field is selected for manual copy:', err);
    }
  });

  document.getElementById('new-split-btn').addEventListener('click', () => {
    resetState();
    showScreen('landing');
  });
}

function resetState() {
  state.receiptImageBase64 = null;
  state.receiptMimeType = null;
  state.parsed = null;
  state.payers = ['Me'];
  state.assignments = {};
  state.ownerPaymentHandle = '';
  document.getElementById('receipt-input').value = '';
  document.getElementById('capture-preview-wrap').classList.add('hidden');
  document.getElementById('consent-checkbox').checked = false;
  document.getElementById('start-btn').disabled = true;
}

// ---------------------------------------------------------------------------
// Screen: payer (read-only view for a shared /s/<id> link)
// ---------------------------------------------------------------------------

async function renderPayerView(id) {
  showScreen('payer');
  const loadingEl = document.getElementById('payer-loading');
  const errorEl = document.getElementById('payer-error');
  const contentEl = document.getElementById('payer-content');

  try {
    const split = await getSplit(id);
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    document.getElementById('payer-items').innerHTML = split.items
      .map(
        (item) =>
          `<div class="flex justify-between"><span>${escapeHtml(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ''}</span><span>${formatRM(item.line_total)}</span></div>`
      )
      .join('');

    const payers = Object.keys(split.totals.per_person || {});
    document.getElementById('payer-totals').innerHTML = payers
      .map(
        (name) =>
          `<div class="flex justify-between"><span>${escapeHtml(name)}</span><span class="font-semibold">${formatRM(split.totals.per_person[name])}</span></div>`
      )
      .join('');

    document.getElementById('payer-payment-handle').textContent = split.ownerPaymentHandle;
  } catch (err) {
    console.error(err);
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.message || 'This split was not found, or has expired.';
    errorEl.classList.remove('hidden');
  }
}

function bindErrorScreen() {
  document.getElementById('error-retry-btn').addEventListener('click', () => {
    window.location.href = '/';
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  bindLanding();
  bindCapture();
  bindReview();
  bindAssign();
  bindPayment();
  bindShare();
  bindErrorScreen();
  initRouter();
});
