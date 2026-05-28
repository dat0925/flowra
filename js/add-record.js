// ─────────────────────────────────────
//  add-record.js  記録追加モーダル
// ─────────────────────────────────────
import { DB }        from './db.js';
import { Sound }     from './sound.js';
import { openModal, closeModal, showToast } from './utils.js';
import { getCachedTransactions } from './cache.js';

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

export async function renderAddRecord(onSave, onReady, initialState = {}) {
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
    ...initialState,
    // selectedTagsはSetで上書き
    selectedTags: initialState.selectedTags
      ? new Set(initialState.selectedTags)
      : new Set(),
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
            : tags.map((t, i) => {
                const isSelected = state.selectedTags.has(t.id);
                const selectedArr = [...state.selectedTags];
                const isPrimary = isSelected && selectedArr[0] === t.id;
                return `<div class="tag-chip ${isSelected ? 'on' : 'off'}" data-tag-id="${t.id}" style="position:relative;">
                  ${isPrimary ? '<span style="position:absolute;top:-5px;right:-5px;background:var(--sage-dk);color:#fff;font-size:8px;padding:1px 4px;border-radius:4px;font-weight:600;">主</span>' : ''}
                  ${t.name}
                </div>`;
              }).join('')
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
          <!-- ホームと同じ構造：ラベル→金額→式 -->
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
          <!-- 式表示：サブテキスト（ホームの「全口座合計」と同じ位置） -->
          <div id="calc-expr" class="amount-card-sub"></div>
          <!-- 電卓ボタン -->
          <div style="display:flex;gap:6px;margin-top:12px;">
            <button id="calc-ac-btn"
              style="flex:1;padding:7px 0;border-radius:8px;border:none;
              background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.35);
              font-size:13px;font-weight:600;cursor:pointer;
              font-family:'Noto Sans JP',sans-serif;transition:background 0.12s;">
              AC
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
                <div class="toggle-title" style="display:flex;align-items:center;gap:5px;">
                  未精算
                  <span id="unsettled-help" style="width:15px;height:15px;border-radius:50%;
                    background:var(--mist);color:var(--mid);font-size:10px;font-weight:600;
                    display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
                    flex-shrink:0;">?</span>
                </div>
                <div class="toggle-sub">立替など後で精算が必要</div>
              </div>
            </div>
            <div class="toggle ${state.isUnsettled?'on':''}" id="toggle-unsettled">
              <div class="toggle-knob"></div>
            </div>
          </div>
          ${!localStorage.getItem('flowra-unsettled-seen') ? `
          <div id="unsettled-onboarding" style="margin-top:8px;padding:10px 12px;
            background:var(--gold-bg);border-radius:10px;border-left:3px solid var(--gold);">
            <div style="font-size:12px;color:var(--ink);line-height:1.6;">
              友人への立替や共有費用など、後で精算が必要な支出につけるフラグです。
              記録一覧で未精算のものだけ絞り込めます。
            </div>
          </div>` : ''}
        </div>

        <!-- 保存・キャンセルはキーボード上部のsave-barに移動 -->
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

    // save-bar（キーボード上部固定バー）を表示
    const saveBar = document.getElementById('save-bar');
    if (saveBar) {
      saveBar.hidden = false;
      document.getElementById('save-bar-btn')?.addEventListener('click', save);
      document.getElementById('save-bar-cancel')?.addEventListener('click', () => {
        saveBar.hidden = true;
        closeModal();
      });
    }

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
        bindTags();
      });
    });

    // ── 金額 + インライン電卓 ──────────────────
    // 計算状態
    let calcLeft = '';   // 左辺の値
    let calcOp   = '';   // 演算子

    const amountInput = document.getElementById('amount-input');
    const exprEl      = document.getElementById('calc-expr');

    // キャレットを末尾に移動
    function moveCursorToEnd(el) {
      el.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // 桁数に応じてフォントサイズを調整（ホーム画面の金額表示34pxに合わせる）
    function adjustFontSize(digits) {
      if (digits <= 9) amountInput.style.fontSize = '34px';
      else             amountInput.style.fontSize = '28px';
    }

    // 数値をコンマ付きで表示
    function displayAmount(raw) {
      const n = parseInt(String(raw).replace(/,/g,''), 10);
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

    // 計算式表示を更新
    function updateExpr() {
      if (calcLeft && calcOp) {
        exprEl.textContent = `¥${Number(calcLeft).toLocaleString('ja-JP')} ${calcOp}`;
      } else {
        exprEl.textContent = '';
      }
    }

    // 初期表示時にフォントサイズを設定
    const initDigits = (state.amount || '').length;
    if (initDigits > 0) adjustFontSize(initDigits);

    // contenteditable入力ハンドラ
    amountInput?.addEventListener('input', () => {
      let raw = amountInput.textContent.replace(/,/g,'').replace(/[^0-9]/g,'');
      // 演算子押下後の最初の入力でクリア
      if (waitingForNextInput) {
        waitingForNextInput = false;
        // 最後の1文字だけ残す
        raw = raw.slice(-1);
        amountInput.textContent = raw;
      }
      state.amount = raw;
      if (raw) {
        const formatted = Number(raw).toLocaleString('ja-JP');
        amountInput.textContent = formatted;
        adjustFontSize(raw.length);
        moveCursorToEnd(amountInput);
      } else {
        amountInput.textContent = '';
        adjustFontSize(0);
      }
    });

    // Enterキーで改行させない
    amountInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') e.preventDefault();
    });

    // 演算子ボタン
    let waitingForNextInput = false; // 次の入力でクリアするフラグ
    document.querySelectorAll('.calc-op-btn').forEach(btn => {
      // mousedownでフォーカスを奪わない（キーボードを閉じない）
      btn.addEventListener('mousedown', e => e.preventDefault());
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

        // 即クリアせず「次の入力が来たらクリア」フラグを立てる
        waitingForNextInput = true;
        // キーボードが出ていない場合は自動で表示
        moveCursorToEnd(amountInput);
        Sound.playTap();
      });
    });

    // ＝ボタン：計算結果を表示、式はそのまま残す
    document.getElementById('calc-eq-btn')?.addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('calc-eq-btn')?.addEventListener('click', () => {
      if (!calcLeft || !calcOp) return;
      const right = Number(state.amount || '0');
      const result = calculate(Number(calcLeft), right, calcOp);
      // 式を残すため exprEl のテキストを計算式として固定表示
      const exprText = `¥${Number(calcLeft).toLocaleString('ja-JP')} ${calcOp} ¥${Number(right).toLocaleString('ja-JP')} ＝ ¥${result.toLocaleString('ja-JP')}`;
      displayAmount(result);
      calcLeft = '';
      calcOp   = '';
      // updateExprは呼ばない（式を残す）
      exprEl.textContent = exprText;
      Sound.playTap();
    });

    // ACボタン（全クリア）
    document.getElementById('calc-ac-btn')?.addEventListener('mousedown', e => e.preventDefault());
    document.getElementById('calc-ac-btn')?.addEventListener('click', () => {
      calcLeft = '';
      calcOp   = '';
      displayAmount('');
      updateExpr();
      moveCursorToEnd(amountInput);
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

    // タグ（render後に再バインドできるよう関数化）
    function bindTags() {
      document.querySelectorAll('.tag-chip[data-tag-id]').forEach(chip => {
        chip.addEventListener('click', () => {
          const id = chip.dataset.tagId;
          if (state.selectedTags.has(id)) {
            state.selectedTags.delete(id);
            chip.className = 'tag-chip off';
          } else {
            // 主タグは1つだけ（先頭に追加）
            state.selectedTags.add(id);
            chip.className = 'tag-chip on';
          }
          // 選択状態を全チップに反映
          document.querySelectorAll('.tag-chip[data-tag-id]').forEach(c => {
            c.className = 'tag-chip ' + (state.selectedTags.has(c.dataset.tagId) ? 'on' : 'off');
          });
          Sound.playTap();
        });
      });
    }
    bindTags();

    // 未精算トグル
    document.getElementById('toggle-unsettled')?.addEventListener('click', function() {
      state.isUnsettled = !state.isUnsettled;
      this.classList.toggle('on', state.isUnsettled);
      Sound.playTap();
    });

    // 未精算オンボーディング：3秒後に「見た」フラグを立てる
    const onboarding = document.getElementById('unsettled-onboarding');
    if (onboarding) {
      setTimeout(() => {
        localStorage.setItem('flowra-unsettled-seen', '1');
      }, 3000);
    }

    // ？ツールチップ
    document.getElementById('unsettled-help')?.addEventListener('click', e => {
      e.stopPropagation();
      showToast('友人への立替など後で精算が必要な支出につけるフラグです');
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
    const saveBar = document.getElementById('save-bar');
    if (saveBar) saveBar.hidden = true;
    closeModal();
    if (onSave) onSave(optimisticTx);

    // バックグラウンドで実際に保存
    try {
      const { upsertTransactions } = await import('./cache.js');
      const tagIds = [...state.selectedTags];
      console.log('saving tags:', tagIds);
      const tx = await DB.createTransaction(payload, tagIds);
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

  // initialStateが空（新規入力）の時はサジェストを表示
  const isNew = Object.keys(initialState).length === 0;
  const skipSuggest = initialState._skipSuggest;
  if (isNew || skipSuggest) {
    if (!skipSuggest) {
      await showSuggest(onSave, onReady, accounts, tags);
      return;
    }
  }

  openModal('');
  render();

  // アニメーションをリセットして再トリガー（サジェストから遷移時にanimationendが発火しない問題対策）
  const sheet = document.getElementById('modal-add-record');
  if (sheet) {
    sheet.style.animation = 'none';
    sheet.offsetHeight; // reflow
    sheet.style.animation = '';
  }

  // モーダルアニメーション完了後にカーソルを金額欄へ
  const doFocus = () => {
    setTimeout(() => {
      (() => { const el = document.getElementById('amount-input'); if(el){ el.focus(); const r=document.createRange(),s=window.getSelection(); r.selectNodeContents(el); r.collapse(false); s.removeAllRanges(); s.addRange(r); } })();
      if (onReady) onReady();
    }, 200);
  };
  if (sheet) {
    sheet.addEventListener('animationend', doFocus, { once: true });
  } else {
    setTimeout(doFocus, 300);
  }
}

// ── サジェスト画面 ──
async function showSuggest(onSave, onReady, accounts, tags) {
  // 直近トランザクションから重複排除して5件取得
  const all = await getCachedTransactions();
  // メモ+金額+typeで重複排除（同じ内容の直近1件だけ残す）
  const seen = new Set();
  const recent = [];
  for (const tx of all) {
    if (tx.type === 'transfer') continue; // 移動は除外
    const key = `${tx.type}|${tx.amount}|${tx.memo || ''}|${tx.account_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      recent.push(tx);
      if (recent.length >= 5) break;
    }
  }

  const typeIcon = { income: '↑', expense: '↓' };
  const typeColor = { income: 'var(--sage)', expense: 'var(--red)' };
  const acctName = (id) => accounts.find(a => a.id === id)?.name || '';

  const suggestHTML = recent.length === 0 ? '' : `
    <div style="padding:0 20px 4px;">
      <div style="font-size:11px;color:var(--mid-lt);margin-bottom:8px;letter-spacing:0.05em;">最近の記録から選ぶ</div>
      ${recent.map(tx => `
        <button class="suggest-item" data-id="${tx.id}"
          style="width:100%;display:flex;align-items:center;gap:12px;
          padding:10px 12px;border-radius:10px;border:none;background:var(--stone);
          cursor:pointer;margin-bottom:6px;text-align:left;transition:background 0.12s;">
          <span style="font-size:13px;color:${typeColor[tx.type]};font-weight:600;width:12px;">${typeIcon[tx.type]}</span>
          <span style="flex:1;min-width:0;">
            <span style="font-size:14px;font-weight:500;color:var(--ink);display:block;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${tx.memo || '（メモなし）'}
            </span>
            <span style="font-size:11px;color:var(--mid-lt);">${acctName(tx.account_id)}</span>
          </span>
          <span style="font-size:15px;font-weight:600;color:${typeColor[tx.type]};white-space:nowrap;">
            ¥${Number(tx.amount).toLocaleString('ja-JP')}
          </span>
        </button>
      `).join('')}
      <div style="display:flex;align-items:center;gap:8px;margin:12px 0 8px;">
        <div style="flex:1;height:1px;background:var(--border);"></div>
        <span style="font-size:11px;color:var(--mid-lt);">または新規入力</span>
        <div style="flex:1;height:1px;background:var(--border);"></div>
      </div>
    </div>`;

  // カテゴリアイコン定義
  const CATEGORY_ICONS = {
    '食費':       { bg:'#E8F2ED', stroke:'#5C8C72', path:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z' },
    '日用品':     { bg:'#E8EDF2', stroke:'#5C7A8C', path:'M6 2l1.5 4.5h9L18 2M3 9h18v2H3zm2 4h14v9H5z' },
    '住居':       { bg:'#EEE8E0', stroke:'#8C7A5C', path:'M3 9.5L12 3l9 6.5V21H3V9.5zM9 21v-6h6v6' },
    '光熱・水道': { bg:'#F2EDE0', stroke:'#8C7A4A', path:'M12 2a7 7 0 017 7c0 3.87-3.13 7-7 7S5 12.87 5 9a7 7 0 017-7zm0 12v4m-3 2h6' },
    '通信費':     { bg:'#E8E8F2', stroke:'#5C5C8C', path:'M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2zm-5 17a1 1 0 110-2 1 1 0 010 2z' },
    'サブスク':   { bg:'#EDE8F2', stroke:'#7A5C8C', path:'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z' },
    '交通費':     { bg:'#E8F2EE', stroke:'#5C8C7A', path:'M17 8H7l-2 8h14l-2-8zm-9 8v3m8-3v3M3 8h18M8 8V5a2 2 0 014 0v3' },
    '車':         { bg:'#EEF2E8', stroke:'#7A8C5C', path:'M5 17H3v-7l2-5h14l2 5v7h-2m-1 0H7m0 0a2 2 0 104 0m6 0a2 2 0 10-4 0' },
    '医療・健康': { bg:'#F2E8E8', stroke:'#8C5C5C', path:'M12 2a10 10 0 100 20A10 10 0 0012 2zm1 14h-2v-4H7v-2h4V6h2v4h4v2h-4v4z' },
    '保険料':     { bg:'#F2EDE8', stroke:'#8C7A5C', path:'M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7l-9-5z' },
    '教育':       { bg:'#E8EEF2', stroke:'#5C7A8C', path:'M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-7 9.84V17l7 4 7-4v-4.16L12 17l-7-4.16z' },
    '娯楽・趣味': { bg:'#EEE8F2', stroke:'#7A5C8C', path:'M14.5 2.5c0 1.5-1.5 7-1.5 7h-2S9 4 9 2.5a2.5 2.5 0 015 0zM12 11a1 1 0 110 2 1 1 0 010-2zm-7 9l2-9h10l2 9H5z' },
    '服・美容':   { bg:'#F2E8EE', stroke:'#8C5C7A', path:'M20.38 8.57l-1.23 1.85a8 8 0 01-.22 7.58H5.07A8 8 0 0115.58 6.85l2.8-1.23 2 3z' },
  };

  // カテゴリグリッドHTML生成
  const categoryTags = tags.filter(t => CATEGORY_ICONS[t.name]);
  const otherTags = tags.filter(t => !CATEGORY_ICONS[t.name]);

  const categoryGridHTML = categoryTags.length === 0 ? '' : `
    <div style="padding:0 16px 4px;">
      <div style="font-size:11px;color:var(--mid-lt);margin-bottom:10px;letter-spacing:0.05em;">カテゴリから始める</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
        ${categoryTags.map(tag => {
          const icon = CATEGORY_ICONS[tag.name];
          return `<button class="suggest-cat-btn" data-tag-id="${tag.id}"
            style="display:flex;flex-direction:column;align-items:center;gap:5px;
            padding:10px 4px;border-radius:12px;border:none;background:var(--stone);
            cursor:pointer;transition:background 0.12s;">
            <div style="width:40px;height:40px;border-radius:50%;background:${icon.bg};
              display:flex;align-items:center;justify-content:center;">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                stroke="${icon.stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="${icon.path}"/>
              </svg>
            </div>
            <span style="font-size:10px;color:var(--ink);font-weight:500;
              text-align:center;line-height:1.3;word-break:keep-all;">${tag.name}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;

  // モーダルにサジェスト+カテゴリ+新規入力ボタンを表示
  const overlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  modalContent.innerHTML = `
    <div style="padding:20px 0 8px;">
      <div style="font-size:16px;font-weight:600;color:var(--ink);padding:0 20px 16px;">記録を追加</div>
      ${categoryGridHTML}
      ${categoryGridHTML && suggestHTML ? `<div style="display:flex;align-items:center;gap:8px;margin:12px 16px 4px;">
        <div style="flex:1;height:1px;background:var(--border);"></div>
        <span style="font-size:11px;color:var(--mid-lt);">最近の記録</span>
        <div style="flex:1;height:1px;background:var(--border);"></div>
      </div>` : ''}
      ${suggestHTML}
      <div style="padding:4px 20px 8px;">
        <button id="suggest-new-btn"
          style="width:100%;padding:14px;border-radius:14px;border:1.5px solid var(--border);
          background:none;color:var(--ink);font-family:'Noto Sans JP',sans-serif;
          font-size:14px;font-weight:500;cursor:pointer;transition:background 0.12s;">
          ＋ 新しく入力する
        </button>
      </div>
    </div>`;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  Sound.playOpen();

  // カテゴリボタンをタップ → カテゴリを主タグとして追加画面へ
  document.querySelectorAll('.suggest-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dummy = document.getElementById('ios-focus-trick');
      dummy?.focus();
      const tagId = btn.dataset.tagId;
      overlay.hidden = true;
      document.body.style.overflow = '';
      renderAddRecord(onSave, () => {
        setTimeout(() => {
          const el = document.getElementById('amount-input');
          if (el) { el.focus(); const r=document.createRange(),s=window.getSelection(); r.selectNodeContents(el); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
        }, 50);
      }, { _skipSuggest: true, selectedTags: [tagId] });
    });
  });

  // サジェストアイテムをタップ
  document.querySelectorAll('.suggest-item').forEach(btn => {
    btn.addEventListener('click', () => {
      // ユーザー操作タイミングでiOSキーボード権限を取得
      const dummy = document.getElementById('ios-focus-trick');
      dummy?.focus();
      const txId = btn.dataset.id;
      const tx = all.find(t => t.id === txId);
      if (!tx) return;
      const memo = tx.memo ? tx.memo + '（複製）' : '（複製）';
      const state = {
        type:        tx.type,
        amount:      String(tx.amount),
        date:        new Date().toISOString().slice(0, 10),
        accountId:   tx.account_id,
        toAccountId: tx.to_account_id || '',
        memo,
        url:         tx.url || '',
        isUnsettled: false,
        selectedTags: (tx.tags || []).map(t => t.id),
      };
      overlay.hidden = true;
      document.body.style.overflow = '';
      renderAddRecord(onSave, null, state);
    });
  });

  // 新規入力ボタン
  document.getElementById('suggest-new-btn')?.addEventListener('click', () => {
    const dummy = document.getElementById('ios-focus-trick');
    dummy?.focus();
    overlay.hidden = true;
    document.body.style.overflow = '';
    renderAddRecord(onSave, () => {
      setTimeout(() => {
        (() => { const el = document.getElementById('amount-input'); if(el){ el.focus(); const r=document.createRange(),s=window.getSelection(); r.selectNodeContents(el); r.collapse(false); s.removeAllRanges(); s.addRange(r); } })();
      }, 50);
    }, { _skipSuggest: true });
  });
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
