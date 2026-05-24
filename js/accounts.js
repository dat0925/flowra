// ─────────────────────────────────────
//  accounts.js  口座管理画面
// ─────────────────────────────────────
import { DB } from './db.js';
import { fmt } from './app.js';

const ACCT_TYPES = [
  { value: 'cash',   label: '現金' },
  { value: 'bank',   label: '銀行' },
  { value: 'ic',     label: 'ICカード' },
  { value: 'qr',     label: 'QRコード' },
  { value: 'credit', label: 'クレカ' },
  { value: 'other',  label: 'その他' },
];

export async function renderAccounts() {
  const content = document.getElementById('page-content');
  try {
    const accounts = await DB.getAccounts();
    const total = accounts.reduce((s, a) => s + a.balance, 0);

    const itemsHTML = accounts.map((a, i) => `
      ${i > 0 ? '<div class="acct-divider"></div>' : ''}
      <div class="acct-item">
        <div class="acct-left">
          <div class="acct-icon" style="background:var(--mist);">
            <svg viewBox="0 0 24 24" style="stroke:var(--sage)"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div>
            <div class="acct-name">${a.name}</div>
            <div class="acct-type-label">${ACCT_TYPES.find(t=>t.value===a.type)?.label || a.type}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px;">
          <div class="acct-balance" style="color:${a.balance<0?'var(--red)':'var(--ink)'}">
            <span class="acct-balance-cur">¥</span>${fmt(Math.abs(a.balance))}
          </div>
          <button class="btn-edit-acct" data-id="${a.id}" data-balance="${a.balance}"
            style="font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--border);background:var(--warm);cursor:pointer;color:var(--mid);">
            補正
          </button>
        </div>
      </div>`).join('');

    content.innerHTML = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head">
          <div class="panel-title">口座一覧</div>
          <div class="panel-link" id="btn-add-acct">
            ＋ 追加
          </div>
        </div>
        ${accounts.length > 0 ? itemsHTML : '<div class="empty-state"><div class="empty-state-title">口座がありません</div></div>'}
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
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            口座を追加
          </button>
        </div>
      </div>`;

    // 口座追加
    document.getElementById('btn-save-acct')?.addEventListener('click', async () => {
      const name    = document.getElementById('new-acct-name').value.trim();
      const type    = document.getElementById('new-acct-type').value;
      const balance = parseInt(document.getElementById('new-acct-balance').value || '0', 10);
      if (!name) { alert('口座名を入力してください'); return; }
      try {
        await DB.createAccount({ name, type, balance });
        renderAccounts();
      } catch (e) { alert('エラー: ' + e.message); }
    });

    // 残高補正
    document.querySelectorAll('.btn-edit-acct').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.id;
        const cur = btn.dataset.balance;
        const val = prompt('残高を入力 (¥)', cur);
        if (val === null) return;
        const balance = parseInt(val, 10);
        if (isNaN(balance)) { alert('数値を入力してください'); return; }
        try {
          await DB.updateAccount(id, { balance });
          renderAccounts();
        } catch (e) { alert('エラー: ' + e.message); }
      });
    });

  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-title">エラー: ${err.message}</div></div>`;
  }
}
