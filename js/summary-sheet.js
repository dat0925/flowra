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
    <div id="summary-sheet" style="width:100%;max-width:640px;background:var(--stone);border-radius:20px 20px 0 0;height:90vh;display:flex;flex-direction:column;overflow:hidden;">
      <!-- ヘッダー（ホームと同じレイアウト：左タイトル、中央月ナビ、右今月+閉じる） -->
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:12px 16px 8px;border-bottom:none;flex-shrink:0;">
        <div style="font-size:15px;font-weight:700;color:var(--ink);">タグ別集計</div>
        <div style="display:flex;align-items:center;gap:0;">
          <button id="ss-prev-month" style="background:none;border:none;padding:4px 8px;cursor:pointer;color:var(--sage);font-size:18px;line-height:1;">‹</button>
          <span id="ss-month-label" style="font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;min-width:96px;text-align:center;cursor:pointer;padding:4px 2px;"></span>
          <button id="ss-next-month" style="background:none;border:none;padding:4px 8px;cursor:pointer;color:var(--sage);font-size:18px;line-height:1;">›</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
          <button id="ss-today-btn" style="font-size:11px;padding:4px 10px;border-radius:20px;border:1px solid var(--border);background:var(--white);color:var(--mid);cursor:pointer;white-space:nowrap;display:none;">今月</button>
          <button id="btn-close-summary" style="background:none;border:none;padding:4px;cursor:pointer;color:var(--mid);">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <!-- 主タグ/サブタグ切り替えタブ -->
      <div style="display:flex;padding:0 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0;gap:4px;">
        <button id="ss-tab-primary" style="flex:1;padding:7px 0;font-size:12px;font-weight:700;border:none;border-bottom:2px solid var(--sage);background:none;color:var(--sage-dk);cursor:pointer;">
          主タグ集計 <span id="ss-help-primary" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--sage);color:#fff;font-size:9px;font-weight:700;cursor:pointer;vertical-align:middle;margin-left:3px;line-height:1;">?</span>
        </button>
        <button id="ss-tab-sub" style="flex:1;padding:7px 0;font-size:12px;font-weight:600;border:none;border-bottom:2px solid transparent;background:none;color:var(--mid);cursor:pointer;">
          サブタグ集計 <span id="ss-help-sub" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--mid-lt);color:#fff;font-size:9px;font-weight:700;cursor:pointer;vertical-align:middle;margin-left:3px;line-height:1;">?</span>
        </button>
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

  let mode = 'primary'; // 'primary' or 'sub'

  const setTab = (newMode) => {
    mode = newMode;
    const pBtn = document.getElementById('ss-tab-primary');
    const sBtn = document.getElementById('ss-tab-sub');
    if (pBtn) {
      pBtn.style.borderBottom = newMode === 'primary' ? '2px solid var(--sage)' : '2px solid transparent';
      pBtn.style.color = newMode === 'primary' ? 'var(--sage-dk)' : 'var(--mid)';
      pBtn.style.fontWeight = newMode === 'primary' ? '700' : '600';
    }
    if (sBtn) {
      sBtn.style.borderBottom = newMode === 'sub' ? '2px solid var(--sage)' : '2px solid transparent';
      sBtn.style.color = newMode === 'sub' ? 'var(--sage-dk)' : 'var(--mid)';
      sBtn.style.fontWeight = newMode === 'sub' ? '700' : '600';
    }
  };

  document.getElementById('ss-tab-primary')?.addEventListener('click', () => {
    if (mode === 'primary') return;
    setTab('primary');
    renderSheet();
  });
  document.getElementById('ss-tab-sub')?.addEventListener('click', () => {
    if (mode === 'sub') return;
    setTab('sub');
    renderSheet();
  });

  // ツールチップ
  const showTooltip = (msg) => {
    const existing = document.getElementById('ss-tooltip');
    if (existing) existing.remove();
    const tip = document.createElement('div');
    tip.id = 'ss-tooltip';
    tip.style.cssText = 'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);' +
      'background:rgba(28,43,34,0.92);color:#fff;font-size:12px;line-height:1.7;' +
      'padding:10px 16px 10px 16px;border-radius:12px;max-width:300px;z-index:900;' +
      'text-align:left;display:flex;align-items:flex-start;gap:10px;';
    tip.innerHTML = '<span style="flex:1;">' + msg + '</span>' +
      '<button style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">×</button>';
    tip.querySelector('button').addEventListener('click', () => tip.remove());
    document.body.appendChild(tip);
  };
  document.getElementById('ss-help-primary')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showTooltip('予算設定ありのタグで集計。1レコード1タグで二重カウントなし。合計 = その月の支出合計と一致します。');
  });
  document.getElementById('ss-help-sub')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showTooltip('予算設定なしの品目タグで集計。肉・米・菓子など細かい推移を確認できます。1レコードに複数サブタグがある場合は重複カウントされます。');
  });

  const updateLabel = () => {
    document.getElementById('ss-month-label').textContent = `${baseYear}年${baseMonth}月`;
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
    await loadAndRender(baseYear, baseMonth, mode);
    body.style.opacity = '1';
  };

  // 月ラベルタップでボトムシート式ピッカー（ホームと同じUI）
  document.getElementById('ss-month-label').addEventListener('touchend', e => { e.preventDefault();
    Sound.playOpen();
    const now = new Date();
    const minYear = 2010;
    const maxYear = now.getFullYear() + 1;
    const years = [];
    for (let y = maxYear; y >= minYear; y--) years.push(y);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--stone);border-radius:20px 20px 0 0;width:100%;max-width:480px;
        padding:0 0 env(safe-area-inset-bottom,16px);max-height:80vh;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--border);">
          <span style="font-size:15px;font-weight:600;">年月を選択</span>
          <button id="ss-mp-close" style="background:none;border:none;font-size:22px;color:var(--mid);cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="overflow-y:auto;padding:12px 16px 8px;flex:1;">
          ${years.map(y => `
            <div style="margin-bottom:12px;">
              <div style="font-size:12px;color:var(--mid);font-weight:600;margin-bottom:6px;padding-left:4px;">${y}年</div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
                ${[1,2,3,4,5,6,7,8,9,10,11,12].map(mo => {
                  const isCur  = y === baseYear && mo === baseMonth;
                  const isNow  = y === now.getFullYear() && mo === now.getMonth() + 1;
                  const future = y > now.getFullYear() || (y === now.getFullYear() && mo > now.getMonth() + 1);
                  return `<button data-y="${y}" data-m="${mo}"
                    style="padding:8px 4px;border-radius:10px;border:none;cursor:pointer;font-size:13px;
                      background:${isCur ? 'var(--sage)' : 'var(--mist)'};
                      color:${isCur ? '#fff' : future ? 'var(--mid-lt)' : 'var(--ink)'};
                      font-weight:${isCur || isNow ? '700' : '400'};
                      outline:${isNow && !isCur ? '2px solid var(--sage)' : 'none'};
                    ">${mo}月</button>`;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 選択した月にスクロール
    setTimeout(() => {
      const selected = overlay.querySelector('button[data-y][style*="var(--sage)"]');
      if (selected) selected.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);

    overlay.addEventListener('click', e => {
      const btn = e.target.closest('button[data-y]');
      if (btn) {
        Sound.playTap();
        baseYear = +btn.dataset.y;
        baseMonth = +btn.dataset.m;
        overlay.remove();
        renderSheet();
        return;
      }
      if (e.target === overlay || e.target.id === 'ss-mp-close') {
        Sound.playClose();
        overlay.remove();
      }
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
  await loadAndRender(baseYear, baseMonth, 'primary');
}

async function loadAndRender(baseYear, baseMonth, mode = 'primary') {
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
        if (mode === 'primary') {
          // 主タグ＝予算ありタグ。該当タグが複数あれば先頭1つだけ集計
          const primaryTag = validTags.find(t => budgetMap[t.id]);
          if (primaryTag) {
            if (!matrix[primaryTag.id]) matrix[primaryTag.id] = {};
            matrix[primaryTag.id][key] = (matrix[primaryTag.id][key] || 0) + tx.amount;
          } else if (validTags.length === 0) {
            if (!matrix['__untagged__']) matrix['__untagged__'] = {};
            matrix['__untagged__'][key] = (matrix['__untagged__'][key] || 0) + tx.amount;
          }
        } else {
          // サブタグ＝予算なしタグ（順番関係なく全て集計）
          const subTags = validTags.filter(t => !budgetMap[t.id]);
          for (const tag of subTags) {
            if (!matrix[tag.id]) matrix[tag.id] = {};
            matrix[tag.id][key] = (matrix[tag.id][key] || 0) + tx.amount;
          }
        }
      }
    }

    const monthKeys   = months.map(({ year, month }) => `${year}-${String(month).padStart(2,'0')}`);
    const monthLabels = months.map(({ month }) => `${month}月`);

    const displayTags = mode === 'primary'
      ? [
          ...tags.filter(t => !t.is_archived && budgetMap[t.id]),
          ...(matrix['__untagged__'] ? [{ id: '__untagged__', name: 'タグなし', color: '#999' }] : []),
        ]
      : [
          // サブタグ集計は実績があり、かつ予算なしタグのみ表示
          ...tags.filter(t => !t.is_archived && matrix[t.id] && !budgetMap[t.id]),
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
        ${mode === 'primary' ? `<th style="position:sticky;top:0;z-index:2;background:#f0ede8;
          padding:8px 8px;text-align:right;font-size:11px;color:var(--sage);
          font-weight:600;border-bottom:2px solid var(--border);white-space:nowrap;min-width:${colWidth}px;">今月予算</th>`
        : ''}
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

      const budgetCell = mode === 'sub' ? '' : (budget > 0
        ? `<td style="padding:9px 8px;text-align:right;font-size:13px;color:var(--sage);font-weight:500;border-bottom:1px solid var(--border);white-space:nowrap;">${fmt(budget)}</td>`
        : `<td style="padding:9px 8px;text-align:right;font-size:13px;color:var(--mid-lt);border-bottom:1px solid var(--border);">−</td>`);

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
        ${mode === 'primary' ? `<td style="padding:10px 8px;text-align:right;font-size:13px;font-weight:700;color:var(--sage);border-top:2px solid var(--border);white-space:nowrap;">
          ${currentBudgetTotal > 0 ? fmt(currentBudgetTotal) : '−'}
        </td>` : ''}
      </tr>`;

    el.innerHTML = `
      <div id="summary-scroll-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="border-collapse:collapse;width:100%;min-width:max-content;">
          <thead>${headerRow}</thead>
          <tbody>${dataRows}${mode === "primary" ? totalRow : ""}</tbody>
        </table>
      </div>
    `;

    // 横スクロールを最右端（当月列）に移動
    requestAnimationFrame(() => {
      const wrap = document.getElementById('summary-scroll-wrap');
      if (wrap) wrap.scrollLeft = wrap.scrollWidth;
    });

  } catch (e) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;">読み込みに失敗しました</div>`;
    console.error('[SummarySheet]', e);
  }
}






