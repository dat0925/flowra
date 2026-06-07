// ─────────────────────────────────────
//  edit-record.js  記録詳細・編集シート
//  タップ → ボトムシートで編集・削除
// ─────────────────────────────────────
import { DB }    from './db.js';
import { Sound } from './sound.js';
import { showToast, openModal, closeModal } from './utils.js';
import { upsertTransactions, markDeletedTransaction } from './cache.js';
import { renderAddRecord } from './add-record.js';

const TYPE_PATH = {
  cash:    '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>',
  bank:    '<path d="M3 22V8l9-6 9 6v14H3z"/><path d="M9 22V12h6v10"/>',
  ic:      '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6M9 10h6"/>',
  credit:  '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  savings: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  point:   '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  other:   '<rect x="2" y="5" width="20" height="14" rx="2"/>',
};
const TYPE_COLOR = {
  cash:'#7A9485', bank:'#3B6FBF', ic:'#4A7C59', qr:'#C4602A',
  credit:'#7B5EA7', savings:'#2F5239', point:'#B8973E', other:'#7A9485',
};
const TYPE_BG = {
  cash:'#F0EDE8', bank:'#EEF3FF', ic:'#EEF5F1', qr:'#FFF2EB',
  credit:'#F5F0FF', savings:'#EEF5F1', point:'#FBF5E6', other:'#F0EDE8',
};

function fmt(n) { return Number(n).toLocaleString('ja-JP'); }

function buildMetaHTML(tx, members) {
  function resolveUser(userId) {
    if (!userId) return null;
    const m = members.find(m => m.user_id === userId);
    return m?.full_name || m?.email?.split('@')[0] || null;
  }
  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  const creatorName = resolveUser(tx.created_by);
  const updaterName = resolveUser(tx.updated_by);
  const createdAt   = fmtDate(tx.created_at);
  const updatedAt   = fmtDate(tx.updated_at);

  // 作成者も更新者も不明なら非表示
  if (!creatorName && !updaterName) return '';

  const rows = [];
  if (createdAt) rows.push(`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:11px;color:var(--mid);">登録</span>
      <span style="font-size:11px;color:var(--mid-lt);">${creatorName ? `<span style="color:var(--mid);font-weight:500;">${creatorName}</span>　` : ''}${createdAt}</span>
    </div>`);
  if (updatedAt && tx.updated_by && tx.updated_by !== tx.created_by) rows.push(`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;">
      <span style="font-size:11px;color:var(--mid);">最終更新</span>
      <span style="font-size:11px;color:var(--mid-lt);">${updaterName ? `<span style="color:var(--mid);font-weight:500;">${updaterName}</span>　` : ''}${updatedAt}</span>
    </div>`);

  if (!rows.length) return '';
  return `<div style="margin-top:20px;padding:0 2px 4px;">${rows.join('')}</div>`;
}

export async function openEditRecord(tx, onSave) {
  // 楽観的UI中（仮ID）はまだ保存中なので編集不可
  if (tx.id && String(tx.id).startsWith('optimistic-')) {
    showToast('保存中です。少し待ってから開いてください');
    return;
  }

  // 最新の口座・タグを取得
  let accounts = [], tags = [], myRole = 'member', members = [];
  try {
    const teamId = await DB.getTeamId();
    [accounts, tags, myRole, members] = await Promise.all([
      DB.getAccounts(), DB.getTags(), DB.getMyRole(),
      DB.getTeamMemberProfilesForTeam(teamId).catch(() => [])
    ]);
  } catch (e) {
    showToast('データ取得エラー: ' + e.message);
    return;
  }
  const isViewer = myRole === 'viewer';

  // sort_orderで並べて主タグが先頭になるようにする
  const txTags = (tx.tags || []).filter(t => t).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  let state = {
    type:         tx.type,
    amount:       String(tx.amount),
    date:         tx.date,
    accountId:    tx.account_id,
    toAccountId:  tx.to_account_id || (accounts[1]?.id || ''),
    memo:         tx.memo || '',
    url:          tx.url  || '',
    isUnsettled:  tx.is_unsettled || false,
    selectedTags: new Set(txTags.map(t => t.id)),
  };

  Sound.playOpen();

  const sheetId = 'edit-record-sheet';
  document.getElementById(sheetId)?.remove();

  const sheet = document.createElement('div');
  sheet.id = sheetId;
  sheet.style.cssText = `
    position:fixed;inset:0;z-index:600;
    background:rgba(28,43,34,0.5);
    display:flex;align-items:flex-end;justify-content:center;
  `;
  document.body.appendChild(sheet);

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
            <div class="row-value">${acctName(state.accountId)}</div>
          </div>
          <div class="row-chevron"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
        </div>
      </div>`;

    sheet.innerHTML = `
      <div style="background:var(--stone);width:100%;max-width:480px;
        border-radius:20px 20px 0 0;max-height:92vh;overflow-y:auto;
        padding:0 14px 120px;-webkit-overflow-scrolling:touch;">

        <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 0;"></div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 4px 12px;">
          <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">${isViewer ? '記録を表示' : '記録を編集'}</div>
          <button id="btn-close-edit-record"
            style="width:30px;height:30px;border-radius:50%;background:var(--mist);border:none;
            display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
            <svg viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- 種別 -->
        <div class="type-selector" style="margin-bottom:14px;">
          <button class="type-btn ${state.type==='income'?'active-income':''}" id="btn-income" ${isViewer?'disabled style="pointer-events:none;opacity:0.6;"':''}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>収入
          </button>
          <button class="type-btn ${state.type==='expense'?'active-expense':''}" id="btn-expense" ${isViewer?'disabled style="pointer-events:none;opacity:0.6;"':''}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>支出
          </button>
          <button class="type-btn ${state.type==='transfer'?'active-transfer':''}" id="btn-transfer" ${isViewer?'disabled style="pointer-events:none;opacity:0.6;"':''}>
            <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>移動
          </button>
        </div>

        <!-- 金額 -->
        <div class="amount-card ${state.type}">
          <div class="amount-card-label">金額</div>
          <div class="amount-row">
            <div class="amount-row-inner">
              <span class="amount-currency">¥</span>
              <div class="amount-input" id="amount-input"
                contenteditable="true" inputmode="numeric"
                data-placeholder="0" spellcheck="false">${state.amount ? Number(state.amount).toLocaleString('ja-JP') : ''}</div>
            </div>
          </div>
          <div id="calc-expr" class="amount-card-sub"></div>
          <div style="display:flex;gap:6px;margin-top:12px;">
            <button id="calc-ac-btn"
              style="flex:1;padding:7px 0;border-radius:8px;border:none;
              background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.35);
              font-size:13px;font-weight:600;cursor:pointer;font-family:'Noto Sans JP',sans-serif;">AC</button>
            ${['+','−','×','÷'].map(op => `
              <button class="calc-op-btn" data-op="${op}"
                style="flex:1;padding:7px 0;border-radius:8px;border:none;
                background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);
                font-size:18px;font-weight:500;cursor:pointer;font-family:'Noto Sans JP',sans-serif;">${op}</button>`).join('')}
            <button id="calc-eq-btn"
              style="flex:1;padding:7px 0;border-radius:8px;border:none;
              background:var(--sage-lt);color:#fff;font-size:18px;font-weight:600;cursor:pointer;
              font-family:'Noto Sans JP',sans-serif;">＝</button>
          </div>
        </div>

        <!-- 口座 -->
        ${accountSection}

        <!-- 日付・メモ・URL -->
        <div class="form-section" style="margin-bottom:12px;">
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
              <input class="text-input" id="memo-input" type="text"
                placeholder="メモを入力（任意）" value="${state.memo}">
            </div>
          </div>
          <div class="form-row no-tap">
            <div class="row-icon" style="background:#F0EDE8;">
              <svg viewBox="0 0 24 24" style="stroke:var(--mid)"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </div>
            <div class="row-body">
              <div class="row-label">URL</div>
              <input class="text-input" id="url-input" type="url"
                placeholder="https://... （任意）" value="${state.url}">
            </div>
          </div>
        </div>

        <!-- タグ -->
        <div class="form-section" style="margin-bottom:12px;">
          <div style="padding:10px 18px 4px;display:flex;align-items:center;gap:6px;">
            <span style="font-size:12px;color:var(--mid);font-weight:500;">タグ</span>
          </div>
          <div class="tags-wrap" style="padding-top:6px;">
            ${tags.length === 0
              ? `<div style="font-size:12.5px;color:var(--mid-lt);padding:4px 0 8px;">タグがありません</div>`
              : (() => {
                  const selectedArr = [...state.selectedTags];
                  return tags.map(t => {
                    const isSelected = state.selectedTags.has(t.id);
                    const isPrimary = isSelected && selectedArr[0] === t.id;
                    return `<div class="tag-chip ${isSelected?'on':'off'}" data-tag-id="${t.id}" style="position:relative;">
                      ${isPrimary ? '<span class="primary-badge" style="position:absolute;top:-5px;right:-5px;background:var(--sage-dk);color:#fff;font-size:8px;padding:1px 4px;border-radius:4px;font-weight:600;">主</span>' : ''}
                      ${t.name}
                    </div>`;
                  }).join('');
                })()
            }
          </div>
        </div>

        <!-- 未精算 -->
        <div class="form-section" style="margin-bottom:20px;">
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
        </div>

        <!-- 保存・キャンセルはfixed save-barに移動 -->

        <!-- 登録者・更新者メタ情報 -->
        ${buildMetaHTML(tx, members)}

        <!-- 複製・削除（viewerには非表示） -->
        ${isViewer ? `
        <div style="margin-top:24px;padding:14px;border-radius:12px;background:var(--mist);text-align:center;">
          <div style="font-size:12px;color:var(--mid);">閲覧のみ権限のため編集・削除できません</div>
        </div>
        ` : `
        <button id="btn-duplicate-record"
          style="width:100%;padding:12px;border-radius:14px;margin-top:8px;
          border:1.5px solid var(--border);background:none;
          color:var(--mid);font-family:'Noto Sans JP',sans-serif;
          font-size:13.5px;font-weight:500;cursor:pointer;
          display:flex;align-items:center;justify-content:center;gap:6px;
          transition:all 0.15s;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          この記録を複製する
        </button>

        <!-- 削除（十分な余白と分離） -->
        <div style="margin-top:48px;padding-top:20px;border-top:1px solid var(--border);">
          <div style="font-size:11px;color:var(--mid-lt);text-align:center;margin-bottom:12px;">危険な操作</div>
          <button id="btn-delete-record"
            style="width:100%;padding:12px;border-radius:14px;
            border:1.5px solid var(--border);background:none;
            color:var(--mid);font-family:'Noto Sans JP',sans-serif;
            font-size:13.5px;font-weight:500;cursor:pointer;
            transition:all 0.15s;">
            この記録を削除する
          </button>
        </div>
        `}
      </div>`;

    bindEvents();
  }

  function bindEvents() {
    const closeSheet = () => {
      const saveBar = document.getElementById('save-bar');
      if (saveBar) saveBar.hidden = true;
      Sound.playClose();
      sheet.remove();
    };
    sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
    sheet.querySelector('#btn-close-edit-record')?.addEventListener('click', closeSheet);

    // 種別
    ['income','expense','transfer'].forEach(t => {
      sheet.querySelector('#btn-' + t)?.addEventListener('click', () => {
        state.type = t;
        render();
      });
    });

    // ── 金額 + インライン電卓 ──
    let calcLeft = '';
    let calcOp   = '';
    let waitingForNextInput = false;

    const amountInput = sheet.querySelector('#amount-input');
    const exprEl      = sheet.querySelector('#calc-expr');

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
      const n = parseInt(String(raw).replace(/,/g,''), 10);
      if (!isNaN(n) && n > 0) {
        amountInput.textContent = n.toLocaleString('ja-JP');
        state.amount = String(n);
        adjustFontSize(String(n).length);
      } else {
        amountInput.textContent = '';
        state.amount = '';
      }
    }

    function updateExpr() {
      if (calcLeft && calcOp && exprEl) {
        exprEl.textContent = `¥${Number(calcLeft).toLocaleString('ja-JP')} ${calcOp}`;
      } else if (exprEl) {
        exprEl.textContent = '';
      }
    }

    // 初期フォントサイズ
    adjustFontSize((state.amount || '').length);

    amountInput?.addEventListener('input', () => {
      let raw = amountInput.textContent.replace(/,/g,'').replace(/[^0-9]/g,'');
      if (waitingForNextInput) {
        waitingForNextInput = false;
        raw = raw.slice(-1);
        amountInput.textContent = raw;
      }
      state.amount = raw;
      if (raw) {
        amountInput.textContent = Number(raw).toLocaleString('ja-JP');
        adjustFontSize(raw.length);
        moveCursorToEnd(amountInput);
      } else {
        amountInput.textContent = '';
      }
    });

    amountInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') e.preventDefault();
    });

    // ACボタン
    sheet.querySelector('#calc-ac-btn')?.addEventListener('mousedown', e => e.preventDefault());
    sheet.querySelector('#calc-ac-btn')?.addEventListener('click', () => {
      calcLeft = ''; calcOp = ''; waitingForNextInput = false;
      displayAmount(''); updateExpr();
      moveCursorToEnd(amountInput);
    });

    sheet.querySelectorAll('.calc-op-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => {
        const cur = state.amount || '0';
        if (!cur || cur === '0') return;
        if (calcLeft && calcOp) {
          const result = calcFn(Number(calcLeft), Number(cur), calcOp);
          displayAmount(result);
          calcLeft = String(result);
        } else {
          calcLeft = cur;
        }
        calcOp = btn.dataset.op;
        updateExpr();
        waitingForNextInput = true;
        // キーボードが出ていない場合は自動で表示
        moveCursorToEnd(amountInput);
        Sound.playTap();
      });
    });

    sheet.querySelector('#calc-eq-btn')?.addEventListener('mousedown', e => e.preventDefault());
    sheet.querySelector('#calc-eq-btn')?.addEventListener('click', () => {
      if (!calcLeft || !calcOp) return;
      const right = Number(state.amount || '0');
      const result = calcFn(Number(calcLeft), right, calcOp);
      const exprText = `¥${Number(calcLeft).toLocaleString('ja-JP')} ${calcOp} ¥${right.toLocaleString('ja-JP')} ＝ ¥${result.toLocaleString('ja-JP')}`;
      displayAmount(result);
      calcLeft = ''; calcOp = '';
      if (exprEl) exprEl.textContent = exprText;
      Sound.playTap();
    });

    sheet.querySelector('#date-input')?.addEventListener('change',  e => state.date   = e.target.value);
    sheet.querySelector('#memo-input')?.addEventListener('input',   e => state.memo   = e.target.value);
    sheet.querySelector('#url-input')?.addEventListener('input',    e => state.url    = e.target.value);

    // 口座選択
    sheet.querySelector('#btn-acct')?.addEventListener('click', () => {
      showAccountPicker(accounts, state.accountId, id => { state.accountId = id; render(); });
    });
    sheet.querySelector('#btn-from-acct')?.addEventListener('click', () => {
      showAccountPicker(accounts, state.accountId, id => { state.accountId = id; render(); });
    });
    sheet.querySelector('#btn-to-acct')?.addEventListener('click', () => {
      showAccountPicker(accounts, state.toAccountId, id => { state.toAccountId = id; render(); });
    });

    // タグ（render後に再バインドできるよう関数化）
    function bindTags() {
      sheet.querySelectorAll('.tag-chip[data-tag-id]').forEach(chip => {
        chip.addEventListener('click', () => {
          const id = chip.dataset.tagId;
          if (state.selectedTags.has(id)) {
            state.selectedTags.delete(id);
          } else {
            state.selectedTags.add(id);
          }
          // 全チップの表示を更新
          sheet.querySelectorAll('.tag-chip[data-tag-id]').forEach(c => {
            const sel = state.selectedTags.has(c.dataset.tagId);
            const isPrimary = sel && [...state.selectedTags][0] === c.dataset.tagId;
            c.className = 'tag-chip ' + (sel ? 'on' : 'off');
            c.style.background = '';
            c.style.color = '';
            c.style.borderColor = '';
            c.style.position = 'relative';
            const existing = c.querySelector('.primary-badge');
            if (existing) existing.remove();
            if (isPrimary) {
              const badge = document.createElement('span');
              badge.className = 'primary-badge';
              badge.style.cssText = 'position:absolute;top:-5px;right:-5px;background:var(--sage-dk);color:#fff;font-size:8px;padding:1px 4px;border-radius:4px;font-weight:600;';
              badge.textContent = '主';
              c.appendChild(badge);
            }
          });
          Sound.playTap();
        });
      });
    }
    bindTags();

    // ？ツールチップ
    sheet.querySelector('#unsettled-help')?.addEventListener('click', e => {
      e.stopPropagation();
      showToast('友人への立替など後で精算が必要な支出につけるフラグです');
    });

    // 未精算トグル
    sheet.querySelector('#toggle-unsettled')?.addEventListener('click', function() {
      state.isUnsettled = !state.isUnsettled;
      this.classList.toggle('on', state.isUnsettled);
      Sound.playTap();
    });

    // 保存
    // save-barを表示（キーボード上部固定）：viewerは非表示
    const saveBar = document.getElementById('save-bar');
    if (saveBar) {
      if (isViewer) {
        saveBar.hidden = true;
      } else {
        saveBar.hidden = false;
        // 保存ボタン
        const saveBarBtn = document.getElementById('save-bar-btn');
        if (saveBarBtn) {
          const newSaveBtn = saveBarBtn.cloneNode(true);
          saveBarBtn.parentNode.replaceChild(newSaveBtn, saveBarBtn);
          newSaveBtn.addEventListener('click', () => {
            doSave();
          });
        }
        // キャンセルボタン
        const saveBarCancel = document.getElementById('save-bar-cancel');
        if (saveBarCancel) {
          const newCancelBtn = saveBarCancel.cloneNode(true);
          saveBarCancel.parentNode.replaceChild(newCancelBtn, saveBarCancel);
          newCancelBtn.addEventListener('click', () => {
            saveBar.hidden = true;
            closeSheet();
          });
        }
      }
    }

    sheet.querySelector('#btn-cancel-edit')?.addEventListener('click', () => {
      if (saveBar) saveBar.hidden = true;
      closeSheet();
    });

    sheet.querySelector('#btn-duplicate-record')?.addEventListener('click', () => {
      // 今日の日付
      const today = new Date().toISOString().split('T')[0];
      // メモに（複製）を追加
      const memo = tx.memo ? tx.memo + '（複製）' : '（複製）';
      // 元の記録からstateを構築
      const initialState = {
        type:         tx.type,
        amount:       String(tx.amount),
        date:         today,
        accountId:    tx.account_id,
        toAccountId:  tx.to_account_id || '',
        memo:         memo,
        url:          tx.url || '',
        isUnsettled:  false,
        isRecurring:  false,
        selectedTags: (tx.tags || []).map(t => t.id),
      };
      closeSheet();
      // 複製内容で追加画面を開く
      renderAddRecord(
        (savedTx) => {
          closeModal();
          showToast('✓ 複製して保存しました');
          if (onSave) onSave(savedTx);
        },
        null,
        initialState
      );
    });

    async function doSave() {
      const amount = parseInt(state.amount, 10);
      if (!amount || amount <= 0) { showToast('金額を入力してください'); return; }
      if (!state.date)             { showToast('日付を入力してください'); return; }
      if (!state.accountId)        { showToast('口座を選択してください'); return; }
      if (state.type === 'transfer' && state.accountId === state.toAccountId) {
        showToast('移動元と移動先が同じです'); return;
      }

      const payload = {
        type:          state.type,
        amount,
        date:          state.date,
        account_id:    state.accountId,
        to_account_id: state.type === 'transfer' ? state.toAccountId : null,
        memo:          state.memo  || null,
        url:           state.url   || null,
        is_unsettled:  state.isUnsettled,
      };

      try {
        const updated = await DB.updateTransaction(tx.id, payload, [...state.selectedTags]);
        await upsertTransactions([{ ...updated, tags: [] }]);
        Sound.playSave();
        const saveBar = document.getElementById('save-bar');
        if (saveBar) saveBar.hidden = true;
        sheet.remove();
        if (onSave) onSave();
      } catch (e) {
        showToast('⚠️ 保存に失敗しました: ' + e.message);
      }
    }

    // 削除（2段階確認）
    sheet.querySelector('#btn-delete-record')?.addEventListener('click', function() {
      const btn = this;
      if (btn.dataset.confirmed === 'true') return;

      btn.textContent = '本当に削除しますか？もう一度タップで削除';
      btn.style.borderColor = 'var(--red)';
      btn.style.color = 'var(--red)';
      btn.style.background = 'var(--red-bg)';
      btn.dataset.confirmed = 'pending';

      const timer = setTimeout(() => {
        btn.textContent = 'この記録を削除する';
        btn.style.borderColor = 'var(--border)';
        btn.style.color = 'var(--mid)';
        btn.style.background = 'none';
        btn.dataset.confirmed = '';
      }, 3000);

      btn.addEventListener('click', async function handler() {
        if (btn.dataset.confirmed !== 'pending') return;
        btn.removeEventListener('click', handler);
        clearTimeout(timer);
        btn.dataset.confirmed = 'true';
        btn.textContent = '削除中…';
        btn.disabled = true;
        try {
          await DB.deleteTransaction(tx.id);
          await markDeletedTransaction(tx.id);
          Sound.playClose();
          const saveBar = document.getElementById('save-bar');
          if (saveBar) saveBar.hidden = true;
          sheet.remove();
          showToast('記録を削除しました');
          if (onSave) onSave();
        } catch (e) {
          showToast('削除エラー: ' + e.message);
          btn.disabled = false;
          btn.dataset.confirmed = '';
        }
      }, { once: true });
    });
  }

  render();
}

// 口座選択ピッカー（ボトムシート）
function showAccountPicker(accounts, currentId, callback) {
  const existing = document.getElementById('acct-picker-for-edit');
  existing?.remove();

  const s = document.createElement('div');
  s.id = 'acct-picker-for-edit';
  s.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(28,43,34,0.45);display:flex;align-items:flex-end;justify-content:center;';

  const itemsHTML = accounts.map(a => {
    const bg     = TYPE_BG[a.type]    || '#F0EDE8';
    const stroke = TYPE_COLOR[a.type] || '#7A9485';
    const path   = TYPE_PATH[a.type]  || TYPE_PATH.other;
    const sel    = a.id === currentId;
    return `
      <div class="acct-picker-item" data-id="${a.id}"
        style="display:flex;align-items:center;gap:13px;padding:13px 18px;cursor:pointer;
        border-bottom:1px solid var(--border);background:${sel?'var(--sage-bg)':'#fff'};">
        <div style="width:38px;height:38px;border-radius:11px;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
        </div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:500;">${a.name}</div>
          <div style="font-size:11px;color:var(--mid);">残高 ¥${fmt(a.balance)}</div>
        </div>
        ${sel ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--sage)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </div>`;
  }).join('');

  s.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:20px 20px 0 0;max-height:92vh;overflow-y:auto;padding-bottom:120px;-webkit-overflow-scrolling:touch;">
      <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 0;"></div>
      <div style="padding:14px 18px 10px;font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">口座を選択</div>
      <div style="background:#fff;border-radius:14px;margin:0 14px;overflow:hidden;border:1px solid var(--border);">
        ${itemsHTML}
      </div>
    </div>`;

  document.body.appendChild(s);
  s.addEventListener('click', e => { if (e.target === s) s.remove(); });
  s.querySelectorAll('.acct-picker-item').forEach(el => {
    el.addEventListener('click', () => { s.remove(); callback(el.dataset.id); });
  });
}

function calcFn(left, right, op) {
  let r;
  switch (op) {
    case '+': r = left + right; break;
    case '−': r = left - right; break;
    case '×': r = Math.round(left * right); break;
    case '÷': r = right !== 0 ? Math.round(left / right) : left; break;
    default:  r = right;
  }
  return Math.max(0, r);
}
