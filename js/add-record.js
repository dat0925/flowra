// ─────────────────────────────────────
//  add-record.js  記録追加モーダル
// ─────────────────────────────────────
import { DB }        from './db.js';
import { Sound }     from './sound.js';
import { openModal, closeModal, showToast } from './utils.js';

const today = () => new Date().toISOString().slice(0, 10);

// メモリキャッシュ（同期的にモーダルを開くため）
let _accounts = null;
let _tags = null;

// アプリ起動時・保存後に呼ぶ（事前ウォームアップ）
export async function warmupAddRecord() {
  try {
    [_accounts, _tags] = await Promise.all([DB.getAccounts(), DB.getTags()]);
  } catch (e) { /* silent */ }
}

export async function renderAddRecord(onSave, onReady) {
  // キャッシュがあれば同期的に開始、なければ取得
  let accounts = _accounts ?? [];
  let tags     = _tags     ?? [];

  if (_accounts === null) {
    // 初回のみ非同期取得（以降はウォームアップ済み）
    try {
      [accounts, tags] = await Promise.all([DB.getAccounts(), DB.getTags()]);
      _accounts = accounts;
      _tags = tags;
    } catch (e) {
      showToast('データ取得エラー: ' + e.message);
      return;
    }
  } else {
    // バックグラウンドで最新データに更新
    Promise.all([DB.getAccounts(), DB.getTags()])
      .then(([a, t]) => { _accounts = a; _tags = t; })
      .catch(() => {});
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
        <div style="display:flex;align-items:center;gap:6px;padding:11px 18px 4px;">
          <span style="font-size:12px;color:var(--mid);font-weight:500;">タグ</span>
          <button id="btn-tag-help"
            style="width:18px;height:18px;border-radius:50%;border:1.5px solid var(--mid-lt);background:none;
            display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);font-size:10px;font-weight:700;line-height:1;flex-shrink:0;">
            ?
          </button>
        </div>
        <div class="tags-wrap" style="padding-top:6px;">
          ${tags.length === 0
            ? `<div style="font-size:12.5px;color:var(--mid-lt);padding:4px 0 8px;display:flex;align-items:center;gap:6px;">
                タグがありません
                <span id="btn-go-tags" style="color:var(--sage);cursor:pointer;font-weight:500;text-decoration:underline;">設定で追加 →</span>
               </div>`
            : tags.map(t => `
                <div class="tag-chip ${state.selectedTags.has(t.id) ? 'on' : 'off'}" data-tag-id="${t.id}">${t.name}</div>
              `).join('')
          }
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
            <input class="amount-input" id="amount-input" type="text" inputmode="numeric"
              placeholder="0" value="${state.amount ? Number(state.amount).toLocaleString('ja-JP') : ''}"
              autocomplete="off" style="font-size:52px;">
          </div>
          <!-- 計算式表示 -->
          <div id="calc-expr" style="display:none;font-size:12px;color:rgba(255,255,255,0.4);
            margin-top:4px;letter-spacing:0.05em;min-height:16px;"></div>
          <!-- インライン電卓ボタン -->
          <div style="display:flex;gap:8px;margin-top:14px;">
            ${['+','−','×','÷'].map(op => `
              <button class="calc-op-btn" data-op="${op}"
                style="flex:1;padding:8px 0;border-radius:9px;border:none;
                background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);
                font-size:18px;font-weight:500;cursor:pointer;
                font-family:'Noto Sans JP',sans-serif;
                transition:background 0.12s;">
                ${op}
              </button>`).join('')}
            <button id="calc-eq-btn"
              style="flex:1;padding:8px 0;border-radius:9px;border:none;
              background:var(--sage-lt);color:#fff;
              font-size:18px;font-weight:600;cursor:pointer;
              font-family:'Noto Sans JP',sans-serif;
              transition:background 0.12s;">
              ＝
            </button>
          </div>
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

    // タグ ヘルプツールチップ
    document.getElementById('btn-tag-help')?.addEventListener('click', e => {
      e.stopPropagation();
      const existing = document.getElementById('tag-tooltip');
      if (existing) { existing.remove(); return; }

      const tooltip = document.createElement('div');
      tooltip.id = 'tag-tooltip';
      tooltip.style.cssText = `
        position:fixed;z-index:9999;
        background:var(--ink);color:#fff;
        font-size:12.5px;line-height:1.7;
        padding:14px 16px;border-radius:12px;
        max-width:260px;
        box-shadow:0 8px 24px rgba(0,0,0,0.25);
      `;
      tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px;color:var(--sage-lt);">タグとは？</div>
        記録に分類ラベルをつける機能です。<br>
        <br>
        <span style="color:var(--gold);">できること</span><br>
        ・記録一覧でタグ絞り込み<br>
        ・食費・交通費など自由に作成<br>
        ・1件の記録に複数タグ付与可<br>
        <br>
        <span style="opacity:0.5;font-size:11px;">設定 → タグ管理から追加できます</span>
        <button id="btn-tooltip-close" style="display:block;margin-top:10px;width:100%;padding:7px;border-radius:8px;border:none;background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-family:'Noto Sans JP',sans-serif;font-size:12px;">
          閉じる
        </button>`;

      // ボタンの位置に合わせて表示
      const rect = e.target.getBoundingClientRect();
      const top  = rect.bottom + 8;
      const left = Math.min(rect.left, window.innerWidth - 280);
      tooltip.style.top  = `${top}px`;
      tooltip.style.left = `${left}px`;

      document.body.appendChild(tooltip);

      document.getElementById('btn-tooltip-close')?.addEventListener('click', () => tooltip.remove());
      // 外タップで閉じる
      setTimeout(() => {
        document.addEventListener('click', function handler() {
          tooltip.remove();
          document.removeEventListener('click', handler);
        }, { once: true });
      }, 100);
    });

    // タグなし → 設定へ
    document.getElementById('btn-go-tags')?.addEventListener('click', () => {
      closeModal();
      import('./router.js').then(({ Router }) => Router.navigate('settings'));
    });

    // タイプ切り替え
    ['income','expense','transfer'].forEach(type => {
      document.getElementById('btn-' + type)?.addEventListener('click', () => {
        state.type = type;
        render();
      });
    });

    // ── 金額 + インライン電卓 ──────────────────
    // 計算状態
    let calcLeft = '';   // 左辺の値
    let calcOp   = '';   // 演算子

    const amountInput = document.getElementById('amount-input');
    const exprEl      = document.getElementById('calc-expr');

    // 数値をコンマ付きで表示
    function displayAmount(raw) {
      const n = parseInt(String(raw).replace(/,/g,''), 10);
      if (!isNaN(n) && n > 0) {
        amountInput.value = n.toLocaleString('ja-JP');
        state.amount = String(n);
      } else {
        amountInput.value = '';
        state.amount = '';
      }
    }

    // 計算式表示を更新
    function updateExpr() {
      if (calcLeft && calcOp) {
        exprEl.textContent = `¥${Number(calcLeft).toLocaleString('ja-JP')} ${calcOp}`;
        exprEl.style.display = 'block';
      } else {
        exprEl.style.display = 'none';
      }
    }

    amountInput?.addEventListener('input', e => {
      const raw = e.target.value.replace(/,/g,'');
      state.amount = raw;
      if (raw && !isNaN(raw) && raw !== '') {
        const formatted = Number(raw).toLocaleString('ja-JP');
        const pos = e.target.selectionStart;
        e.target.value = formatted;
      }
    });

    // 演算子ボタン
    document.querySelectorAll('.calc-op-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const currentVal = state.amount || '0';
        if (!currentVal || currentVal === '0') return;

        // 前の計算が未完なら先に計算する
        if (calcLeft && calcOp) {
          const result = calculate(Number(calcLeft), Number(currentVal), calcOp);
          displayAmount(result);
          calcLeft = String(result);
        } else {
          calcLeft = currentVal;
        }
        calcOp = btn.dataset.op;
        updateExpr();

        // 入力欄をクリアして次の数字を待つ
        amountInput.value = '';
        state.amount = '';
        amountInput.focus();
        Sound.playTap();
      });
    });

    // ＝ボタン
    document.getElementById('calc-eq-btn')?.addEventListener('click', () => {
      if (!calcLeft || !calcOp) return;
      const right = Number(state.amount || '0');
      const result = calculate(Number(calcLeft), right, calcOp);
      displayAmount(result);
      calcLeft = '';
      calcOp   = '';
      updateExpr();
      Sound.playTap();
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
        Sound.playTap();
      });
    });

    // 未精算トグル
    document.getElementById('toggle-unsettled')?.addEventListener('click', function() {
      state.isUnsettled = !state.isUnsettled;
      this.classList.toggle('on', state.isUnsettled);
      Sound.playTap();
    });

    // 保存
    document.getElementById('btn-save')?.addEventListener('click', save);
  }

  function showAccountPicker(which, callback) {
    // 口座タイプ別アイコンパス
    const TYPE_PATH = {
      cash:   '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>',
      bank:   '<path d="M3 22V8l9-6 9 6v14H3z"/><path d="M9 22V12h6v10"/>',
      ic:     '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6M9 10h6"/>',
          credit: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
      savings: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
      point:  '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
      other:  '<rect x="2" y="5" width="20" height="14" rx="2"/>',
    };
    const TYPE_COLOR = {
      cash:'#7A9485', bank:'#3B6FBF', ic:'#4A7C59',
      qr:'#C4602A', credit:'#7B5EA7', point:'#B8973E', other:'#7A9485',
    };
    const TYPE_BG = {
      cash:'#F0EDE8', bank:'#EEF3FF', ic:'#EEF5F1',
      qr:'#FFF2EB', credit:'#F5F0FF', point:'#FBF5E6', other:'#F0EDE8',
    };

    const label = which === 'to' ? '移動先の口座' : '口座を選択';
    const currentId = which === 'to' ? state.toAccountId : state.accountId;

    const itemsHTML = accounts.map(a => {
      const bg     = TYPE_BG[a.type]    || '#F0EDE8';
      const stroke = TYPE_COLOR[a.type] || '#7A9485';
      const path   = TYPE_PATH[a.type]  || TYPE_PATH.other;
      const selected = a.id === currentId;
      return `
        <div class="acct-picker-item ${selected ? 'selected' : ''}" data-id="${a.id}"
          style="display:flex;align-items:center;gap:13px;padding:13px 18px;cursor:pointer;
          border-bottom:1px solid var(--border);transition:background 0.12s;
          background:${selected ? 'var(--sage-bg)' : '#fff'};">
          <div style="width:38px;height:38px;border-radius:11px;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:500;color:var(--ink);">${a.name}</div>
            <div style="font-size:11px;color:var(--mid);">残高 ¥${Number(a.balance).toLocaleString('ja-JP')}</div>
          </div>
          ${selected ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--sage)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </div>`;
    }).join('');

    // 既存モーダルの上に重ねるサブシート
    const sheetId = 'acct-picker-sheet';
    document.getElementById(sheetId)?.remove();

    const sheet = document.createElement('div');
    sheet.id = sheetId;
    sheet.style.cssText = `
      position:fixed;inset:0;z-index:700;
      background:rgba(28,43,34,0.45);
      display:flex;align-items:flex-end;justify-content:center;
    `;
    sheet.innerHTML = `
      <div style="background:var(--stone);width:100%;max-width:480px;border-radius:20px 20px 0 0;
        max-height:70vh;overflow-y:auto;padding-bottom:32px;">
        <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 0;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;">
          <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">${label}</div>
          <button id="btn-close-picker" style="width:28px;height:28px;border-radius:50%;background:var(--mist);border:none;
            display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
            <svg viewBox="0 0 24 24" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="background:#fff;border-radius:14px;margin:0 14px;overflow:hidden;border:1px solid var(--border);">
          ${itemsHTML}
        </div>
      </div>`;

    document.body.appendChild(sheet);

    // 閉じる
    document.getElementById('btn-close-picker')?.addEventListener('click', () => sheet.remove());
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });

    // 口座タップ
    sheet.querySelectorAll('.acct-picker-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        sheet.remove();
        callback(id);
      });
    });
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

    // ── 楽観的UI更新 ──
    // onSave にペイロードを渡してDOM差し込みだけ行う（再描画なし）
    const acctName = accounts.find(a => a.id === state.accountId)?.name || '';
    const optimisticTx = {
      ...payload,
      id:       'optimistic-' + Date.now(),
      _acctName: acctName,
    };

    Sound.playSave();
    closeModal();
    if (onSave) onSave(optimisticTx);

    // バックグラウンドで実際に保存
    try {
      const { upsertTransactions } = await import('./cache.js');
      const tx = await DB.createTransaction(payload, [...state.selectedTags]);
      // キャッシュにも追記
      await upsertTransactions([{ ...tx, tags: [] }]);

      // 仮IDの行を正式IDに差し替え
      const tmpEl = document.querySelector('[data-tx-id="' + optimisticTx.id + '"]');
      if (tmpEl) tmpEl.dataset.txId = tx.id;
    } catch (err) {
      showToast('⚠️ 保存に失敗しました。再度お試しください。');
      console.error('Save error:', err);
    }
  }

  openModal('');
  render();
  // モーダルのCSSアニメーション完了後にフォーカス
  const sheet = document.getElementById('modal-add-record');
  if (sheet) {
    sheet.addEventListener('animationend', () => {
      document.getElementById('amount-input')?.focus();
      if (onReady) onReady();
    }, { once: true });
  } else {
    setTimeout(() => {
      document.getElementById('amount-input')?.focus();
      if (onReady) onReady();
    }, 300);
  }
}

// ── 計算ヘルパー ──
function calculate(left, right, op) {
  let result;
  switch (op) {
    case '+': result = left + right; break;
    case '−': result = left - right; break;
    case '×': result = Math.round(left * right); break;
    case '÷': result = right !== 0 ? Math.round(left / right) : left; break;
    default:  result = right;
  }
  // 負の値は0に（家計アプリなので）
  return Math.max(0, result);
}
