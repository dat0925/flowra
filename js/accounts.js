// ─────────────────────────────────────
//  accounts.js  口座管理画面
// ─────────────────────────────────────
import { DB }        from './db.js';
import { fmt, showToast, openModal, closeModal } from './app.js';

const ACCT_TYPES = [
  { value: 'cash',   label: '現金' },
  { value: 'bank',   label: '銀行' },
  { value: 'ic',     label: 'ICカード' },
  { value: 'qr',     label: 'QRコード' },
  { value: 'credit', label: 'クレカ' },
  { value: 'other',  label: 'その他' },
];

const ACCT_ICON = {
  cash:   { bg: '#F0EDE8', stroke: '#7A9485' },
  bank:   { bg: '#EEF3FF', stroke: '#3B6FBF' },
  ic:     { bg: '#EEF5F1', stroke: '#4A7C59' },
  qr:     { bg: '#FFF2EB', stroke: '#C4602A' },
  credit: { bg: '#F5F0FF', stroke: '#7B5EA7' },
  other:  { bg: '#F0EDE8', stroke: '#7A9485' },
};

function typeLabel(type) {
  return ACCT_TYPES.find(t => t.value === type)?.label || type;
}

export async function renderAccounts() {
  const content = document.getElementById('page-content');
  try {
    const accounts = await DB.getAccounts();
    const total = accounts.reduce((s, a) => s + a.balance, 0);

    const itemsHTML = accounts.map((a, i) => {
      const ic = ACCT_ICON[a.type] || ACCT_ICON.other;
      return `
      ${i > 0 ? '<div class="acct-divider"></div>' : ''}
      <div class="acct-item">
        <div class="acct-left">
          <div class="acct-icon" style="background:${ic.bg};">
            <svg viewBox="0 0 24 24" style="stroke:${ic.stroke}"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div>
            <div class="acct-name">${a.name}</div>
            <div class="acct-type-label">${typeLabel(a.type)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="acct-balance" style="color:${a.balance<0?'var(--red)':'var(--ink)'}">
            <span class="acct-balance-cur">¥</span>${fmt(Math.abs(a.balance))}
          </div>
          <button class="btn-acct-edit" data-id="${a.id}"
            style="width:32px;height:32px;border-radius:9px;border:1px solid var(--border);background:var(--warm);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--mid);flex-shrink:0;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
      </div>`;
    }).join('');

    content.innerHTML = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head">
          <div class="panel-title">口座一覧</div>
        </div>
        ${accounts.length > 0 ? itemsHTML : '<div class="empty-state" style="padding:32px 24px;"><div class="empty-state-title">口座がありません</div></div>'}
        <div class="acct-total">
          <div class="acct-total-label">合計残高</div>
          <div class="acct-total-amount"><span style="font-size:11px;font-weight:300;color:var(--mid);margin-right:1px;">¥</span>${fmt(total)}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div class="panel-title">口座を追加</div></div>
        <div style="padding:16px 18px;">
          <div class="form-section" style="margin-bottom:12px;">
            <div class="form-row no-tap">
              <div class="row-body">
                <div class="row-label">口座名</div>
                <input class="text-input" id="new-acct-name" placeholder="例：みずほ銀行">
              </div>
            </div>
            <div class="form-row no-tap">
              <div class="row-body">
                <div class="row-label">種別</div>
                <select id="new-acct-type" style="font-family:'Noto Sans JP',sans-serif;font-size:14px;border:none;background:none;outline:none;color:var(--ink);width:100%;">
                  ${ACCT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-row no-tap">
              <div class="row-body">
                <div class="row-label">初期残高 (¥)</div>
                <input class="text-input" id="new-acct-balance" type="number" inputmode="numeric" placeholder="0">
              </div>
            </div>
          </div>
          <button class="btn-primary" id="btn-save-acct">
            <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
            口座を追加
          </button>
        </div>
      </div>`;

    // ── 追加 ──
    document.getElementById('btn-save-acct')?.addEventListener('click', async () => {
      const name    = document.getElementById('new-acct-name').value.trim();
      const type    = document.getElementById('new-acct-type').value;
      const balance = parseInt(document.getElementById('new-acct-balance').value || '0', 10);
      if (!name) { showToast('口座名を入力してください'); return; }
      try {
        await DB.createAccount({ name, type, balance });
        showToast('✓ 口座を追加しました');
        renderAccounts();
      } catch (e) { showToast('エラー: ' + e.message); }
    });

    // ── 編集ボタン → モーダル ──
    document.querySelectorAll('.btn-acct-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const acct = accounts.find(a => a.id === id);
        if (acct) openEditModal(acct);
      });
    });

  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-title">エラー: ${err.message}</div></div>`;
  }
}

function openEditModal(acct) {
  const html = `
    <div style="padding:0 16px 24px;">
      <div class="modal-handle" style="margin:0 auto 16px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">口座を編集</div>
        <button id="btn-close-edit" style="width:30px;height:30px;border-radius:50%;background:var(--mist);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
          <svg viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="form-section" style="margin-bottom:12px;">
        <div class="form-row no-tap">
          <div class="row-body">
            <div class="row-label">口座名</div>
            <input class="text-input" id="edit-acct-name" value="${acct.name}" placeholder="口座名">
          </div>
        </div>
        <div class="form-row no-tap">
          <div class="row-body">
            <div class="row-label">種別</div>
            <select id="edit-acct-type" style="font-family:'Noto Sans JP',sans-serif;font-size:14px;border:none;background:none;outline:none;color:var(--ink);width:100%;">
              ${ACCT_TYPES.map(t =>
                `<option value="${t.value}" ${t.value===acct.type?'selected':''}>${t.label}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-row no-tap">
          <div class="row-body">
            <div class="row-label">残高を補正 (¥)</div>
            <input class="text-input" id="edit-acct-balance" type="number" inputmode="numeric" value="${acct.balance}">
          </div>
        </div>
      </div>

      <button class="btn-primary" id="btn-update-acct" style="margin-bottom:8px;">
        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
        変更を保存
      </button>

      <button id="btn-delete-acct"
        style="width:100%;padding:12px;border-radius:14px;border:1px solid var(--red-bg);background:var(--red-bg);color:var(--red);font-family:'Noto Sans JP',sans-serif;font-size:14px;font-weight:500;cursor:pointer;">
        この口座を削除
      </button>
    </div>`;

  openModal(html);

  document.getElementById('btn-close-edit')?.addEventListener('click', closeModal);

  // 保存
  document.getElementById('btn-update-acct')?.addEventListener('click', async () => {
    const name    = document.getElementById('edit-acct-name').value.trim();
    const type    = document.getElementById('edit-acct-type').value;
    const balance = parseInt(document.getElementById('edit-acct-balance').value || '0', 10);
    if (!name) { showToast('口座名を入力してください'); return; }
    try {
      await DB.updateAccount(acct.id, { name, type, balance });
      closeModal();
      showToast('✓ 変更を保存しました');
      renderAccounts();
    } catch (e) { showToast('エラー: ' + e.message); }
  });

  // 削除
  document.getElementById('btn-delete-acct')?.addEventListener('click', async () => {
    const confirmed = confirm(`「${acct.name}」を削除しますか？\n※ この口座の記録は残ります`);
    if (!confirmed) return;
    try {
      await DB.updateAccount(acct.id, { is_archived: true });
      closeModal();
      showToast('口座を削除しました');
      renderAccounts();
    } catch (e) { showToast('エラー: ' + e.message); }
  });
}
