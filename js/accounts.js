// ─────────────────────────────────────
//  accounts.js  口座管理画面
//  キャッシュ優先 + バックグラウンド同期
// ─────────────────────────────────────
import { DB }        from './db.js';
import { fmt, showToast, openModal, closeModal } from './app.js';
import { getCachedAccounts, putAccounts, removeAccount } from './cache.js';

const ACCT_TYPES = [
  { value: 'cash',   label: '現金' },
  { value: 'bank',   label: '銀行' },
  { value: 'ic',     label: '電子マネー' },
  { value: 'credit', label: 'クレカ' },
  { value: 'savings', label: '積立・資産' },
  { value: 'point',  label: 'ポイント' },
  { value: 'other',  label: 'その他' },
];

// 8色パレット（背景色 + アイコン色のペア）
const COLOR_PALETTE = [
  { id: 'green',  bg: '#EEF5F1', stroke: '#4A7C59', label: 'グリーン' },
  { id: 'blue',   bg: '#EEF3FF', stroke: '#3B6FBF', label: 'ブルー' },
  { id: 'orange', bg: '#FFF2EB', stroke: '#C4602A', label: 'オレンジ' },
  { id: 'purple', bg: '#F5F0FF', stroke: '#7B5EA7', label: 'パープル' },
  { id: 'stone',  bg: '#F0EDE8', stroke: '#7A9485', label: 'ストーン' },
  { id: 'gold',   bg: '#FBF5E6', stroke: '#B8973E', label: 'ゴールド' },
  { id: 'red',    bg: '#FBF0F0', stroke: '#B83232', label: 'レッド' },
  { id: 'ink',    bg: '#E8EDE9', stroke: '#2F5239', label: 'フォレスト' },
];

// 種別ごとのデフォルトカラー
const TYPE_DEFAULT_COLOR = {
  cash:   'stone',
  bank:   'blue',
  ic:     'green',
  credit: 'purple',
  savings: 'ink',
  point:  'gold',
  other:  'stone',
};

// SVGパス（種別ごとに異なるアイコン）
const TYPE_ICON_PATH = {
  cash:   '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>',
  bank:   '<path d="M3 22V8l9-6 9 6v14H3z"/><path d="M9 22V12h6v10"/>',
  ic:     '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6M9 10h6"/><circle cx="12" cy="16" r="1"/>',
  credit: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  savings: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  point:  '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  other:  '<rect x="2" y="5" width="20" height="14" rx="2"/>',
};

function getColor(acct) {
  const colorId = acct.color || TYPE_DEFAULT_COLOR[acct.type] || 'stone';
  return COLOR_PALETTE.find(c => c.id === colorId) || COLOR_PALETTE[4];
}

function typeLabel(type) {
  return ACCT_TYPES.find(t => t.value === type)?.label || type;
}

function acctIconHTML(acct, size = 36) {
  const c = getColor(acct);
  const path = TYPE_ICON_PATH[acct.type] || TYPE_ICON_PATH.other;
  return `<div class="acct-icon" style="background:${c.bg};width:${size}px;height:${size}px;">
    <svg viewBox="0 0 24 24" style="stroke:${c.stroke}">${path}</svg>
  </div>`;
}

export async function renderAccounts() {
  const content = document.getElementById('page-content');

  // ── STEP 1: キャッシュから即表示 ──
  const cachedAccounts = await getCachedAccounts();
  if (cachedAccounts.length > 0) {
    renderAccountsContent(content, cachedAccounts);
  } else {
    content.innerHTML = '<div class="spinner"></div>';
  }

  // ── STEP 2: バックグラウンドで最新取得 ──
  try {
    const accounts = await DB.getAccounts();
    await putAccounts(accounts);
    renderAccountsContent(content, accounts);
  } catch (e) {
    if (cachedAccounts.length === 0) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-title">エラー: ${e.message}</div></div>`;
    }
    // キャッシュがあればそのまま表示継続
  }
}

async function renderAccountsContent(content, accounts) {
    const total = accounts.reduce((s, a) => s + a.balance, 0);

    const itemsHTML = accounts.map((a, i) => `
      <div class="acct-item" data-id="${a.id}" data-idx="${i}">
        <div class="drag-handle">
          <svg viewBox="0 0 10 16" width="10" height="16" fill="var(--mid-lt)" stroke="none">
            <circle cx="3" cy="3"  r="1.5"/><circle cx="7" cy="3"  r="1.5"/>
            <circle cx="3" cy="8"  r="1.5"/><circle cx="7" cy="8"  r="1.5"/>
            <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
          </svg>
        </div>
        <div class="acct-left">
          ${acctIconHTML(a)}
          <div>
            <div class="acct-name">${a.name}</div>
            <div class="acct-type-label">${typeLabel(a.type)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <div class="acct-balance" style="color:${a.balance<0?'var(--red)':'var(--ink)'}">
            ${a.balance < 0 ? '<span class="acct-balance-cur">−¥</span>' : '<span class="acct-balance-cur">¥</span>'}${fmt(Math.abs(a.balance))}
          </div>
          <button class="btn-acct-edit" data-id="${a.id}"
            style="width:32px;height:32px;border-radius:9px;border:1px solid var(--border);background:var(--warm);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--mid);flex-shrink:0;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
      </div>`).join('');

    content.innerHTML = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head"><div class="panel-title">口座一覧</div></div>
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
                <div style="display:flex;align-items:center;gap:4px;">
                  <span id="new-balance-sign" style="font-size:16px;color:var(--red);font-weight:600;display:none;">−</span>
                  <input class="text-input" id="new-acct-balance" type="number" inputmode="numeric" placeholder="0" style="flex:1;">
                </div>
              </div>
            </div>
            <div class="form-row no-tap" style="border-bottom:none;">
              <div class="row-body">
                <div class="row-label" style="margin-bottom:10px;">カラー</div>
                <div id="new-color-picker" class="color-picker"></div>
              </div>
            </div>
          </div>
          <button class="btn-primary" id="btn-save-acct">
            <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
            口座を追加
          </button>
        </div>
      </div>`;

    // カラーピッカー初期化（追加フォーム）
    let selectedColor = 'stone';
    renderColorPicker('new-color-picker', selectedColor, id => { selectedColor = id; });

    // 残高入力：先頭ゼロを除去（新規作成）
    document.getElementById('new-acct-balance')?.addEventListener('input', e => {
      const v = e.target.value;
      if (v.length > 1 && v.startsWith('0')) e.target.value = String(parseInt(v, 10));
    });

    // 種別変更でマイナス符号切り替え（新規作成）
    document.getElementById('new-acct-type')?.addEventListener('change', e => {
      const sign = document.getElementById('new-balance-sign');
      if (sign) sign.style.display = e.target.value === 'credit' ? 'block' : 'none';
    });

    // 追加
    document.getElementById('btn-save-acct')?.addEventListener('click', async () => {
      const name    = document.getElementById('new-acct-name').value.trim();
      const type    = document.getElementById('new-acct-type').value;
      const rawBalance = parseInt(document.getElementById('new-acct-balance').value || '0', 10);
      const balance = type === 'credit' ? -Math.abs(rawBalance) : rawBalance;
      if (!name) { showToast('口座名を入力してください'); return; }
      try {
        await DB.createAccount({ name, type, balance, color: selectedColor });
        showToast('✓ 口座を追加しました');
        renderAccounts();
      } catch (e) { showToast('エラー: ' + e.message); }
    });

    // 編集ボタン
    document.querySelectorAll('.btn-acct-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const acct = accounts.find(a => a.id === btn.dataset.id);
        if (acct) openEditModal(acct);
      });
    });

    // ドラッグ並び替え初期化
    const listWrap = content.querySelector('.panel');
    if (listWrap) {
      initDragSort(listWrap, accounts, async (newOrder) => {
        try {
          const updates = newOrder.map((a, i) => DB.updateAccount(a.id, { sort_order: i }));
          await Promise.all(updates);
          const updated = await DB.getAccounts();
          const { putAccounts: put } = await import('./cache.js');
          await put(updated);
          renderAccountsContent(content, updated);
        } catch (e) {
          showToast('エラー: ' + e.message);
        }
      });
    }
}

// カラーピッカーを描画
function renderColorPicker(containerId, selectedId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = COLOR_PALETTE.map(c => `
    <div class="color-swatch ${c.id === selectedId ? 'selected' : ''}"
      data-color-id="${c.id}"
      style="background:${c.bg};border:2px solid ${c.id === selectedId ? c.stroke : 'transparent'};"
      title="${c.label}">
      <div style="width:14px;height:14px;border-radius:50%;background:${c.stroke};opacity:0.7;"></div>
    </div>`).join('');

  container.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.color-swatch').forEach(s => {
        const id = s.dataset.colorId;
        const c  = COLOR_PALETTE.find(p => p.id === id);
        s.style.border = '2px solid transparent';
        s.classList.remove('selected');
      });
      const id = el.dataset.colorId;
      const c  = COLOR_PALETTE.find(p => p.id === id);
      el.style.border = `2px solid ${c.stroke}`;
      el.classList.add('selected');
      onChange(id);
    });
  });
}

// ── ドラッグ並び替え ──
function initDragSort(listEl, accounts, onReorder) {
  const items = Array.from(listEl.querySelectorAll('.acct-item'));
  if (items.length <= 1) return;

  let dragging    = null;
  let dragIdx     = -1;
  let newIdx      = -1;
  let startY      = 0;
  let lastY       = 0;
  let dragH       = 0;
  let origCenters = [];

  const onMove = e => {
    if (!dragging) return;
    e.preventDefault();
    lastY = e.touches[0].clientY;
    const dy = lastY - startY;
    dragging.style.transform = `translateY(${dy}px)`;

    // 最も近いスロットを探す（元位置基準）
    const fingerY = lastY;
    let best = dragIdx, bestDist = Infinity;
    origCenters.forEach((cy, i) => {
      const d = Math.abs(fingerY - cy);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    newIdx = best;

    items.forEach((el, i) => {
      if (el === dragging) return;
      el.style.transition = 'transform 0.15s ease';
      let shift = 0;
      if (newIdx > dragIdx && i > dragIdx && i <= newIdx) shift = -dragH;
      else if (newIdx < dragIdx && i >= newIdx && i < dragIdx) shift = dragH;
      el.style.transform = `translateY(${shift}px)`;
    });
  };

  const onEnd = () => {
    if (!dragging) return;
    const finalIdx = newIdx >= 0 ? newIdx : dragIdx;

    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onEnd);

    if (finalIdx === dragIdx) {
      // 移動なし：リセットのみ
      items.forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
      dragging.classList.remove('is-dragging');
      dragging = null; newIdx = -1;
      return;
    }

    // DOM並び替えとtransformリセットを同一フレームで実行
    // → ブラウザが1回のペイントで処理するため「戻り」フラッシュが消える
    const newItemOrder = [...items];
    const [movedItem]  = newItemOrder.splice(dragIdx, 1);
    newItemOrder.splice(finalIdx, 0, movedItem);

    const parent = items[0].parentNode;
    items.forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
    dragging.classList.remove('is-dragging');
    newItemOrder.forEach(el => parent.appendChild(el)); // DOM並び替え

    const savedDragging = dragging;
    dragging = null; newIdx = -1;

    // accounts配列も新順序で構築
    const newOrder = [...accounts];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(finalIdx, 0, moved);
    onReorder(newOrder);
  };

  listEl.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('touchstart', e => {
      const item = handle.closest('.acct-item');
      const idx  = items.indexOf(item);
      if (idx < 0) return;

      dragging    = item;
      dragIdx     = idx;
      newIdx      = idx;
      dragH       = item.offsetHeight + 1;
      startY      = e.touches[0].clientY;
      lastY       = startY;
      origCenters = items.map(el => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });

      item.classList.add('is-dragging');
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onEnd,  { passive: true });
      e.stopPropagation();
    }, { passive: true });
  });
}

function openEditModal(acct) {
  const currentColor = acct.color || TYPE_DEFAULT_COLOR[acct.type] || 'stone';

  const html = `
    <div style="padding:0 16px 24px;">
      <div class="modal-handle" style="margin:0 auto 16px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">口座を編集</div>
        <button id="btn-close-edit" style="width:30px;height:30px;border-radius:50%;background:var(--mist);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
          <svg viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- プレビュー -->
      <div id="edit-preview" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--warm);border-radius:12px;margin-bottom:16px;">
        <div id="preview-icon"></div>
        <div>
          <div style="font-size:14px;font-weight:500;" id="preview-name">${acct.name}</div>
          <div style="font-size:11px;color:var(--mid);">${typeLabel(acct.type)}</div>
        </div>
      </div>

      <div class="form-section" style="margin-bottom:12px;">
        <div class="form-row no-tap">
          <div class="row-body">
            <div class="row-label">口座名</div>
            <input class="text-input" id="edit-acct-name" value="${acct.name}">
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
            <div style="display:flex;align-items:center;gap:4px;">
              <span id="edit-balance-sign" style="font-size:16px;color:var(--red);font-weight:600;
                display:${acct.type==='credit'?'block':'none'};">−</span>
              <input class="text-input" id="edit-acct-balance" type="number" inputmode="numeric"
                value="${Math.abs(acct.balance)}" style="flex:1;">
            </div>
          </div>
        </div>
        <div class="form-row no-tap" style="border-bottom:none;">
          <div class="row-body">
            <div class="row-label" style="margin-bottom:10px;">カラー</div>
            <div id="edit-color-picker" class="color-picker"></div>
          </div>
        </div>
      </div>

      <button class="btn-primary" id="btn-update-acct">
        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
        変更を保存
      </button>

      <!-- 削除は十分な余白と視覚的分離を取る -->
      <div style="margin-top:48px;padding-top:20px;border-top:1px solid var(--border);">
        <div style="font-size:11px;color:var(--mid-lt);text-align:center;margin-bottom:12px;">危険な操作</div>
        <button id="btn-delete-acct"
          style="width:100%;padding:12px;border-radius:14px;
          border:1.5px solid var(--border);background:none;
          color:var(--mid);font-family:'Noto Sans JP',sans-serif;
          font-size:13.5px;font-weight:500;cursor:pointer;
          transition:all 0.15s;">
          この口座を削除する
        </button>
      </div>
    </div>`;

  openModal(html);

  let editColor = currentColor;

  // プレビュー更新関数
  function updatePreview() {
    const name = document.getElementById('edit-acct-name')?.value || acct.name;
    const type = document.getElementById('edit-acct-type')?.value || acct.type;
    const c    = COLOR_PALETTE.find(p => p.id === editColor) || COLOR_PALETTE[4];
    const path = TYPE_ICON_PATH[type] || TYPE_ICON_PATH.other;
    const iconEl = document.getElementById('preview-icon');
    const nameEl = document.getElementById('preview-name');
    if (iconEl) iconEl.innerHTML = `
      <div style="width:40px;height:40px;border-radius:11px;background:${c.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="${c.stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
      </div>`;
    if (nameEl) nameEl.textContent = name;
  }

  updatePreview();

  // カラーピッカー
  renderColorPicker('edit-color-picker', editColor, id => {
    editColor = id;
    updatePreview();
  });

  // 名前・種別変更でプレビュー更新
  document.getElementById('edit-acct-name')?.addEventListener('input', updatePreview);
  document.getElementById('edit-acct-type')?.addEventListener('change', e => {
    updatePreview();
    // クレカ選択時にマイナス符号を表示
    const sign = document.getElementById('edit-balance-sign');
    if (sign) sign.style.display = e.target.value === 'credit' ? 'block' : 'none';
  });

  // 残高入力：先頭ゼロを除去
  document.getElementById('edit-acct-balance')?.addEventListener('input', e => {
    const v = e.target.value;
    if (v.length > 1 && v.startsWith('0')) e.target.value = String(parseInt(v, 10));
  });

  document.getElementById('btn-close-edit')?.addEventListener('click', closeModal);

  document.getElementById('btn-update-acct')?.addEventListener('click', async () => {
    const name    = document.getElementById('edit-acct-name').value.trim();
    const type    = document.getElementById('edit-acct-type').value;
    const rawBalance = parseInt(document.getElementById('edit-acct-balance').value || '0', 10);
    const balance = type === 'credit' ? -Math.abs(rawBalance) : rawBalance;
    if (!name) { showToast('口座名を入力してください'); return; }
    try {
      await DB.updateAccount(acct.id, { name, type, balance, color: editColor });
      closeModal();
      showToast('✓ 変更を保存しました');
      renderAccounts();
    } catch (e) { showToast('エラー: ' + e.message); }
  });

  // 削除：2段階確認（ボタンが変化する）
  document.getElementById('btn-delete-acct')?.addEventListener('click', function() {
    const btn = this;

    if (btn.dataset.confirmed === 'true') return; // 多重クリック防止

    // ── 第1タップ：ボタンを赤く変えて確認を求める ──
    btn.textContent = '本当に削除しますか？もう一度タップで削除';
    btn.style.borderColor = 'var(--red)';
    btn.style.color = 'var(--red)';
    btn.style.background = 'var(--red-bg)';
    btn.dataset.confirmed = 'pending';

    // 3秒後に元に戻る
    const timer = setTimeout(() => {
      btn.textContent = 'この口座を削除する';
      btn.style.borderColor = 'var(--border)';
      btn.style.color = 'var(--mid)';
      btn.style.background = 'none';
      btn.dataset.confirmed = '';
    }, 3000);

    // ── 第2タップ：実際に削除 ──
    btn.addEventListener('click', async function handler() {
      if (btn.dataset.confirmed !== 'pending') return;
      btn.removeEventListener('click', handler);
      clearTimeout(timer);
      btn.dataset.confirmed = 'true';
      btn.textContent = '削除中…';
      btn.disabled = true;
      try {
        await DB.updateAccount(acct.id, { is_archived: true });
        await removeAccount(acct.id); // キャッシュからも即削除
        closeModal();
        showToast('口座を削除しました');
        renderAccounts();
      } catch (e) {
        showToast('エラー: ' + e.message);
        btn.disabled = false;
        btn.dataset.confirmed = '';
      }
    }, { once: true });
  });
}
