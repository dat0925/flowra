// summary-sheet.js  タグ×月クロス集計シート
import { DB } from './db.js';
import { MonthState } from './router.js';
import { supabase } from './config.js';

const fmt = n => Math.abs(n).toLocaleString('ja-JP');

function getMonths(baseYear, baseMonth) {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let y = baseYear, m = baseMonth - i;
    while (m <= 0) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    months.push({ year: y, month: m });
  }
  return months;
}

export async function openSummarySheet() {
  document.getElementById('summary-sheet-overlay')?.remove();

  let baseYear  = MonthState.year;
  let baseMonth = MonthState.month;

  const overlay = document.createElement('div');
  overlay.id = 'summary-sheet-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:800;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;`;
  overlay.innerHTML = `
    <div id="summary-sheet" style="width:100%;max-width:640px;background:var(--stone);border-radius:20px 20px 0 0;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
      <!-- ヘッダー -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:15px;font-weight:700;color:var(--ink);">タグ別集計</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <!-- 今月ボタン -->
          <button id="ss-today-btn" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--stone);color:var(--mid);cursor:pointer;white-space:nowrap;display:none;">今月</button>
          <!-- 月ナビ（ラベルタップでピッカー） -->
          <div style="display:flex;align-items:center;gap:4px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:4px 8px;">
            <button id="ss-prev-month" style="background:none;border:none;padding:2px 6px;cursor:pointer;color:var(--sage);font-size:16px;line-height:1;">‹</button>
            <span id="ss-month-label" style="font-size:12px;font-weight:600;color:var(--ink);white-space:nowrap;min-width:80px;text-align:center;cursor:pointer;border-bottom:1px dotted var(--mid-lt);"></span>
            <button id="ss-next-month" style="background:none;border:none;padding:2px 6px;cursor:pointer;color:var(--sage);font-size:16px;line-height:1;">›</button>
          </div>
          <button id="btn-close-summary" style="background:none;border:none;padding:4px;cursor:pointer;color:var(--mid);">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div id="summary-sheet-body" style="overflow:auto;flex:1;padding:0;">
        <div style="padding:32px;text-align:center;color:var(--mid);font-size:13px;">読み込み中…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const sheet = document.getElementById('summary-sheet');
  sheet.style.transform = 'translateY(100%)';
  requestAnimationFrame(() => {
    sheet.style.transition = 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)';
    sheet.style.transform = 'translateY(0)';
  });

  const close = () => {
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => overlay.remove(), 300);
  };
  document.getElementById('btn-close-summary').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const updateLabel = () => {
    document.getElementById('ss-month-label').textContent = `〜${baseYear}年${baseMonth}月`;
    const now = new Date();
    const isCurrentMonth = baseYear === now.getFullYear() && baseMonth === now.getMonth() + 1;
    document.getElementById('ss-next-month').disabled =
      baseYear > now.getFullYear() || (baseYear === now.getFullYear() && baseMonth >= now.getMonth() + 1);
    const todayBtn = document.getElementById('ss-today-btn');
    if (todayBtn) todayBtn.style.display = isCurrentMonth ? 'none' : '';
  };

  const renderSheet = async () => {
    const body = document.getElementById('summary-sheet-body');
    // シートを上下させず、その場でフェードして更新
    body.style.opacity = '0.4';
    body.style.transition = 'opacity 0.15s';
    updateLabel();
    await loadAndRender(baseYear, baseMonth);
    body.style.opacity = '1';
  };

  // 月ラベルタップでピッカー表示
  document.getElementById('ss-month-label').addEventListener('click', () => {
    const now = new Date();
    const picker = document.createElement('div');
    picker.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
    picker.innerHTML = `
      <div style="background:var(--white);border-radius:20px;padding:24px;width:280px;max-width:90vw;">
        <div style="font-size:14px;font-weight:600;color:var(--ink);margin-bottom:16px;text-align:center;">表示する最終月を選択</div>
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <select id="ss-pick-year" style="flex:1;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--white);">
            ${Array.from({length: 6}, (_, i) => now.getFullYear() - i).map(y =>
              `<option value="${y}" ${y === baseYear ? 'selected' : ''}>${y}年</option>`
            ).join('')}
          </select>
          <select id="ss-pick-month" style="flex:1;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;background:var(--white);">
            ${Array.from({length: 12}, (_, i) => i + 1).map(m =>
              `<option value="${m}" ${m === baseMonth ? 'selected' : ''}>${m}月</option>`
            ).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="ss-pick-cancel" style="flex:1;padding:10px;border-radius:10px;border:1.5px solid var(--border);background:none;font-size:14px;cursor:pointer;">キャンセル</button>
          <button id="ss-pick-ok" style="flex:1;padding:10px;border-radius:10px;border:none;background:var(--sage);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">確定</button>
        </div>
      </div>`;
    document.body.appendChild(picker);
    document.getElementById('ss-pick-cancel').addEventListener('click', () => picker.remove());
    document.getElementById('ss-pick-ok').addEventListener('click', () => {
      const y = parseInt(document.getElementById('ss-pick-year').value);
      const m = parseInt(document.getElementById('ss-pick-month').value);
      picker.remove();
      baseYear = y; baseMonth = m;
      renderSheet();
    });
  });

  // 今月に戻るボタン
  document.getElementById('ss-today-btn')?.addEventListener('click', () => {
    const now = new Date();
    baseYear = now.getFullYear();
    baseMonth = now.getMonth() + 1;
    renderSheet();
  });

  document.getElementById('ss-prev-month').addEventListener('click', () => {
    baseMonth--;
    if (baseMonth <= 0) { baseMonth = 12; baseYear--; }
    renderSheet();
  });
  document.getElementById('ss-next-month').addEventListener('click', () => {
    baseMonth++;
    if (baseMonth > 12) { baseMonth = 1; baseYear++; }
    renderSheet();
  });

  updateLabel();
  await loadAndRender(baseYear, baseMonth);
}

async function loadAndRender(baseYear, baseMonth) {
  const el = document.getElementById('summary-sheet-body');
  try {
    const months = getMonths(baseYear, baseMonth);
    const currentKey = `${baseYear}-${String(baseMonth).padStart(2,'0')}`;

    const [tags, budgetMap] = await Promise.all([
      DB.getTags(),
      DB.getBudgets(currentKey),
    ]);

    // 集計シート専用取得：search_transactions RPCでタグ情報も含めて取得
    const fetchMonthTxs = async (year, month) => {
      const teamId = await DB.getTeamId();
      // 月の全取引をRPC経由で取得（transaction_tagsのRLS回避）
      const dateFrom = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const dateTo = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

      const { data: txs } = await supabase
        .from('transactions')
        .select('id, type, amount, date')
        .eq('team_id', teamId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .eq('type', 'expense')
        .limit(5000);

      if (!txs || txs.length === 0) return [];

      // transaction_tagsをRPC経由で取得
      const txIds = txs.map(t => t.id);
      const { data: tagRows } = await supabase.rpc('get_transaction_tags', { p_transaction_ids: txIds });
      const tagMap = {};
      (tagRows || []).forEach(r => {
        if (!tagMap[r.transaction_id]) tagMap[r.transaction_id] = [];
        tagMap[r.transaction_id].push({ id: r.tag_id, name: r.tag_name, color: r.tag_color });
      });

      return txs.map(tx => ({ ...tx, tags: tagMap[tx.id] || [] }));
    };

    const allTxData = await Promise.all(
      months.map(async ({ year, month }) => ({
        year, month, txs: await fetchMonthTxs(year, month)
      }))
    );

    const matrix = {};
    for (const { year, month, txs } of allTxData) {
      const key = `${year}-${String(month).padStart(2,'0')}`;
      for (const tx of txs) {
        if (tx.type !== 'expense') continue;
        const validTags = (tx.tags || []).filter(t => t?.id);
        if (validTags.length > 0) {
          // 主タグ（先頭）のみ集計
          const primaryTag = validTags[0];
          if (!matrix[primaryTag.id]) matrix[primaryTag.id] = {};
          matrix[primaryTag.id][key] = (matrix[primaryTag.id][key] || 0) + tx.amount;
        } else {
          // タグなし
          if (!matrix['__untagged__']) matrix['__untagged__'] = {};
          matrix['__untagged__'][key] = (matrix['__untagged__'][key] || 0) + tx.amount;
        }
      }
    }

    const monthKeys   = months.map(({ year, month }) => `${year}-${String(month).padStart(2,'0')}`);
    const monthLabels = months.map(({ month }) => `${month}月`);

    const displayTags = [
      ...tags.filter(t => !t.is_archived && (matrix[t.id] || budgetMap[t.id])),
      ...(matrix['__untagged__'] ? [{ id: '__untagged__', name: 'タグなし', color: '#999' }] : []),
    ];

    const monthTotals = {};
    for (const key of monthKeys) {
      monthTotals[key] = displayTags.reduce((s, t) => s + (matrix[t.id]?.[key] || 0), 0);
    }
    const currentBudgetTotal = Object.values(budgetMap).reduce((s, b) => s + b.amount, 0);
    const colWidth = 72;

    // stickyヘッダー行
    const headerRow = `
      <tr>
        <th style="position:sticky;top:0;left:0;z-index:3;background:#f0ede8;
          padding:8px 12px;text-align:left;font-size:11px;color:var(--mid);font-weight:600;
          border-bottom:2px solid var(--border);white-space:nowrap;min-width:90px;
          box-shadow:2px 0 4px rgba(0,0,0,0.06);">タグ</th>
        ${monthLabels.map((l, i) => `
          <th style="position:sticky;top:0;z-index:2;background:#f0ede8;
            padding:8px 8px;text-align:right;font-size:11px;
            color:${i === monthLabels.length-1 ? 'var(--sage-dk)' : 'var(--mid)'};
            font-weight:600;border-bottom:2px solid var(--border);white-space:nowrap;min-width:${colWidth}px;">
            ${l}${i === monthLabels.length-1 ? '<br><span style="font-size:9px;opacity:0.7;">今月</span>' : ''}
          </th>`).join('')}
        <th style="position:sticky;top:0;z-index:2;background:#f0ede8;
          padding:8px 8px;text-align:right;font-size:11px;color:var(--sage);
          font-weight:600;border-bottom:2px solid var(--border);white-space:nowrap;min-width:${colWidth}px;">今月予算</th>
      </tr>`;

    const dataRows = displayTags.map((tag, ri) => {
      const budget = budgetMap[tag.id]?.amount || 0;
      const cells = monthKeys.map((key, i) => {
        const amt = matrix[tag.id]?.[key] || 0;
        const isCurrent = i === monthKeys.length - 1;
        const pct = budget > 0 && amt > 0 ? amt / budget : 0;
        const color = budget > 0 && amt > 0
          ? (pct > 1 ? '#B83232' : pct > 0.8 ? '#B8973E' : 'var(--ink)')
          : (amt === 0 ? 'var(--mid-lt)' : 'var(--ink)');
        return `<td style="padding:9px 8px;text-align:right;font-size:13px;
          color:${color};font-weight:${isCurrent ? '600' : '400'};
          border-bottom:1px solid var(--border);white-space:nowrap;">
          ${amt === 0 ? '<span style="color:var(--mid-lt)">0</span>' : fmt(amt)}
        </td>`;
      }).join('');

      const budgetCell = budget > 0
        ? `<td style="padding:9px 8px;text-align:right;font-size:13px;color:var(--sage);font-weight:500;border-bottom:1px solid var(--border);white-space:nowrap;">${fmt(budget)}</td>`
        : `<td style="padding:9px 8px;text-align:right;font-size:13px;color:var(--mid-lt);border-bottom:1px solid var(--border);">−</td>`;

      const bg = ri % 2 === 0 ? '' : 'background:rgba(0,0,0,0.015);';
      return `
        <tr style="${bg}">
          <td style="position:sticky;left:0;z-index:1;background:#f8f6f2;
            padding:9px 12px;font-size:13px;color:var(--ink);
            border-bottom:1px solid var(--border);white-space:nowrap;
            box-shadow:2px 0 4px rgba(0,0,0,0.06);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${tag.color || 'var(--sage)'}"></span>
              ${tag.name}
            </div>
          </td>
          ${cells}${budgetCell}
        </tr>`;
    }).join('');

    const totalRow = `
      <tr style="background:var(--sage-bg);">
        <td style="position:sticky;left:0;z-index:1;background:#eef4ef;
          padding:10px 12px;font-size:13px;font-weight:700;color:var(--ink);
          border-top:2px solid var(--border);white-space:nowrap;
          box-shadow:2px 0 4px rgba(0,0,0,0.06);">合計</td>
        ${monthKeys.map((key, i) => {
          const total = monthTotals[key] || 0;
          const isCurrent = i === monthKeys.length - 1;
          const pct = currentBudgetTotal > 0 && total > 0 ? total / currentBudgetTotal : 0;
          const color = currentBudgetTotal > 0 && total > 0
            ? (pct > 1 ? '#B83232' : pct > 0.8 ? '#B8973E' : (isCurrent ? 'var(--sage-dk)' : 'var(--ink)'))
            : 'var(--ink)';
          return `<td style="padding:10px 8px;text-align:right;font-size:13px;font-weight:700;color:${color};border-top:2px solid var(--border);white-space:nowrap;">${fmt(total)}</td>`;
        }).join('')}
        <td style="padding:10px 8px;text-align:right;font-size:13px;font-weight:700;color:var(--sage);border-top:2px solid var(--border);white-space:nowrap;">
          ${currentBudgetTotal > 0 ? fmt(currentBudgetTotal) : '−'}
        </td>
      </tr>`;

    el.innerHTML = `
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="border-collapse:collapse;width:100%;min-width:max-content;">
          <thead>${headerRow}</thead>
          <tbody>${dataRows}${totalRow}</tbody>
        </table>
      </div>
      <div style="padding:10px 16px;font-size:11px;color:var(--mid-lt);line-height:1.8;">
        ※ 支出のみ集計。複数タグがある場合は「主」タグのみで集計します（二重カウントなし）。<br>
        ※ 合計行 = 主タグ別合計 + タグなし合計 = その月の支出合計と一致します。
      </div>`;

  } catch (e) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;">読み込みに失敗しました</div>`;
    console.error('[SummarySheet]', e);
  }
}
