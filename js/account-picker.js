// ══════════════════════════════════════════════
//  口座選択ボトムシート（共通モジュール）
//  add-record.js / edit-record.js から共用する。
//  以前は両ファイルに同一実装が重複しており、片方だけ
//  修正して不整合が起きる事故の温床だったため一本化した。
//  土台は utils.js の showSheet（UI洗練9）に寄せてある。
// ══════════════════════════════════════════════

import { showSheet } from './utils.js';

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
  // 多重表示防止は showSheet の id 判定に任せる
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

  // 土台は共通シート（UI洗練9: utils.showSheet）。
  // z-index 1100 は #save-bar(1000) より前面に出すための値（showSheet の既定値）。
  // これを下げると保存バーがピッカー最下部の口座を覆ってしまうので注意。
  const { el, close } = showSheet({
    id: SHEET_ID,
    title,
    bodyHTML: `
      <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid var(--border);">
        ${itemsHTML}
      </div>`,
  });

  el.querySelectorAll('.acct-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      close();
      onSelect?.(id);
    });
  });
}