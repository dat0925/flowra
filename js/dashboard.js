// ─────────────────────────────────────
//  dashboard.js  ホーム画面
//  キャッシュ優先 + 差分同期（Stale-While-Revalidate）
// ─────────────────────────────────────
import { DB }         from './db.js';
import { MonthState } from './router.js';
import { fmt }        from './app.js';
import {
  getCachedAccounts, putAccounts,
  getCachedTransactions, upsertTransactions,
  getLastSync, setLastSync
} from './cache.js';
import { openEditRecord } from './edit-record.js';

const PAGE_SIZE = 50;

// 口座タイプ別アイコン
const ACCT_ICON = {
  cash:   { bg: '#F0EDE8', stroke: '#7A9485', path: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>' },
  bank:   { bg: '#EEF3FF', stroke: '#3B6FBF', path: '<path d="M3 22V8l9-6 9 6v14H3z"/><path d="M9 22V12h6v10"/>' },
  ic:     { bg: '#EEF5F1', stroke: '#4A7C59', path: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6M9 10h6"/><circle cx="12" cy="16" r="1"/>' },
  credit: { bg: '#F5F0FF', stroke: '#7B5EA7', path: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
  savings: { bg: '#EEF5F1', stroke: '#2F5239', path: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
  point:  { bg: '#FBF5E6', stroke: '#B8973E', path: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
  other:  { bg: '#F0EDE8', stroke: '#7A9485', path: '<rect x="2" y="5" width="20" height="14" rx="2"/>' },
};
const ACCT_TYPE_LABEL = { cash:'現金', bank:'銀行', ic:'電子マネー', credit:'クレカ', savings:'積立・資産', point:'ポイント', other:'その他' };

const TX_ICON = {
  income:   { bg: '#EEF5F1', stroke: '#4A7C59', path: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
  expense:  { bg: '#F0EDE8', stroke: '#7A9485', path: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
  transfer: { bg: '#FBF5E6', stroke: '#B8973E', path: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
};

function acctIconSVG(type) {
  const ic = ACCT_ICON[type] || ACCT_ICON.other;
  return `<div class="acct-icon" style="background:${ic.bg};">
    <svg viewBox="0 0 24 24" style="stroke:${ic.stroke}">${ic.path}</svg>
  </div>`;
}

function txIconSVG(type) {
  const ic = TX_ICON[type] || TX_ICON.expense;
  return `<div class="tx-icon" style="background:${ic.bg};">
    <svg viewBox="0 0 24 24" style="stroke:${ic.stroke}">${ic.path}</svg>
  </div>`;
}

function tagsHTML(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.filter(t => t).map(t => `<span class="tx-tag tx-tag-muted">${t.name}</span>`).join('');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['日','月','火','水','木','金','土'];
  return `${d.getMonth()+1}月${d.getDate()}日（${w[d.getDay()]}）`;
}

function txItemHTML(tx) {
  const sign = tx.type==='income' ? '+¥' : tx.type==='expense' ? '−¥' : '¥';
  const acctName = tx.type==='transfer'
    ? `${tx.account?.name||''} → ${tx.to_account?.name||''}`
    : tx.account?.name||'';
  return `
  <div class="tx-item" data-tx-id="${tx.id}" style="cursor:pointer;">
    ${txIconSVG(tx.type)}
    <div class="tx-body">
      <div class="tx-name">${tx.memo||'（メモなし）'}</div>
      <div class="tx-meta">
        ${tx.tags && tx.tags.find(t => t)
          ? `<span class="tx-tag tx-tag-primary">${tx.tags.find(t => t).name}</span><span class="tx-acct" style="color:var(--mid-lt);">${acctName}</span>`
          : `<span class="tx-acct">${acctName}</span>`
        }
        ${tx.is_unsettled ? '<span class="unsettled-dot"></span><span style="font-size:11px;color:var(--gold);font-weight:500;">未精算</span>' : ''}
      </div>
    </div>
    <div class="tx-right">
      <div class="tx-amount ${tx.type}">
        <span class="tx-currency">${sign}</span>${fmt(tx.amount)}
      </div>

    </div>
  </div>`;
}

function groupByDate(transactions) {
  const grouped = {};
  transactions.forEach(tx => {
    if (!grouped[tx.date]) grouped[tx.date] = [];
    grouped[tx.date].push(tx);
  });
  return grouped;
}

// ── 無限スクロール状態 ──
let _page    = 0;
let _hasMore = false;
let _loading = false;
let _observer = null;

function resetPaging() {
  _page    = 0;
  _hasMore = false;
  _loading = false;
  if (_observer) { _observer.disconnect(); _observer = null; }
}

export async function renderDashboard() {
  const content = document.getElementById('page-content');
  const { year, month } = MonthState;
  resetPaging();

  // ── STEP 1: キャッシュから即表示 ──────────────────
  const [cachedAccounts, cachedTxs] = await Promise.all([
    getCachedAccounts(),
    getCachedTransactions({ year, month }),
  ]);

  // 口座が0件でもキャッシュ済みとみなす（口座なし状態も正常）
  const hasCached = cachedAccounts.length > 0 || cachedTxs.length > 0;
  if (hasCached) {
    renderContent(content, cachedAccounts, cachedTxs, year, month, true);
  } else {
    content.innerHTML = '<div class="spinner"></div>';
  }

  // ── STEP 2: バックグラウンドで差分同期 ────────────
  syncInBackground(year, month, hasCached);
}

// キャッシュ or 最新データで画面を描画
async function renderContent(content, accounts, transactions, year, month, fromCache = false) {
  resetPaging();
  _page    = 1;
  _hasMore = transactions.length >= PAGE_SIZE;

  const total = accounts.reduce((s,a) => s + a.balance, 0);

  // 月サマリーをローカル計算（キャッシュ時はネットワーク不要）
  const income  = transactions.filter(t=>t.type==='income' ).reduce((s,t)=>s+t.amount, 0);
  const expense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount, 0);

  const hidden = localStorage.getItem('flowra_balance_hidden') === '1';
  const maskNum = (n) => '••••••';
  const totalDisp = hidden
    ? '<span class="s-currency" style="opacity:0.5;">¥</span><span class="s-number" style="letter-spacing:2px;">••••••</span>'
    : (total < 0
        ? '<span class="s-currency" style="color:rgba(255,255,255,0.5)">−¥</span><span class="s-number">' + fmt(Math.abs(total)) + '</span>'
        : '<span class="s-currency">¥</span><span class="s-number">' + fmt(total) + '</span>');

  const summaryHTML = `
    <div class="summary-row">
      <div class="s-card total" id="s-card-total" style="cursor:pointer;user-select:none;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="s-card-label">総残高</div>
          <div id="btn-toggle-balance" style="font-size:11px;opacity:0.6;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.15);">
            ${hidden ? '表示' : '隠す'}
          </div>
        </div>
        <div class="s-amount" id="s-total-amount">${totalDisp}</div>
        <div class="s-sub">全口座合計${fromCache ? ' <span style="font-size:10px;opacity:0.4;">●</span>' : ''}</div>
      </div>
      <div class="s-card income-card">
        <div class="s-card-label">今月の収入</div>
        <div class="s-amount"><span class="s-currency">¥</span><span class="s-number">${fmt(income)}</span></div>
        <div class="s-sub">&nbsp;</div>
        <div class="s-accent-line"></div>
      </div>
      <div class="s-card expense-card">
        <div class="s-card-label">今月の支出</div>
        <div class="s-amount"><span class="s-currency">¥</span><span class="s-number">${fmt(expense)}</span></div>
        <div class="s-sub">&nbsp;</div>
        <div class="s-accent-line"></div>
      </div>
    </div>`;

    // 予算進捗を取得して表示
    let budgetHTML = '';
    try {
      const monthKey = `${year}-${String(month).padStart(2,'0')}`;
      const [budgetMap, tags] = await Promise.all([
        DB.getBudgets(monthKey),
        import('./cache.js').then(({ getCachedTags }) => getCachedTags())
      ]);
      const budgetEntries = Object.entries(budgetMap);
      if (budgetEntries.length > 0) {
        // タグIDで支出合計を集計
        const spendByTag = {};
        transactions.filter(t => t.type === 'expense').forEach(tx => {
          (tx.tags || []).filter(t => t).forEach(tag => {
            spendByTag[tag.id] = (spendByTag[tag.id] || 0) + tx.amount;
          });
        });

        // 総合計計算用
        let totalBudget = 0, totalSpent = 0;

        const rows = budgetEntries.map(([tagId, b]) => {
          const tag   = tags.find(t => t.id === tagId);
          if (!tag) return '';
          const spent = spendByTag[tagId] || 0;
          const rawPct = Math.round((spent / b.amount) * 100);
          const pct   = Math.min(100, rawPct);
          const over  = spent > b.amount;
          const color = over ? 'var(--red)' : pct >= 80 ? 'var(--gold)' : 'var(--sage)';
          totalBudget += b.amount;
          totalSpent  += spent;
          return `
            <div style="margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${tag.color||'var(--sage)'};flex-shrink:0;display:inline-block;"></span>
                  <span style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${tag.name}</span>
                  ${b.month ? `<span style="font-size:10px;color:var(--mid-lt);background:var(--mist);padding:1px 5px;border-radius:4px;flex-shrink:0;">${b.month.slice(5)}月</span>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                  <div style="font-size:12px;">
                    <span style="font-weight:600;color:${color};">¥${fmt(spent)}</span>
                    <span style="color:var(--mid-lt);"> / ¥${fmt(b.amount)}</span>
                  </div>
                  <span style="font-size:11px;font-weight:700;color:${color};min-width:34px;text-align:right;">${rawPct}%</span>
                </div>
              </div>
              <div style="height:6px;border-radius:3px;background:var(--mist);overflow:hidden;">
                <div style="height:100%;width:${pct}%;border-radius:3px;background:${color};transition:width 0.4s;"></div>
              </div>
              ${over ? `<div style="font-size:10px;color:var(--red);margin-top:3px;text-align:right;">¥${fmt(spent-b.amount)} オーバー</div>` : ''}
            </div>`;
        }).filter(Boolean).join('');

        if (rows) {
          const validCount = budgetEntries.filter(([tid]) => tags.find(t => t.id === tid)).length;
          const totalPct   = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
          const totalColor = totalSpent > totalBudget ? 'var(--red)' : totalPct >= 80 ? 'var(--gold)' : 'var(--sage)';
          const totalRow   = validCount >= 2 ? `
            <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                <span style="font-size:12px;font-weight:600;color:var(--mid);">合計</span>
                <div style="display:flex;align-items:center;gap:6px;">
                  <div style="font-size:12px;">
                    <span style="font-weight:700;color:${totalColor};">¥${fmt(totalSpent)}</span>
                    <span style="color:var(--mid-lt);"> / ¥${fmt(totalBudget)}</span>
                  </div>
                  <span style="font-size:12px;font-weight:700;color:${totalColor};min-width:34px;text-align:right;">${totalPct}%</span>
                </div>
              </div>
              <div style="height:7px;border-radius:3px;background:var(--mist);overflow:hidden;">
                <div style="height:100%;width:${Math.min(100,totalPct)}%;border-radius:3px;background:${totalColor};transition:width 0.4s;"></div>
              </div>
            </div>` : '';

          budgetHTML = `
            <div class="panel" style="margin-bottom:0;">
              <div class="panel-head">
                <div class="panel-title">今月の予算</div>
                <div class="panel-link" id="link-budget-setting">設定
                  <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </div>
              <div style="padding:4px 18px 16px;">${rows}${totalRow}</div>
            </div>`;
        }
      }
    } catch(e) { /* 予算取得失敗は無視 */ }

    // 口座一覧
    const acctHTML = accounts.map((a,i) => `
      ${i > 0 ? '<div class="acct-divider"></div>' : ''}
      <div class="acct-item">
        <div class="acct-left">
          ${acctIconSVG(a.type)}
          <div>
            <div class="acct-name">${a.name}</div>
            <div class="acct-type-label">${ACCT_TYPE_LABEL[a.type]||a.type}</div>
          </div>
        </div>
        <div class="acct-balance" style="color:${a.balance<0?'var(--red)':'var(--ink)'}">
          ${a.balance < 0 ? '<span class="acct-balance-cur" style="color:var(--red)">−¥</span>' : '<span class="acct-balance-cur">¥</span>'}${fmt(Math.abs(a.balance))}
        </div>
      </div>`).join('');

    // 記録一覧
    const firstPage = transactions.slice(0, PAGE_SIZE);
    const grouped = groupByDate(firstPage);
    let txRows = Object.entries(grouped).map(([date, txs]) =>
      `<div class="tx-date-label">${formatDate(date)}</div>${txs.map(txItemHTML).join('')}`
    ).join('');

    if (!txRows) {
      txRows = `<div class="empty-state">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div class="empty-state-title">記録がありません</div>
        <div class="empty-state-sub">＋ボタンから記録を追加してください</div>
      </div>`;
    }

    content.innerHTML = `
      ${summaryHTML}
      ${budgetHTML}
      <div class="panel" id="ai-summary-panel" style="margin-bottom:0;">
        <div class="panel-head">
          <div class="panel-title" style="display:flex;align-items:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            AIに聞く
          </div>
        </div>
        <div style="padding:0 14px 14px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn-ai-q" data-q="monthly"
            style="font-size:12px;padding:6px 12px;border-radius:20px;border:1.5px solid var(--sage);
              background:none;color:var(--sage);cursor:pointer;font-weight:500;white-space:nowrap;">
            今月どう？
          </button>
          <button class="btn-ai-q" data-q="compare"
            style="font-size:12px;padding:6px 12px;border-radius:20px;border:1.5px solid var(--border);
              background:none;color:var(--mid);cursor:pointer;font-weight:500;white-space:nowrap;">
            先月と比べて
          </button>
          <button class="btn-ai-q" data-q="saving"
            style="font-size:12px;padding:6px 12px;border-radius:20px;border:1.5px solid var(--border);
              background:none;color:var(--mid);cursor:pointer;font-weight:500;white-space:nowrap;">
            節約ヒント
          </button>
        </div>
        <div id="ai-answer" style="display:none;padding:0 16px 16px;"></div>
      </div>
      <div class="main-grid">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">口座残高</div>
            <div class="panel-link" id="link-acct-manage">管理
              <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
          ${acctHTML}
          <div class="acct-total">
            <div class="acct-total-label">合計</div>
            <div class="acct-total-amount"><span style="font-size:11px;font-weight:300;color:var(--mid);margin-right:1px;">¥</span>${fmt(total)}</div>
          </div>
        </div>
        <div class="panel" id="tx-panel">
          <div class="panel-head"><div class="panel-title">記録一覧</div></div>
          <div id="tx-list">${txRows}</div>
          <div id="tx-sentinel" style="height:1px;"></div>
          ${_hasMore ? '<div id="tx-loading" style="padding:16px;text-align:center;font-size:12px;color:var(--mid);">読み込み中…</div>' : ''}
        </div>
      </div>`;

  document.getElementById('link-acct-manage')?.addEventListener('click', () => {
    import('./router.js').then(({ Router }) => Router.navigate('accounts'));
  });
  document.getElementById('link-budget-setting')?.addEventListener('click', () => {
    import('./router.js').then(({ Router }) => Router.navigate('settings'));
  });
  setupBalanceToggle();
  setupAiSummary(transactions, year, month);

  // 記録行タップ → 編集シート
  document.querySelectorAll('.tx-item[data-tx-id]').forEach(el => {
    if (el.dataset.clickBound) return; // 重複登録防止
    el.dataset.clickBound = '1';
    el.addEventListener('click', () => {
      const tx = transactions.find(t => t.id === el.dataset.txId);
      if (tx) openEditRecord(tx, () => renderDashboard());
    });
  });

  if (_hasMore) setupInfiniteScroll(year, month);
}

// バックグラウンド差分同期
async function syncInBackground(year, month, hadCache) {
  try {
    const lastSync = await getLastSync();
    const now = new Date().toISOString();

    // 口座は毎回取得（件数が少ないので軽い）
    const [accounts, result] = await Promise.all([
      DB.getAccounts(),
      DB.getTransactions({ year, month, pageSize: 500 }),
    ]);

    // IndexedDB に保存
    await putAccounts(accounts);
    await upsertTransactions(result.data);
    await setLastSync(now);

    // キャッシュなしで初回ロードしていた場合は画面を更新
    if (!hadCache) {
      const content = document.getElementById('page-content');
      if (content) renderContent(content, accounts, result.data, year, month, false);
    } else {
      // キャッシュありの場合：差分があれば静かに更新
      if (lastSync) {
        const delta = await DB.getDelta(lastSync);
        if (delta && delta.length > 0) {
          await upsertTransactions(delta);
          // サマリー数字だけ静かに更新（スクロール位置を維持）
          const fresh = await getCachedTransactions({ year, month });
          const income  = fresh.filter(t=>t.type==='income' ).reduce((s,t)=>s+t.amount,0);
          const expense = fresh.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
          const incomeEl  = document.querySelector('.income-card .s-number');
          const expenseEl = document.querySelector('.expense-card .s-number');
          if (incomeEl)  incomeEl.textContent  = fmt(income);
          if (expenseEl) expenseEl.textContent = fmt(expense);
        }
      }
    }
  } catch (e) {
    console.warn('Background sync failed:', e.message);
    // キャッシュなしでスピナーのまま止まるのを防ぐ
    if (!hadCache) {
      const content = document.getElementById('page-content');
      if (content && content.querySelector('.spinner')) {
        content.innerHTML = `
          <div class="empty-state" style="margin-top:80px;">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div class="empty-state-title">読み込みに失敗しました</div>
            <div id="err-detail" style="font-size:11px;word-break:break-all;padding:4px 16px;color:var(--mid);"></div>
            <button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:var(--sage);color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;">再読み込み</button>
          </div>`;
        const errEl = document.getElementById('err-detail');
        if (errEl) errEl.textContent = e.message || String(e);
      }
    }
  }
}

const SUPABASE_URL = 'https://copyzpsyagscqrvkrwjo.supabase.co';
const SUPABASE_ANON_KEY_AI = (() => {
  // config.jsのkeyを再利用
  const m = document.querySelector('script[src*="config"]');
  return window._supabaseAnonKey || '';
})();

function setupAiSummary(transactions, year, month) {
  const btns = document.querySelectorAll('.btn-ai-q');
  const answerEl = document.getElementById('ai-answer');
  if (!btns.length || !answerEl) return;

  // タグ別支出集計
  function getTagBreakdown(txList) {
    const map = {};
    txList.filter(t => t.type === 'expense').forEach(tx => {
      (tx.tags || []).filter(t => t).forEach(tag => {
        if (!map[tag.id]) map[tag.id] = { name: tag.name, amount: 0 };
        map[tag.id].amount += tx.amount;
      });
    });
    return Object.values(map);
  }

  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const q = btn.dataset.q;

      // ボタンスタイル切り替え
      btns.forEach(b => {
        b.style.border = '1.5px solid var(--border)';
        b.style.color = 'var(--mid)';
        b.style.background = 'none';
      });
      btn.style.border = '1.5px solid var(--sage)';
      btn.style.color = 'var(--sage)';
      btn.style.background = 'var(--sage-bg)';

      // ローディング表示
      answerEl.style.display = 'block';
      answerEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;color:var(--mid);font-size:13px;">
          <div style="width:14px;height:14px;border:2px solid var(--sage);border-top-color:transparent;
            border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;"></div>
          考え中…
        </div>`;

      try {
        // 先月データ取得
        const prevM = month === 1 ? 12 : month - 1;
        const prevY = month === 1 ? year - 1 : year;
        const prevData = await DB.getTransactions({ year: prevY, month: prevM, pageSize: 1000 });
        const prevTxs  = prevData.data || [];
        const prevIncome  = prevTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const prevExpense = prevTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        // 予算データ
        const monthKey = year + '-' + String(month).padStart(2, '0');
        const budgetMap = await DB.getBudgets(monthKey);
        const spendByTag = {};
        transactions.filter(t => t.type === 'expense').forEach(tx => {
          (tx.tags || []).filter(t => t).forEach(tag => {
            spendByTag[tag.id] = (spendByTag[tag.id] || 0) + tx.amount;
          });
        });
        const budgets = Object.entries(budgetMap).map(([tagId, b]) => ({
          name: b.tag_name || tagId,
          amount: b.amount,
          spent: spendByTag[tagId] || 0,
        }));

        const income  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        // Edge Functionを呼ぶ
        import('./config.js').then(async ({ supabase }) => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token || '';

          const res = await fetch(SUPABASE_URL + '/functions/v1/flowra-ai', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token,
              'apikey': token,
            },
            body: JSON.stringify({
              question: q,
              data: {
                year, month,
                income, expense,
                tagBreakdown: getTagBreakdown(transactions),
                budgets,
                prevYear: prevY, prevMonth: prevM,
                prevIncome, prevExpense,
                prevTagBreakdown: getTagBreakdown(prevTxs),
              },
            }),
          });

          const json = await res.json();
          if (json.error) throw new Error(json.error);

          const answerText = json.answer.split('\n').join('<br>');
          answerEl.innerHTML = '<div style="font-size:13px;line-height:1.75;color:var(--ink);background:var(--sage-bg);border-radius:12px;padding:12px 14px;">' + answerText + '</div>';
        });
      } catch (e) {
        answerEl.innerHTML = `<div style="font-size:12px;color:var(--red);padding:4px 0;">エラー: ${e.message}</div>`;
      }
    });
  });
}

function setupBalanceToggle() {
  const card = document.getElementById('s-card-total');
  if (!card || card.dataset.toggleBound) return; // 重複登録防止
  card.dataset.toggleBound = '1';
  card.addEventListener('click', () => {
    const isHidden = localStorage.getItem('flowra_balance_hidden') === '1';
    localStorage.setItem('flowra_balance_hidden', isHidden ? '0' : '1');
    renderDashboard();
  });
}

function setupInfiniteScroll(year, month) {
  const sentinel = document.getElementById('tx-sentinel');
  if (!sentinel) return;

  _observer = new IntersectionObserver(async entries => {
    if (!entries[0].isIntersecting || _loading || !_hasMore) return;
    _loading = true;

    try {
      const result = await DB.getTransactions({ year, month, page: _page });
      _page++;
      _hasMore = result.hasMore;
      _loading = false;

      // 追加データをリストに追記
      const list = document.getElementById('tx-list');
      if (!list) return;

      const grouped = groupByDate(result.data);
      const html = Object.entries(grouped).map(([date, txs]) =>
        `<div class="tx-date-label">${formatDate(date)}</div>${txs.map(txItemHTML).join('')}`
      ).join('');
      list.insertAdjacentHTML('beforeend', html);

      // ローディング表示を消す
      if (!_hasMore) {
        document.getElementById('tx-loading')?.remove();
        _observer.disconnect();
      }

    } catch (e) {
      _loading = false;
      console.error('infinite scroll error:', e);
    }
  }, { threshold: 0.1 });

  _observer.observe(sentinel);
}
