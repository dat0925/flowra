// ─────────────────────────────────────
//  add-record.js  記録追加モーダル
// ─────────────────────────────────────
import { DB }        from './db.js';
import { openModal, closeModal, showToast } from './utils.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function renderAddRecord(onSave) {
  // タグ・口座を先に取得
  let accounts = [], tags = [];
  try {
    [accounts, tags] = await Promise.all([DB.getAccounts(), DB.getTags()]);
  } catch (e) {
    showToast('データ取得エラー: ' + e.message);
    return;
  }

  // 状態
  let state = {
    type:         'expense',
    amount:       '',
    date:         today(),
    accountId:    accounts[0]?.id || '',
    toAccountId:  accounts[1]?.id || '',
    memo:         '',
    url:          '',
    isUnsettled:  false,
    isRecurring:  false,
    selectedTags: new Set(),
  };

  function acctName(id) {
    return accounts.find(a => a.id === id)?.name || '選択してください';
  }

  function render() {
    const isTransfer = state.type === 'transfer';

    const accountSection = isTransfer ? `
      <div class="form-section">
        <div class="transfer-row">
          <div class="transfer-acct" id="btn-from-acct">
            <div class="transfer-acct-label">出元</div>
            <div class="transfer-acct-name">${acctName(state.accountId)}</div>
          </div>
          <div class="transfer-arrow">
            <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
          <div class="transfer-acct" id="btn-to-acct">
            <div class="transfer-acct-label">移動先</div>
            <div class="transfer-acct-name">${acctName(state.toAccountId)}</div>
          </div>
        </div>
      </div>` : `
      <div class="form-section">
        <div class="form-row" id="btn-acct">
          <div class="row-icon" style="background:var(--sage-bg);">
            <svg viewBox="0 0 24 24" style="stroke:var(--sage)"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div class="row-body">
            <div class="row-label">口座</div>
            <div class="row-value ${state.accountId ? '' : 'ph'}">${acctName(state.accountId)}</div>
          </div>
          <div class="row-chevron"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
        </div>
      </div>`;

    const tagsHTML = `
      <div class="form-section">
        <div class="tags-wrap">
          ${tags.map(t => `
            <div class="tag-chip ${state.selectedTags.has(t.id) ? 'on' : 'off'}" data-tag-id="${t.id}">${t.name}</div>
          `).join('')}
          <div class="tag-chip off new" id="btn-new-tag">＋</div>
        </div>
      </div>`;

    const html = `
      <div style="padding:0 14px 4px;">
        <div class="modal-handle" style="margin:0 auto 14px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">記録を追加</div>
          <button id="btn-close-modal" style="width:30px;height:30px;border-radius:50%;background:var(--mist);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
            <svg viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="type-selector">
          <button class="type-btn ${state.type==='income'?'active-income':''}" id="btn-income">
            <svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>収入
          </button>
          <button class="type-btn ${state.type==='expense'?'active-expense':''}" id="btn-expense">
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>支出
          </button>
          <button class="type-btn ${state.type==='transfer'?'active-transfer':''}" id="btn-transfer">
            <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>移動
          </button>
        </div>

        <div class="amount-card ${state.type}">
          <div class="amount-label">金額</div>
          <div class="amount-row">
            <span class="amount-currency">¥</span>
            <input class="amount-input" id="amount-input" type="number" inputmode="numeric"
              placeholder="0" value="${state.amount}" autocomplete="off">
          </div>
          <div class="amount-hint">デバイスのキーボードで入力</div>
        </div>

        ${accountSection}

        <div class="form-section">
          <div class="form-row no-tap">
            <div class="row-icon" style="background:#F0EDE8;">
              <svg viewBox="0 0 24 24" style="stroke:var(--mid)"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div class="row-body">
              <div class="row-label">日付</div>
              <input class="date-input" id="date-input" type="date" value="${state.date}">
            </div>
          </div>
          <div class="form-row no-tap">
            <div class="row-icon" style="background:#F0EDE8;">
              <svg viewBox="0 0 24 24" style="stroke:var(--mid)"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="row-body">
              <div class="row-label">メモ</div>
              <input class="text-input" id="memo-input" type="text" placeholder="メモを入力（任意）" value="${state.memo}">
            </div>
          </div>
          <div class="form-row no-tap">
            <div class="row-icon" style="background:#F0EDE8;">
              <svg viewBox="0 0 24 24" style="stroke:var(--mid)"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </div>
            <div class="row-body">
              <div class="row-label">URL</div>
              <input class="text-input" id="url-input" type="url" placeholder="https://... （任意）" value="${state.url}">
            </div>
          </div>
        </div>

        ${tagsHTML}

        <div class="form-section">
          <div class="toggle-wrap">
            <div class="toggle-left">
              <div class="row-icon" style="background:var(--gold-bg);">
                <svg viewBox="0 0 24 24" style="stroke:var(--gold)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div>
                <div class="toggle-title">未精算</div>
                <div class="toggle-sub">立替など後で精算が必要</div>
              </div>
            </div>
            <div class="toggle ${state.isUnsettled?'on':''}" id="toggle-unsettled">
              <div class="toggle-knob"></div>
            </div>
          </div>
        </div>

        <button class="btn-primary" id="btn-save" style="margin-top:20px;">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          保存する
        </button>
        <button class="btn-secondary" id="btn-cancel">キャンセル</button>
      </div>`;

    const modalContent = document.getElementById('modal-content');
    if (modalContent) {
      modalContent.innerHTML = html;
      bindEvents();
    }
  }

  function bindEvents() {
    // 閉じる
    document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-cancel')?.addEventListener('click', closeModal);

    // タイプ切り替え
    ['income','expense','transfer'].forEach(type => {
      document.getElementById('btn-' + type)?.addEventListener('click', () => {
        state.type = type;
        render();
      });
    });

    // 金額
    document.getElementById('amount-input')?.addEventListener('input', e => {
      state.amount = e.target.value;
    });

    // 日付
    document.getElementById('date-input')?.addEventListener('change', e => {
      state.date = e.target.value;
    });

    // メモ
    document.getElementById('memo-input')?.addEventListener('input', e => {
      state.memo = e.target.value;
    });

    // URL
    document.getElementById('url-input')?.addEventListener('input', e => {
      state.url = e.target.value;
    });

    // 口座選択（ドロップダウン代わりにprompt）
    document.getElementById('btn-acct')?.addEventListener('click', () => {
      showAccountPicker('account_id', id => { state.accountId = id; render(); });
    });
    document.getElementById('btn-from-acct')?.addEventListener('click', () => {
      showAccountPicker('from', id => { state.accountId = id; render(); });
    });
    document.getElementById('btn-to-acct')?.addEventListener('click', () => {
      showAccountPicker('to', id => { state.toAccountId = id; render(); });
    });

    // タグ
    document.querySelectorAll('.tag-chip[data-tag-id]').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.tagId;
        if (state.selectedTags.has(id)) {
          state.selectedTags.delete(id);
          chip.className = 'tag-chip off';
        } else {
          state.selectedTags.add(id);
          chip.className = 'tag-chip on';
        }
      });
    });

    // 未精算トグル
    document.getElementById('toggle-unsettled')?.addEventListener('click', function() {
      state.isUnsettled = !state.isUnsettled;
      this.classList.toggle('on', state.isUnsettled);
    });

    // 保存
    document.getElementById('btn-save')?.addEventListener('click', save);
  }

  function showAccountPicker(which, callback) {
    const list = accounts.map((a,i) => `${i+1}. ${a.name}`).join('\n');
    const idx  = parseInt(prompt(`口座を選択:\n${list}`, '1'), 10) - 1;
    if (!isNaN(idx) && accounts[idx]) callback(accounts[idx].id);
  }

  async function save() {
    const amount = parseInt(state.amount, 10);
    if (!amount || amount <= 0) { showToast('金額を入力してください'); return; }
    if (!state.date) { showToast('日付を入力してください'); return; }
    if (!state.accountId) { showToast('口座を選択してください'); return; }
    if (state.type === 'transfer' && !state.toAccountId) {
      showToast('移動先の口座を選択してください'); return;
    }
    if (state.type === 'transfer' && state.accountId === state.toAccountId) {
      showToast('移動元と移動先が同じです'); return;
    }

    const btn = document.getElementById('btn-save');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

    try {
      const payload = {
        type:          state.type,
        amount,
        date:          state.date,
        account_id:    state.accountId,
        to_account_id: state.type === 'transfer' ? state.toAccountId : null,
        memo:          state.memo || null,
        url:           state.url || null,
        is_unsettled:  state.isUnsettled,
      };
      await DB.createTransaction(payload, [...state.selectedTags]);
      if (onSave) onSave();
    } catch (err) {
      showToast('エラー: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '保存する'; }
    }
  }

  openModal('');
  render();
}
