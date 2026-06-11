// ─────────────────────────────────────
//  add-record.js  記録追加モーダル
//  設計方針: 金額入力ファースト
//  +ボタン → 金額入力フォームが即表示
//  最近の記録は上部にコンパクト表示（横スクロール）
//  タグ選択はフォーム内
// ─────────────────────────────────────
import { DB }        from './db.js';
import { Sound }     from './sound.js';
import { openModal, closeModal, showToast } from './utils.js';
import { getCachedTransactions } from './cache.js';

const today = () => new Date().toISOString().slice(0, 10);

// メモリキャッシュ（同期的にモーダルを開くため）
let _accounts = null, _tags = null, _budgetTagIds = null;

// アプリ起動時・保存後に呼ぶ（事前ウォームアップ）
export async function warmupAddRecord() {
  try {
    [_accounts, _tags, _budgetTagIds] = await Promise.all([
      DB.getAccounts(), DB.getTags(), DB.getBudgetTagIds()
    ]);
  } catch (e) { /* silent */ }
}

export async function renderAddRecord(onSave, onReady, initialState = {}) {
  // キャッシュがあれば同期的に開始、なければ取得
  let accounts  = _accounts  ?? [];
  let tags      = _tags      ?? [];
  let budgetMap = _budgetTagIds ?? new Set();

  if (_accounts === null) {
    try {
      [accounts, tags, budgetMap] = await Promise.all([
        DB.getAccounts(), DB.getTags(), DB.getBudgetTagIds()
      ]);
      _accounts = accounts; _tags = tags; _budgetTagIds = budgetMap;
    } catch (e) {
      showToast('データ取得エラー: ' + e.message);
      return;
    }
  } else {
    Promise.all([DB.getAccounts(), DB.getTags(), DB.getBudgetTagIds()])
      .then(([a, t, b]) => { _accounts = a; _tags = t; _budgetTagIds = b; })
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
    isExcluded:   false,
    isRecurring:  false,
    selectedTags: new Set(),
    ...initialState,
    selectedTags: initialState.selectedTags
      ? new Set(initialState.selectedTags)
      : new Set(),
  };

  function acctName(id) {
    return accounts.find(a => a.id === id)?.name || '選択してください';
  }

  // ── メインフォームを描画 ─────────────────────────
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
            <div style="display:flex;align-items:baseline;gap:8px;">
              <div class="row-value ${state.accountId ? '' : 'ph'}">${acctName(state.accountId)}</div>
              ${state.accountId ? '<div style="font-size:11px;color:var(--mid);">残高 ¥' + (accounts.find(a=>a.id===state.accountId)?.balance ?? 0).toLocaleString() + '</div>' : ''}
            </div>
          </div>
          <div class="row-chevron"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
        </div>
      </div>`;

    // タグエリア（コンパクトなチップ形式）

    const tagsHTML = tags.length === 0 ? `
      <div class="form-section">
        <div style="padding:12px 18px;font-size:12.5px;color:var(--mid-lt);display:flex;align-items:center;gap:6px;">
          タグがありません
          <span id="btn-go-tags" style="color:var(--sage);cursor:pointer;font-weight:500;text-decoration:underline;">設定で追加 →</span>
        </div>
      </div>` : `
      <div class="form-section" style="padding:10px 14px 14px;">
        ${(() => {
          const primaryTags = tags.filter(t => budgetMap.has(t.id));
          const subTags = tags.filter(t => !budgetMap.has(t.id));
          const renderTagGrid = (tagList) => tagList.map(tag => {
            const isSelected = state.selectedTags.has(tag.id);
            const isPrimary = isSelected && budgetMap.has(tag.id) && [...state.selectedTags].filter(tid => budgetMap.has(tid))[0] === tag.id;
            const borderColor = isPrimary ? 'var(--sage)' : (isSelected ? 'var(--sage-lt)' : 'transparent');
            const bgColor = isSelected ? 'var(--sage-bg)' : 'var(--stone)';
            const tagColor = tag.color || 'var(--sage)';
            const badge = isPrimary
              ? '<span style="position:absolute;top:-5px;right:-5px;background:var(--sage);color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:5px;line-height:1.6;">主</span>'
              : (isSelected
                ? '<span style="position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;background:var(--sage-lt);display:flex;align-items:center;justify-content:center;"><svg viewBox=\'0 0 24 24\' width=\'9\' height=\'9\' fill=\'none\' stroke=\'#fff\' stroke-width=\'3\' stroke-linecap=\'round\'><polyline points=\'20 6 9 17 4 12\'/></svg></span>'
                : '');
            return '<button class="ar-tag-btn' + (isSelected ? ' ar-tag-selected' : '') + '" data-tag-id="' + tag.id + '"'
              + ' style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px 8px;border-radius:12px;border:2px solid ' + borderColor + ';background:' + bgColor + ';cursor:pointer;transition:all 0.12s;position:relative;">'
              + badge
              + '<div style="width:10px;height:10px;border-radius:50%;background:' + tagColor + ';margin-top:2px;"></div>'
              + '<span style="font-size:10px;color:' + (isSelected ? 'var(--sage-dk)' : 'var(--ink)') + ';font-weight:' + (isSelected ? '600' : '500') + ';text-align:center;line-height:1.3;word-break:keep-all;">' + tag.name + '</span>'
              + '</button>';
          }).join('');
          return '<div style="font-size:11px;color:var(--sage-dk);font-weight:600;margin-bottom:6px;padding:0 4px;">主タグ（予算あり・1つまで）</div>'
            + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px;">' + renderTagGrid(primaryTags) + '</div>'
            + (subTags.length > 0
              ? '<div style="font-size:11px;color:var(--mid);font-weight:600;margin-bottom:6px;padding:0 4px;">サブタグ（複数選択可）</div>'
                + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">' + renderTagGrid(subTags) + '</div>'
              : '');
        })()}
      </div>`;

    const html = `
      <div style="padding:0 14px 4px;">
        <div class="modal-handle" style="margin:0 auto 14px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">記録を追加</div>
          <button id="btn-close-modal" style="width:30px;height:30px;border-radius:50%;background:var(--mist);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
            <svg viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <button id="btn-scan-receipt" style="width:100%;margin-bottom:10px;padding:10px;border-radius:12px;border:1.5px dashed var(--sage-lt);background:var(--sage-bg);color:var(--sage-dk);font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke-width="1.5"/></svg>
          📷 レシートを読み取る
        </button>
        <input type="file" id="receipt-file-input" accept="image/*" capture="environment" style="display:none;">

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
          <div class="amount-card-label">金額</div>
          <div class="amount-row">
            <div class="amount-row-inner">
              <span class="amount-currency">¥</span>
              <div class="amount-input" id="amount-input"
                contenteditable="true"
                inputmode="numeric"
                data-placeholder="0"
                autocomplete="off"
                spellcheck="false">${state.amount ? Number(state.amount).toLocaleString('ja-JP') : ''}</div>
            </div>
          </div>
          <div id="calc-expr" class="amount-card-sub"></div>
          <div style="display:flex;gap:6px;margin-top:12px;">
            <button id="calc-ac-btn"
              style="flex:1;padding:7px 0;border-radius:8px;border:none;
              background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.35);
              font-size:13px;font-weight:600;cursor:pointer;
              font-family:'Noto Sans JP',sans-serif;transition:background 0.12s;">
              AC
            </button>
            <button id="calc-dot-btn"
              style="flex:1;padding:7px 0;border-radius:8px;border:none;
              background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);
              font-size:18px;font-weight:500;cursor:pointer;
              font-family:'Noto Sans JP',sans-serif;transition:background 0.12s;">
              ．
            </button>
            ${['+','−','×','÷'].map(op => `
              <button class="calc-op-btn" data-op="${op}"
                style="flex:1;padding:7px 0;border-radius:8px;border:none;
                background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);
                font-size:18px;font-weight:500;cursor:pointer;
                font-family:'Noto Sans JP',sans-serif;transition:background 0.12s;">
                ${op}
              </button>`).join('')}
            <button id="calc-eq-btn"
              style="flex:1;padding:7px 0;border-radius:8px;border:none;
              background:var(--sage-lt);color:#fff;
              font-size:18px;font-weight:600;cursor:pointer;
              font-family:'Noto Sans JP',sans-serif;transition:background 0.12s;">
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
        </div>

        ${tagsHTML}

        <div class="form-section">

          <div class="toggle-wrap">
            <div class="toggle-left">
              <div class="row-icon" style="background:#F0EDE8;">
                <svg viewBox="0 0 24 24" style="stroke:#9A7A6A;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </div>
              <div>
                <div class="toggle-title" style="display:flex;align-items:center;gap:5px;">
                  集計除外
                  <span id="excluded-help" style="width:15px;height:15px;border-radius:50%;
                    background:var(--mist);color:var(--mid);font-size:10px;font-weight:600;
                    display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
                    flex-shrink:0;">?</span>
                </div>
                <div class="toggle-sub">タグ別集計に含めない</div>
              </div>
            </div>
            <div class="toggle ${state.isExcluded?'on':''}" id="toggle-excluded">
              <div class="toggle-knob"></div>
            </div>
          </div>
        </div>
      </div>`;

    const modalContent = document.getElementById('modal-content');
    if (modalContent) {
      modalContent.innerHTML = html;
      bindEvents();
    }
  }

  function bindEvents() {
    document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);

  // ── レシート読み取り ──────────────────────────
  document.getElementById('btn-scan-receipt')?.addEventListener('click', () => {
    document.getElementById('receipt-file-input')?.click();
  });

  document.getElementById('receipt-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const btn = document.getElementById('btn-scan-receipt');
    if (btn) { btn.disabled = true; btn.textContent = '読み取り中…'; }

    try {
      // base64変換
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await DB.scanReceipt(base64, file.type || 'image/jpeg');
      // 元のモーダルを閉じてからレシート確認画面を開く
      const existingOverlay = document.getElementById('modal-overlay');
      if (existingOverlay) existingOverlay.remove();
      const existingSaveBar = document.getElementById('save-bar');
      if (existingSaveBar) existingSaveBar.remove();
      showReceiptConfirm(result, onSave, onReady, accounts, tags);

    } catch (err) {
      if (err.error === 'LIMIT_REACHED') {
        const msg = err.isPremium
          ? 'レシート読み取りの今月の上限（' + err.limit + '回）に達しました'
          : 'レシート読み取りは月' + err.limit + '回まで（Premiumで月100回）';
        showToast(msg);
      } else {
        showToast('読み取りエラー: ' + (err.message || '不明'));
      }
      if (btn) { btn.disabled = false; btn.textContent = '📷 レシートを読み取る'; }
    }

    // inputをリセット（同じファイルを再選択できるように）
    e.target.value = '';
  });
    document.getElementById('btn-cancel')?.addEventListener('click', closeModal);

    // save-bar
    const saveBar = document.getElementById('save-bar');
    if (saveBar) {
      saveBar.hidden = false;
      const oldSaveBtn = document.getElementById('save-bar-btn');
      const oldCancelBtn = document.getElementById('save-bar-cancel');
      if (oldSaveBtn) {
        const newSaveBtn = oldSaveBtn.cloneNode(true);
        oldSaveBtn.parentNode.replaceChild(newSaveBtn, oldSaveBtn);
        newSaveBtn.addEventListener('click', save);
      }
      if (oldCancelBtn) {
        const newCancelBtn = oldCancelBtn.cloneNode(true);
        oldCancelBtn.parentNode.replaceChild(newCancelBtn, oldCancelBtn);
        newCancelBtn.addEventListener('click', () => {
          saveBar.hidden = true;
          closeModal();
        });
      }
    }

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
    let calcLeft = '';
    let calcOp   = '';

    const amountInput = document.getElementById('amount-input');
    const exprEl      = document.getElementById('calc-expr');

    function moveCursorToEnd(el) {
      el.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function adjustFontSize(digits) {
      if (digits <= 9) amountInput.style.fontSize = '34px';
      else             amountInput.style.fontSize = '28px';
    }

    function displayAmount(raw) {
      const s = String(raw).replace(/,/g, '');
      const hasDecimal = s.includes('.');
      if (hasDecimal) {
        // 小数点あり → そのまま表示（計算途中）
        amountInput.textContent = s;
        state.amount = s;
        adjustFontSize(s.replace('.','').length);
      } else {
        const n = parseInt(s, 10);
        if (!isNaN(n) && n > 0) {
          amountInput.textContent = n.toLocaleString('ja-JP');
          state.amount = String(n);
          adjustFontSize(String(n).length);
        } else {
          amountInput.textContent = '';
          state.amount = '';
          adjustFontSize(0);
        }
      }
    }

    function updateExpr() {
      if (calcLeft && calcOp) {
        exprEl.textContent = '¥' + Number(calcLeft).toLocaleString('ja-JP') + ' ' + calcOp;
      } else {
        exprEl.textContent = '';
      }
    }

    const initDigits = (state.amount || '').length;
    if (initDigits > 0) adjustFontSize(initDigits);

    let waitingForNextInput = false;
    amountInput?.addEventListener('input', () => {
      // 小数点を許可（計算途中で使用、保存時にroundされる）
      let raw = amountInput.textContent.replace(/,/g,'').replace(/[^0-9.]/g,'');
      // 小数点が複数ある場合は最初の1つだけ残す
      const parts = raw.split('.');
      if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');

      if (waitingForNextInput) {
        waitingForNextInput = false;
        // 小数点で始まる入力（例: .08）はそのまま保持
        const lastChar = raw.slice(-1);
        raw = lastChar;
        amountInput.textContent = raw;
      }
      state.amount = raw;
      if (raw && raw !== '.') {
        const hasDecimal = raw.includes('.');
        if (hasDecimal) {
          // 小数点あり → そのまま表示
          amountInput.textContent = raw;
          adjustFontSize(raw.replace('.','').length);
        } else {
          const formatted = Number(raw).toLocaleString('ja-JP');
          amountInput.textContent = formatted;
          adjustFontSize(raw.length);
        }
        moveCursorToEnd(amountInput);
      } else if (!raw || raw === '.') {
        if (raw !== '.') amountInput.textContent = '';
        adjustFontSize(0);
      }
    });

    amountInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') e.preventDefault();
    });

    document.querySelectorAll('.calc-op-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => {
        const currentVal = state.amount || '0';
        if (!currentVal || currentVal === '0') return;
        if (calcLeft && calcOp) {
          const result = calculate(Number(calcLeft), Number(currentVal), calcOp);
          displayAmount(result);
          calcLeft = String(result);
        } else {
          calcLeft = currentVal;
        }
        calcOp = btn.dataset.op;
        updateExpr();
        waitingForNextInput = true;
        moveCursorToEnd(amountInput);
        Sound.playTap();
      });
    });

    document.getElementById('calc-eq-btn')?.addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('calc-eq-btn')?.addEventListener('click', () => {
      if (!calcLeft || !calcOp) return;
      const right = Number(state.amount || '0');
      const result = calculate(Number(calcLeft), right, calcOp);
      const exprText = '¥' + Number(calcLeft).toLocaleString('ja-JP') + ' ' + calcOp + ' ¥' + Number(right).toLocaleString('ja-JP') + ' ＝ ¥' + result.toLocaleString('ja-JP');
      displayAmount(result);
      calcLeft = '';
      calcOp   = '';
      exprEl.textContent = exprText;
      Sound.playTap();
    });

    document.getElementById('calc-dot-btn')?.addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('calc-dot-btn')?.addEventListener('click', () => {
      const cur = state.amount || '0';
      // すでに小数点があれば追加しない
      if (cur.includes('.')) return;
      const newVal = cur + '.';
      amountInput.textContent = newVal;
      state.amount = newVal;
      moveCursorToEnd(amountInput);
      Sound.playTap();
    });

    document.getElementById('calc-ac-btn')?.addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('calc-ac-btn')?.addEventListener('click', () => {
      calcLeft = '';
      calcOp   = '';
      displayAmount('');
      updateExpr();
      moveCursorToEnd(amountInput);
      Sound.playTap();
    });

    document.getElementById('date-input')?.addEventListener('change', e => {
      state.date = e.target.value;
    });

    // メモ候補
    const memoInput = document.getElementById('memo-input');
    const memoSuggest = document.createElement('div');
    memoSuggest.id = 'memo-suggest';
    memoSuggest.style.cssText = `
      display:none;position:absolute;z-index:200;
      background:#fff;border:1px solid var(--border);
      border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.08);
      overflow:hidden;max-height:180px;overflow-y:auto;
    `;
    memoInput?.parentElement?.style && (memoInput.parentElement.style.position = 'relative');
    memoInput?.parentElement?.appendChild(memoSuggest);

    let pastMemos = [];
    getCachedTransactions().then(txs => {
      const seen = new Set();
      pastMemos = txs
        .map(t => t.memo)
        .filter(m => m && m.trim())
        .filter(m => { if (seen.has(m)) return false; seen.add(m); return true; });
    }).catch(() => {});

    function showMemoSuggest(q) {
      if (!q) { memoSuggest.style.display = 'none'; return; }
      const matched = pastMemos.filter(m => m.includes(q)).slice(0, 5);
      if (matched.length === 0) { memoSuggest.style.display = 'none'; return; }
      memoSuggest.innerHTML = matched.map(m =>
        '<div class="memo-suggest-item" style="padding:10px 14px;font-size:13.5px;'
        + 'color:var(--ink);cursor:pointer;border-bottom:1px solid var(--border);'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
        + m + '</div>'
      ).join('');
      memoSuggest.querySelectorAll('.memo-suggest-item').forEach((item, i) => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          memoInput.value = matched[i];
          state.memo = matched[i];
          memoSuggest.style.display = 'none';
        });
      });
      const rect = memoInput.getBoundingClientRect();
      const parentRect = memoInput.parentElement.getBoundingClientRect();
      memoSuggest.style.top = (rect.bottom - parentRect.top + 2) + 'px';
      memoSuggest.style.left = '0';
      memoSuggest.style.right = '0';
      memoSuggest.style.display = 'block';
    }

    memoInput?.addEventListener('input', e => {
      state.memo = e.target.value;
      showMemoSuggest(e.target.value);
    });
    memoInput?.addEventListener('blur', () => {
      setTimeout(() => { memoSuggest.style.display = 'none'; }, 150);
    });
    memoInput?.addEventListener('focus', e => {
      if (e.target.value) showMemoSuggest(e.target.value);
    });

    // 口座選択
    document.getElementById('btn-acct')?.addEventListener('click', () => {
      showAccountPicker('account_id', id => { state.accountId = id; render(); });
    });
    document.getElementById('btn-from-acct')?.addEventListener('click', () => {
      showAccountPicker('from', id => { state.accountId = id; render(); });
    });
    document.getElementById('btn-to-acct')?.addEventListener('click', () => {
      showAccountPicker('to', id => { state.toAccountId = id; render(); });
    });

    // タグチップ（グリッド）
    document.querySelectorAll('.ar-tag-btn[data-tag-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.tagId;
        if (state.selectedTags.has(id)) {
          state.selectedTags.delete(id);
        } else {
          // 予算ありタグは排他：すでに別の主タグがあれば自動的に外す
          if (budgetMap.has(id)) {
            const currentBudgetTags = [...state.selectedTags].filter(tid => budgetMap.has(tid));
            currentBudgetTags.forEach(tid => state.selectedTags.delete(tid));
          }
          state.selectedTags.add(id);
        }
        Sound.playTap();
        // グリッドだけ再描画（スクロール位置を維持するため最小限の更新）
        render();
        // フォーカスをamount-inputに戻さない（タグ選択後はそのまま）
      });
    });

    // 未精算トグル
    document.getElementById('toggle-unsettled')?.addEventListener('click', function() {
      state.isUnsettled = !state.isUnsettled;
      this.classList.toggle('on', state.isUnsettled);
      Sound.playTap();
    });

    document.getElementById('toggle-excluded')?.addEventListener('click', function() {
      state.isExcluded = !state.isExcluded;
      this.classList.toggle('on', state.isExcluded);
    });
    document.getElementById('excluded-help')?.addEventListener('click', e => {
      e.stopPropagation();
      showToast('集計除外にすると、タグ別集計シートに表示されなくなります。ホーム画面の収支合計には引き続き含まれます。');
    });


    document.getElementById('btn-save')?.addEventListener('click', save);
  }

  function showAccountPicker(which, callback) {
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
        display:flex;flex-direction:column;max-height:85vh;">
        <div style="flex-shrink:0;">
          <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 0;"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;">
            <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">${label}</div>
            <button id="btn-close-picker" style="width:28px;height:28px;border-radius:50%;background:var(--mist);border:none;
              display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
              <svg viewBox="0 0 24 24" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div style="overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 14px 32px;flex:1;min-height:0;">
          <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid var(--border);">
            ${itemsHTML}
          </div>
        </div>
      </div>`;

    document.body.appendChild(sheet);
    document.getElementById('btn-close-picker')?.addEventListener('click', () => sheet.remove());
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
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
      is_excluded:   state.isExcluded,
    };

    const acctNameVal = accounts.find(a => a.id === state.accountId)?.name || '';
    const optimisticTx = {
      ...payload,
      id:       'optimistic-' + Date.now(),
      _acctName: acctNameVal,
    };

    Sound.playSave();
    const saveBar = document.getElementById('save-bar');
    if (saveBar) saveBar.hidden = true;
    closeModal();
    if (onSave) onSave(optimisticTx);

    try {
      const { upsertTransactions } = await import('./cache.js');
      const tagIds = [...state.selectedTags];
      const tx = await DB.createTransaction(payload, tagIds);

      const cachedTags = tags.filter(t => tagIds.includes(t.id));
      await upsertTransactions([{ ...tx, tags: cachedTags }]);

      const tmpEl = document.querySelector('[data-tx-id="' + optimisticTx.id + '"]');
      if (tmpEl) tmpEl.dataset.txId = tx.id;

      // 登録後の残高をトーストで表示
      const acct = accounts.find(a => a.id === state.accountId);
      if (acct) {
        const sign = payload.type === 'income' ? 1 : payload.type === 'expense' ? -1 : 0;
        const newBalance = acct.balance + sign * amount;
        showToast(acctNameVal + ' ¥' + newBalance.toLocaleString());
      }
    } catch (err) {
      showToast('⚠️ ' + (err.message || JSON.stringify(err)));
      console.error('Save error:', err);
    }
  }

  // ── エントリポイント ──
  // _skipSuggestがある（カテゴリタップ・直接入力）か、
  // 編集モード（initialStateに値がある）の場合はフォームを直接開く
  const isNew = Object.keys(initialState).filter(k => k !== '_skipSuggest').length === 0;
  const skipSuggest = initialState._skipSuggest;

  if (!isNew || skipSuggest) {
    // 編集・コピー・カテゴリ選択後 → フォーム直接表示
    openModal('');
    render();
  } else {
    // 新規（+ボタン） → サジェスト画面を表示
    await showSuggest(onSave, onReady, accounts, tags);
    return;
  }

  const sheet = document.getElementById('modal-add-record');
  if (sheet) {
    sheet.style.animation = 'none';
    sheet.offsetHeight;
    sheet.style.animation = '';
  }

  const doFocus = () => {
    setTimeout(() => {
      const el = document.getElementById('amount-input');
      if (el) {
        el.focus();
        const r = document.createRange();
        const s = window.getSelection();
        r.selectNodeContents(el);
        r.collapse(false);
        s.removeAllRanges();
        s.addRange(r);
      }
      if (onReady) onReady();
    }, 200);
  };
  if (sheet) {
    sheet.addEventListener('animationend', doFocus, { once: true });
  } else {
    setTimeout(doFocus, 300);
  }
}

// ── サジェスト画面（金額入力ファースト） ─────────────────
async function showSuggest(onSave, onReady, accounts, tags) {
  const all = await getCachedTransactions();

  // 直近の記録から重複排除して20件取得（日付+内容で重複排除）
  const seen = new Set();
  const recent = [];
  for (const tx of all) {
    if (tx.type === 'transfer') continue;
    // 日付を含めたキーで重複排除（同日同内容のみ除外、別日は別扱い）
    const key = tx.date + '|' + tx.type + '|' + tx.amount + '|' + (tx.memo || '') + '|' + tx.account_id;
    if (!seen.has(key)) {
      seen.add(key);
      recent.push(tx);
      if (recent.length >= 20) break;
    }
  }

  const typeColor = { income: 'var(--sage)', expense: 'var(--red)' };
  const typeLabel = { income: '収入', expense: '支出' };
  const acctName = (id) => accounts.find(a => a.id === id)?.name || '';

  // 最近の記録（横スクロールカード）
  const recentHTML = recent.length === 0 ? '' :
    '<div style="padding:0 16px 16px;">'
    + '<div style="font-size:11px;color:var(--mid-lt);margin-bottom:8px;letter-spacing:0.05em;">最近の記録からコピー</div>'
    + '<div style="display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;'
    + 'scrollbar-width:none;">'
    + recent.map(tx => {
        const tagName = tx.tags && tx.tags.find(t => t) ? tx.tags.find(t => t).name : '';
        const color = typeColor[tx.type] || 'var(--mid)';
        return '<button class="ar-recent-btn" data-tx-id="' + tx.id + '"'
          + ' style="flex-shrink:0;width:140px;padding:12px;border-radius:12px;border:1.5px solid var(--border);'
          + 'background:var(--stone);cursor:pointer;text-align:left;transition:background 0.12s;">'
          + '<div style="font-size:15px;font-weight:700;color:' + color + ';margin-bottom:4px;">'
          + '¥' + Number(tx.amount).toLocaleString('ja-JP') + '</div>'
          + '<div style="font-size:12px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;">'
          + (tx.memo || '（メモなし）') + '</div>'
          + '<div style="display:flex;align-items:center;gap:4px;">'
          + (tagName ? '<span style="font-size:10px;color:var(--sage-dk);background:var(--sage-bg);padding:1px 5px;border-radius:4px;font-weight:600;">' + tagName + '</span>' : '')
          + '<span style="font-size:10px;color:var(--mid-lt);">' + acctName(tx.account_id) + '</span>'
          + '</div>'
          + '</button>';
      }).join('')
    + '</div>'
    + '<button id="ar-search-history-btn" style="display:flex;align-items:center;gap:4px;'
    + 'margin-top:8px;padding:0;border:none;background:none;cursor:pointer;color:var(--sage);font-size:12px;">'
    + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    + '過去の履歴を検索'
    + '</button>'
    + '</div>';

  const overlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');

  modalContent.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-top:16px;">

        <!-- ハンドル + タイトル -->
        <div style="padding:0 16px 20px;">
          <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:0 auto 16px;"></div>
          <div style="font-family:'Noto Serif JP',serif;font-size:18px;font-weight:600;color:var(--ink);">記録を追加</div>
          <div style="font-size:12px;color:var(--mid-lt);margin-top:4px;">金額を入力してすぐ保存できます</div>
        </div>

        <!-- メインCTA -->
        <div style="padding:0 16px 20px;">
          <button id="ar-quick-btn"
            style="width:100%;padding:20px 16px;border-radius:18px;border:none;
            background:var(--sage);color:#fff;cursor:pointer;
            display:flex;align-items:center;justify-content:space-between;
            box-shadow:0 4px 16px rgba(74,124,89,0.3);transition:opacity 0.12s;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,0.2);
                display:flex;align-items:center;justify-content:center;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <div style="text-align:left;">
                <div style="font-size:16px;font-weight:700;">金額を入力する</div>
                <div style="font-size:11px;opacity:0.8;margin-top:2px;">タグ・メモは後から選べます</div>
              </div>
            </div>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        <!-- レシート読み取り -->
        <div style="padding:0 16px 20px;">
          <button id="ar-receipt-btn"
            style="width:100%;padding:14px 16px;border-radius:14px;border:1.5px dashed var(--sage-lt);
            background:var(--sage-bg);color:var(--sage-dk);cursor:pointer;
            display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(74,124,89,0.1);
              display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="12" cy="12" r="3"/>
                <path d="M3 9h2M3 15h2M19 9h2M19 15h2M9 3v2M15 3v2M9 19v2M15 19v2" stroke-width="1.5"/>
              </svg>
            </div>
            <div style="text-align:left;">
              <div style="font-size:14px;font-weight:600;">📷 レシートを読み取る</div>
              <div style="font-size:11px;color:var(--mid);margin-top:2px;">品目を自動抽出・1商品1レコードで保存</div>
            </div>
          </button>
          <input type="file" id="ar-receipt-file" accept="image/*" capture="environment" style="display:none;">
        </div>

        <!-- 最近の記録 -->
        \${recentHTML}

      </div>

      <!-- 下部キャンセル -->
      <div style="flex-shrink:0;padding:10px 16px;padding-bottom:calc(10px + env(safe-area-inset-bottom));
        border-top:1px solid var(--border);background:var(--stone);">
        <button id="ar-cancel-btn"
          style="width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--border);
          background:none;color:var(--mid);font-size:14px;font-weight:500;cursor:pointer;">
          キャンセル
        </button>
      </div>
    </div>`;

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  Sound.playOpen();

  // 閉じる処理
  let onOverlayClick;
  const closeSuggest = () => {
    if (onOverlayClick) overlay.removeEventListener('click', onOverlayClick);
    overlay.hidden = true;
    document.body.style.overflow = '';
    Sound.playClose();
  };
  onOverlayClick = (e) => { if (e.target === overlay) closeSuggest(); };
  overlay.addEventListener('click', onOverlayClick);
  document.getElementById('ar-cancel-btn')?.addEventListener('click', closeSuggest);

  // 過去の履歴を検索
  document.getElementById('ar-search-history-btn')?.addEventListener('click', () => {
    closeSuggest();
    import('./router.js').then(({ Router }) => Router.navigate('records'));
    import('./records.js').then(({ renderRecords }) => renderRecords({ focusSearch: true }));
  });
  document.getElementById('ar-receipt-btn')?.addEventListener('click', () => {
    document.getElementById('ar-receipt-file')?.click();
  });

  document.getElementById('ar-receipt-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const btn = document.getElementById('ar-receipt-btn');
    if (btn) { btn.style.opacity = '0.6'; btn.querySelector('div div:first-child').textContent = '読み取り中…'; }
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      closeSuggest();
      const result = await DB.scanReceipt(base64, file.type || 'image/jpeg');
      showReceiptConfirm(result, onSave, onReady, accounts, tags);
    } catch (err) {
      if (err.error === 'LIMIT_REACHED') {
        const msg = err.isPremium
          ? 'レシート読み取りの今月の上限（' + err.limit + '回）に達しました'
          : 'レシート読み取りは月' + err.limit + '回まで（Premiumで月100回）';
        showToast(msg);
      } else {
        showToast('読み取りエラー: ' + (err.message || '不明'));
      }
      if (btn) { btn.style.opacity = '1'; }
    }
    e.target.value = '';
  });

  document.getElementById('ar-quick-btn')?.addEventListener('click', () => {
    const dummy = document.getElementById('ios-focus-trick');
    dummy?.focus();
    overlay.removeEventListener('click', onOverlayClick);
    overlay.hidden = true;
    document.body.style.overflow = '';
    renderAddRecord(onSave, () => {
      setTimeout(() => {
        const el = document.getElementById('amount-input');
        if (el) {
          el.focus();
          const r = document.createRange();
          const s = window.getSelection();
          r.selectNodeContents(el);
          r.collapse(false);
          s.removeAllRanges();
          s.addRange(r);
        }
      }, 50);
    }, { _skipSuggest: true });
  });

  // 最近の記録をコピー
  document.querySelectorAll('.ar-recent-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dummy = document.getElementById('ios-focus-trick');
      dummy?.focus();
      const txId = btn.dataset.txId;
      const tx = all.find(t => t.id === txId);
      if (!tx) return;
      const memo = tx.memo || null;
      const copyState = {
        type:        tx.type,
        amount:      String(tx.amount),
        date:        new Date().toISOString().slice(0, 10),
        accountId:   tx.account_id,
        toAccountId: tx.to_account_id || '',
        memo,
        url:         tx.url || '',
        isUnsettled: false,
        isExcluded:  false,
        selectedTags: (tx.tags || []).filter(t => t).map(t => t.id),
      };
      overlay.removeEventListener('click', onOverlayClick);
      overlay.hidden = true;
      document.body.style.overflow = '';
      renderAddRecord(onSave, null, copyState);
    });
  });
}

// ── 計算ヘルパー ──
function calculate(left, right, op) {
  let result;
  switch (op) {
    case '+': result = Math.round(left + right); break;
    case '−': result = Math.round(left - right); break;
    case '×': result = Math.round(left * right); break;
    case '÷': result = right !== 0 ? Math.round(left / right) : left; break;
    default:  result = Math.round(right);
  }
  return Math.max(0, result);
}

// ── レシート確認画面 ──────────────────────────────────────
async function showReceiptConfirm(result, onSave, onReady, accounts, tags) {
  const { store, date, items } = result;
  const { showToast } = await import('./utils.js');
  const { upsertTransactions } = await import('./cache.js');

  // 既存モーダルを閉じて専用オーバーレイを開く
  const existingModal = document.getElementById('modal-overlay');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'receipt-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:500;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,0.4);';
  document.body.appendChild(overlay);

  const sheet = document.createElement('div');
  sheet.id = 'receipt-sheet';
  sheet.style.cssText = 'background:var(--stone);border-radius:20px 20px 0 0;max-height:90dvh;overflow-y:auto;padding-bottom:env(safe-area-inset-bottom);';
  overlay.appendChild(sheet);

  const closeReceipt = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) closeReceipt(); });

  // 各品目の状態（チェック・タグ・金額）
  let itemStates = items.map(item => ({
    ...item,
    checked: item.amount > 0, // マイナス（値引き）はデフォルトOFF
    tagIds: new Set(),
  }));

  // デフォルト口座
  const defaultAccountId = accounts[0]?.id || '';
  let selectedAccountId = defaultAccountId;
  let receiptDate = date || new Date().toISOString().slice(0, 10);

  const budgetTagIds = tags.filter(t => t.budget).map(t => t.id);
  const { DB } = await import('./db.js');
  const budgetMap = await DB.getBudgetTagIds();

  function renderConfirmUI() {
    const modal = document.getElementById('receipt-sheet');
    if (!modal) return;

    const acctName = (id) => accounts.find(a => a.id === id)?.name || '選択';
    const checkedItems = itemStates.filter(i => i.checked);
    const total = checkedItems.reduce((s, i) => s + i.amount, 0);

    const itemRows = itemStates.map((item, idx) => {
      const primaryTags = tags.filter(t => budgetMap.has(t.id));
      const subTags     = tags.filter(t => !budgetMap.has(t.id));

      const renderChips = (tagList) => tagList.map(tag => {
        const sel = item.tagIds.has(tag.id);
        const isPrimary = budgetMap.has(tag.id);
        return '<button class="receipt-tag-chip" data-item="' + idx + '" data-tag="' + tag.id + '"'
          + ' style="font-size:10px;padding:2px 8px;border-radius:12px;border:1.5px solid '
          + (sel ? (isPrimary ? 'var(--sage)' : 'var(--sage-lt)') : 'var(--mist)') + ';background:'
          + (sel ? 'var(--sage-bg)' : 'transparent') + ';color:'
          + (sel ? 'var(--sage-dk)' : 'var(--mid)') + ';cursor:pointer;white-space:nowrap;">'
          + tag.name + '</button>';
      }).join('');

      const tagChips = (primaryTags.length > 0
        ? '<div style="font-size:9px;color:var(--sage-dk);font-weight:600;margin-bottom:3px;">主タグ</div>'
          + '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">' + renderChips(primaryTags) + '</div>'
        : '')
        + (subTags.length > 0
        ? '<div style="font-size:9px;color:var(--mid);font-weight:600;margin-bottom:3px;">サブタグ</div>'
          + '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + renderChips(subTags) + '</div>'
        : '');

      const amountColor = item.amount < 0 ? 'color:var(--red)' : '';
      return '<div style="padding:10px 0;border-bottom:1px solid var(--mist);display:flex;gap:10px;align-items:flex-start;">'
        + '<input type="checkbox" data-item-check="' + idx + '" ' + (item.checked ? 'checked' : '') + ' style="margin-top:4px;width:16px;height:16px;accent-color:var(--sage);flex-shrink:0;">'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">'
        + '<div style="font-size:13px;font-weight:500;color:' + (item.checked ? 'var(--ink)' : 'var(--mid-lt)') + ';">' + item.name + '</div>'
        + '<div style="font-size:14px;font-weight:600;' + amountColor + '">¥' + Math.abs(item.amount).toLocaleString() + (item.amount < 0 ? ' 値引' : '') + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + tagChips + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    const html = '<div style="padding:0 14px 80px;">'
      + '<div class="modal-handle" style="margin:0 auto 14px;"></div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<div style="font-family:var(--font-serif,serif);font-size:15px;font-weight:600;">レシート確認</div>'
      + '<button id="btn-receipt-cancel" style="width:30px;height:30px;border-radius:50%;background:var(--mist);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">'
      + '<svg viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
      + '</div>'
      // 店名・日付
      + '<div style="background:var(--stone);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">'
      + '<div style="font-size:13px;font-weight:600;">' + (store || '店名不明') + '</div>'
      + '<input type="date" id="receipt-date" value="' + receiptDate + '" style="font-size:12px;border:none;background:transparent;color:var(--sage-dk);font-weight:500;">'
      + '</div>'
      // 口座選択
      + '<div id="btn-receipt-acct" style="background:var(--stone);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;">'
      + '<div style="font-size:12px;color:var(--mid);">口座</div>'
      + '<div style="font-size:13px;font-weight:500;color:var(--sage-dk);">' + acctName(selectedAccountId) + ' ›</div>'
      + '</div>'
      // 品目リスト
      + '<div style="margin-bottom:12px;">' + itemRows + '</div>'
      // 合計
      + '<div style="display:flex;justify-content:space-between;padding:8px 0;margin-bottom:4px;border-top:2px solid var(--sage-lt);">'
      + '<div style="font-size:13px;font-weight:600;">合計 ' + checkedItems.length + '件</div>'
      + '<div style="font-size:16px;font-weight:700;">¥' + total.toLocaleString() + '</div>'
      + '</div>'
      // 保存ボタン
      + '<div id="receipt-save-bar" style="position:fixed;bottom:0;left:0;right:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--stone);border-top:1px solid var(--mist);z-index:550;">'
      + '<button id="btn-receipt-save" style="width:100%;padding:14px;border-radius:14px;background:var(--sage);color:#fff;font-size:15px;font-weight:700;border:none;cursor:pointer;">'
      + '✓ ' + checkedItems.length + '件を保存する（¥' + total.toLocaleString() + '）'
      + '</button>'
      + '</div>'
      + '</div>';

    modal.innerHTML = html;
    bindConfirmEvents();
  }

  function bindConfirmEvents() {
    document.getElementById('btn-receipt-cancel')?.addEventListener('click', closeReceipt);

    document.getElementById('receipt-date')?.addEventListener('change', e => {
      receiptDate = e.target.value;
    });

    document.getElementById('btn-receipt-acct')?.addEventListener('click', () => {
      // シンプルな口座選択シート
      const sheet = document.createElement('div');
      sheet.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--stone);border-radius:20px 20px 0 0;padding:16px;z-index:600;max-height:50vh;overflow-y:auto;';
      sheet.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:12px;text-align:center;">口座を選択</div>'
        + accounts.map(a => '<div class="acct-pick" data-id="' + a.id + '" style="padding:12px;border-radius:10px;margin-bottom:6px;background:' + (a.id === selectedAccountId ? 'var(--sage-bg)' : 'var(--mist)') + ';cursor:pointer;font-size:13px;">' + a.name + '</div>').join('');
      document.body.appendChild(sheet);
      sheet.querySelectorAll('.acct-pick').forEach(el => {
        el.addEventListener('click', () => {
          selectedAccountId = el.dataset.id;
          sheet.remove();
          renderConfirmUI();
        });
      });
    });

    // チェックボックス
    document.querySelectorAll('[data-item-check]').forEach(el => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.dataset.itemCheck);
        itemStates[idx].checked = el.checked;
        renderConfirmUI();
      });
    });

    // タグチップ
    document.querySelectorAll('.receipt-tag-chip').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.item);
        const tagId = el.dataset.tag;
        const item = itemStates[idx];
        // 主タグは排他
        if (budgetMap.has(tagId)) {
          item.tagIds.forEach(tid => { if (budgetMap.has(tid)) item.tagIds.delete(tid); });
        }
        if (item.tagIds.has(tagId)) item.tagIds.delete(tagId);
        else item.tagIds.add(tagId);
        renderConfirmUI();
      });
    });

    // 保存
    document.getElementById('btn-receipt-save')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-receipt-save');
      if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

      const checkedItems = itemStates.filter(i => i.checked && i.amount !== 0);
      if (checkedItems.length === 0) { showToast('保存する品目を選択してください'); return; }

      try {
        const savedTxs = [];
        for (const item of checkedItems) {
          const absAmount = Math.abs(item.amount);
          if (absAmount === 0) continue;
          const payload = {
            type:       item.amount < 0 ? 'income' : 'expense',
            amount:     absAmount,
            date:       receiptDate,
            account_id: selectedAccountId,
            memo:       item.name,
          };
          const tagIds = [...item.tagIds];
          const tx = await DB.createTransaction(payload, tagIds);
          const cachedTags = tags.filter(t => tagIds.includes(t.id));
          savedTxs.push({ ...tx, tags: cachedTags });
        }

        await upsertTransactions(savedTxs);
        closeReceipt();
        showToast('✓ ' + savedTxs.length + '件を保存しました');

        // 最後の1件をonSaveに渡す（ホーム画面更新用）
        if (onSave && savedTxs.length > 0) onSave(savedTxs[savedTxs.length - 1]);

      } catch (err) {
        showToast('保存エラー: ' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = '✓ 保存する'; }
      }
    });
  }

  // モーダルに確認UIをレンダリング
  renderConfirmUI();
}
