// summary-sheet.js  タグ×月クロス集計シート
import { DB } from './db.js';
import { MonthState } from './router.js';

const fmt = n => Math.abs(n).toLocaleString('ja-JP');

export async function openSummarySheet() {
  // 既存シートがあれば閉じる
  document.getElementById('summary-sheet-overlay')?.remove();

  // 直近6ヶ月を生成（当月含む）
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let y = MonthState.year;
    let m = MonthState.month - i;
    while (m <= 0) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    months.push({ year: y, month: m });
  }

  // オーバーレイ表示（ローディング）
  const overlay = document.createElement('div');
  overlay.id = 'summary-sheet-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:800;
    background:rgba(0,0,0,0.45);
    display:flex;align-items:flex-end;justify-content:center;
  `;
  overlay.innerHTML = `
    <div id="summary-sheet" style="
      width:100%;max-width:640px;
      background:var(--stone);
      border-radius:20px 20px 0 0;
      max-height:90vh;
      display:flex;flex-direction:column;
      overflow:hidden;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:16px 20px 12px;border-bottom:1px solid var(--border);">
        <div style="font-size:15px;font-weight:700;color:var(--ink);">タグ別集計</div>
        <button id="btn-close-summary" style="background:none;border:none;padding:4px;cursor:pointer;color:var(--mid);">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="summary-sheet-body" style="overflow:auto;flex:1;padding:0;">
        <div style="padding:32px;text-align:center;color:var(--mid);font-size:13px;">読み込み中…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // アニメーション
  const sheet = document.getElementById('summary-sheet');
  sheet.style.transform = 'translateY(100%)';
  requestAnimationFrame(() => {
    sheet.style.transition = 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)';
    sheet.style.transform = 'translateY(0)';
  });

  // 閉じる
  const close = () => {
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => overlay.remove(), 300);
  };
  document.getElementById('btn-close-summary').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // データ取得
  try {
    const [tags, budgetMap] = await Promise.all([
      DB.getTags(),
      DB.getBudgets(`${MonthState.year}-${String(MonthState.month).padStart(2,'0')}`),
    ]);

    // 各月の取引を取得
    const allTxData = await Promise.all(
      months.map(({ year, month }) =>
        DB.getTransactions({ year, month, pageSize: 2000 }).then(r => ({ year, month, txs: r.data || [] }))
      )
    );

    // タグ×月の集計
    // tagId -> monthKey -> amount
    const matrix = {};
    const tagIds = tags.filter(t => !t.is_archived).map(t => t.id);

    for (const { year, month, txs } of allTxData) {
      const key = `${year}-${String(month).padStart(2,'0')}`;
      for (const tx of txs) {
        if (tx.type !== 'expense') continue;
        for (const tag of (tx.tags || [])) {
          if (!tag?.id) continue;
          if (!matrix[tag.id]) matrix[tag.id] = {};
          matrix[tag.id][key] = (matrix[tag.id][key] || 0) + tx.amount;
        }
      }
    }

    // タグなし支出も集計
    for (const { year, month, txs } of allTxData) {
      const key = `${year}-${String(month).padStart(2,'0')}`;
      for (const tx of txs) {
        if (tx.type !== 'expense') continue;
        if (!tx.tags || tx.tags.filter(t => t).length === 0) {
          if (!matrix['__untagged__']) matrix['__untagged__'] = {};
          matrix['__untagged__'][key] = (matrix['__untagged__'][key] || 0) + tx.amount;
        }
      }
    }

    const monthKeys = months.map(({ year, month }) => `${year}-${String(month).padStart(2,'0')}`);
    const monthLabels = months.map(({ month }) => `${month}月`);
    const currentKey = monthKeys[monthKeys.length - 1];

    // 表示するタグ（データがある or 予算設定がある）
    const displayTags = [
      ...tags.filter(t => !t.is_archived && (matrix[t.id] || budgetMap[t.id])),
      ...(matrix['__untagged__'] ? [{ id: '__untagged__', name: 'タグなし', color: '#999' }] : []),
    ];

    // 月別合計
    const monthTotals = {};
    for (const key of monthKeys) {
      monthTotals[key] = displayTags.reduce((s, t) => s + (matrix[t.id]?.[key] || 0), 0);
    }
    const currentBudgetTotal = Object.values(budgetMap).reduce((s, b) => s + b.amount, 0);

    // 表HTML生成
    const colWidth = 72;
    const headerRow = `
      <tr>
        <th style="position:sticky;left:0;z-index:2;
          background:#f0ede8;
          padding:10px 12px;text-align:left;font-size:11px;color:var(--mid);
          font-weight:600;border-bottom:2px solid var(--border);white-space:nowrap;min-width:90px;
          box-shadow:2px 0 4px rgba(0,0,0,0.06);">タグ</th>
        ${monthLabels.map((l, i) => `
          <th style="padding:10px 8px;text-align:right;font-size:11px;color:${i === monthLabels.length-1 ? 'var(--sage-dk)' : 'var(--mid)'};
            font-weight:600;border-bottom:2px solid var(--border);white-space:nowrap;min-width:${colWidth}px;">
            ${l}${i === monthLabels.length-1 ? '<br><span style="font-size:9px;opacity:0.7;">今月</span>' : ''}
          </th>`).join('')}
        <th style="padding:10px 8px;text-align:right;font-size:11px;color:var(--sage);
          font-weight:600;border-bottom:2px solid var(--border);white-space:nowrap;min-width:${colWidth}px;">今月予算</th>
      </tr>`;

    const dataRows = displayTags.map((tag, ri) => {
      const budget = budgetMap[tag.id]?.amount || 0;
      const cells = monthKeys.map((key, i) => {
        const amt = matrix[tag.id]?.[key] || 0;
        const isCurrent = i === monthKeys.length - 1;
        const pct = budget > 0 && isCurrent ? amt / budget : 0;
        const color = isCurrent && budget > 0
          ? (pct > 1 ? '#B83232' : pct > 0.8 ? '#B8973E' : 'var(--ink)')
          : (amt === 0 ? 'var(--mid-lt)' : 'var(--ink)');
        return `<td style="padding:9px 8px;text-align:right;font-size:13px;
          color:${color};font-weight:${isCurrent ? '600' : '400'};
          border-bottom:1px solid var(--border);white-space:nowrap;">
          ${amt === 0 ? '<span style="color:var(--mid-lt)">0</span>' : fmt(amt)}
        </td>`;
      }).join('');

      const budgetCell = budget > 0
        ? `<td style="padding:9px 8px;text-align:right;font-size:13px;color:var(--sage);
            font-weight:500;border-bottom:1px solid var(--border);white-space:nowrap;">
            ${fmt(budget)}
          </td>`
        : `<td style="padding:9px 8px;text-align:right;font-size:13px;color:var(--mid-lt);
            border-bottom:1px solid var(--border);">−</td>`;

      const bg = ri % 2 === 0 ? '' : 'background:rgba(0,0,0,0.015);';
      return `
        <tr style="${bg}">
          <td style="position:sticky;left:0;z-index:1;
            background:#f8f6f2;
            padding:9px 12px;font-size:13px;color:var(--ink);
            border-bottom:1px solid var(--border);white-space:nowrap;
            box-shadow:2px 0 4px rgba(0,0,0,0.06);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;
                background:${tag.color || 'var(--sage)'}"></span>
              ${tag.name}
            </div>
          </td>
          ${cells}
          ${budgetCell}
        </tr>`;
    }).join('');

    // 合計行
    const totalRow = `
      <tr style="background:var(--sage-bg);">
        <td style="position:sticky;left:0;z-index:1;
          background:#eef4ef;
          padding:10px 12px;font-size:13px;font-weight:700;color:var(--ink);
          border-top:2px solid var(--border);white-space:nowrap;
          box-shadow:2px 0 4px rgba(0,0,0,0.06);">合計</td>
        ${monthKeys.map((key, i) => {
          const total = monthTotals[key] || 0;
          const isCurrent = i === monthKeys.length - 1;
          const pct = currentBudgetTotal > 0 && isCurrent ? total / currentBudgetTotal : 0;
          const color = isCurrent && currentBudgetTotal > 0
            ? (pct > 1 ? '#B83232' : pct > 0.8 ? '#B8973E' : 'var(--sage-dk)')
            : 'var(--ink)';
          return `<td style="padding:10px 8px;text-align:right;font-size:13px;
            font-weight:700;color:${color};
            border-top:2px solid var(--border);white-space:nowrap;">
            ${fmt(total)}
          </td>`;
        }).join('')}
        <td style="padding:10px 8px;text-align:right;font-size:13px;
          font-weight:700;color:var(--sage);
          border-top:2px solid var(--border);white-space:nowrap;">
          ${currentBudgetTotal > 0 ? fmt(currentBudgetTotal) : '−'}
        </td>
      </tr>`;

    document.getElementById('summary-sheet-body').innerHTML = `
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="border-collapse:collapse;width:100%;min-width:max-content;">
          <thead>${headerRow}</thead>
          <tbody>${dataRows}${totalRow}</tbody>
        </table>
      </div>
      <div style="padding:12px 16px;font-size:11px;color:var(--mid-lt);line-height:1.6;">
        ※ 支出のみ集計。赤字は予算超過、黄色は80%超。
      </div>`;

  } catch (e) {
    document.getElementById('summary-sheet-body').innerHTML =
      `<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;">読み込みに失敗しました</div>`;
    console.error('[SummarySheet]', e);
  }
}
