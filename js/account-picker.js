// ══════════════════════════════════════════════
//  口座選択ボトムシート（共通モジュール）
//  add-record.js / edit-record.js から共用する。
//  以前は両ファイルに同一実装が重複しており、片方だけ
//  修正して不整合が起きる事故の温床だったため一本化した。
// ══════════════════════════════════════════════

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

const fmt = (n) => Number(n).toLocaleString('ja-JP');

const SHEET_ID = 'acct-picker-sheet';

/**
 * 口座選択ボトムシートを表示する。
 *
 * @param {Object}   opts
 * @param {Array}    opts.accounts   口座配列 [{ id, name, type, balance }]
 * @param {string}   [opts.currentId] 現在選択中の口座ID（チェック表示用）
 * @param {string}   [opts.title]     見出し（既定: '口座を選択'）
 * @param {Function} opts.onSelect    口座が選ばれたときに id を受け取るコールバック
 */
export function showAccountPicker({ accounts = [], currentId = null, title = '口座を選択', onSelect } = {}) {
  // 既存のピッカーが残っていれば除去（多重表示防止）
  document.getElementById(SHEET_ID)?.remove();

  const itemsHTML = accounts.map(a => {
    const bg       = TYPE_BG[a.type]    || '#F0EDE8';
    const stroke   = TYPE_COLOR[a.type] || '#7A9485';
    const path     = TYPE_PATH[a.type]  || TYPE_PATH.other;
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
          <div style="font-size:11px;color:var(--mid);">残高 ¥${fmt(a.balance)}</div>
        </div>
        ${selected ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--sage)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </div>`;
  }).join('');

  const sheet = document.createElement('div');
  sheet.id = SHEET_ID;
  // z-index:1100 は #save-bar(1000) より前面に出すための値。
  // これを下げると保存バーがピッカー最下部の口座を覆ってしまうので注意。
  sheet.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(28,43,34,0.45);display:flex;align-items:flex-end;justify-content:center;';
  sheet.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:20px 20px 0 0;
      display:flex;flex-direction:column;max-height:85vh;">
      <div style="flex-shrink:0;">
        <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 0;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;">
          <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">${title}</div>
          <button class="acct-picker-close" style="width:28px;height:28px;border-radius:50%;background:var(--mist);border:none;
            display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
            <svg viewBox="0 0 24 24" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div style="overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 14px calc(40px + env(safe-area-inset-bottom));flex:1;min-height:0;">
        <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid var(--border);">
          ${itemsHTML}
        </div>
      </div>
    </div>`;

  const close = () => sheet.remove();

  document.body.appendChild(sheet);
  sheet.querySelector('.acct-picker-close')?.addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelectorAll('.acct-picker-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      close();
      onSelect?.(id);
    });
  });
}
