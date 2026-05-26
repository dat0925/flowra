// ─────────────────────────────────────
//  records.js  記録一覧画面
//  キャッシュ優先 + バックグラウンド同期
// ─────────────────────────────────────
import { DB }         from './db.js';
import { MonthState } from './router.js';
import { fmt }        from './utils.js';
import { getCachedTransactions, upsertTransactions, putAccounts } from './cache.js';
import { openEditRecord } from './edit-record.js';

const TX_ICON = {
  income:   { bg: '#EEF5F1', stroke: '#4A7C59', path: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
  expense:  { bg: '#F0EDE8', stroke: '#7A9485', path: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
  transfer: { bg: '#FBF5E6', stroke: '#B8973E', path: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
};

function txIconSVG(type) {
  const ic = TX_ICON[type] || TX_ICON.expense;
  return `<div class="tx-icon" style="background:${ic.bg};">
    <svg viewBox="0 0 24 24" style="stroke:${ic.stroke}">${ic.path}</svg>
  </div>`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['日','月','火','水','木','金','土'];
  return `${d.getMonth()+1}月${d.getDate()}日（${w[d.getDay()]}）`;
}

function tagsHTML(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.map(t => `<span class="tx-tag tx-tag-muted">${t.name}</span>`).join('');
}

// ── 状態（画面遷移後もリセット）──
let currentFilter = 'all';
let searchQuery   = '';
let _allTx        = [];  // 全件キャッシュ（フィルター用）

export async function renderRecords() {
  const content = document.getElementById('page-content');
  const { year, month } = MonthState;

  currentFilter = 'all';
  searchQuery   = '';

  // ── STEP 1: キャッシュから即表示 ──
  const cachedTxs = await getCachedTransactions({ year, month });
  if (cachedTxs.length > 0) {
    _allTx = cachedTxs;
    renderShell(cachedTxs, year, month);
  } else {
    content.innerHTML = '<div class="spinner"></div>';
  }

  // ── STEP 2: バックグラウンドで最新取得 ──
  try {
    const [summary, result, accounts] = await Promise.all([
      DB.getMonthlySummary(year, month),
      DB.getTransactions({ year, month, pageSize: 500 }),
      DB.getAccounts(),
    ]);

    // キャッシュ更新
    await upsertTransactions(result.data);
    await putAccounts(accounts);

    _allTx = result.data;

    // キャッシュなしで初回の場合 or データ更新があった場合に再描画
    const needsUpdate = cachedTxs.length === 0 || result.data.length !== cachedTxs.length;
    if (needsUpdate) {
      renderShell(result.data, year, month);
    } else {
      // サマリーバーだけ静かに更新
      updateSummaryBar(summary);
    }

  } catch (e) {
    if (cachedTxs.length === 0) {
      content.innerHTML = `<div class="empty-state">
        <div class="empty-state-title">読み込みエラー</div>
        <div class="empty-state-sub">${e.message}</div>
      </div>`;
    }
    // キャッシュがあれば古いデータのまま表示継続（エラー無視）
  }
}

function renderShell(transactions, year, month) {
  const content = document.getElementById('page-content');
  const income  = transactions.filter(t=>t.type==='income' ).reduce((s,t)=>s+t.amount,0);
  const expense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const balance = income - expense;

  content.innerHTML = `
    <div class="records-summary-bar" id="records-summary">
      <div class="rsb-item">
        <div class="rsb-label">収入</div>
        <div class="rsb-amount income">¥${fmt(income)}</div>
      </div>
      <div class="rsb-divider"></div>
      <div class="rsb-item">
        <div class="rsb-label">支出</div>
        <div class="rsb-amount expense">¥${fmt(expense)}</div>
      </div>
      <div class="rsb-divider"></div>
      <div class="rsb-item">
        <div class="rsb-label">収支</div>
        <div class="rsb-amount ${balance>=0?'income':'expense'}">${balance>=0?'+':'−'}¥${fmt(Math.abs(balance))}</div>
      </div>
    </div>

    <div class="records-filter-bar">
      <div class="filter-tabs" id="filter-tabs">
        <button class="filter-tab active" data-filter="all">すべて</button>
        <button class="filter-tab" data-filter="expense">支出</button>
        <button class="filter-tab" data-filter="income">収入</button>
        <button class="filter-tab" data-filter="transfer">振替</button>
      </div>
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="search-input" placeholder="メモ・口座で検索" id="records-search">
      </div>
    </div>

    <div id="records-list"></div>`;

  renderList();

  document.getElementById('filter-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.filter-tab');
    if (!btn) return;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    requestAnimationFrame(() => renderList());
  });

  document.getElementById('records-search')?.addEventListener('input', e => {
    searchQuery = e.target.value;
    requestAnimationFrame(() => renderList());
  });
}

function updateSummaryBar(summary) {
  const income  = document.querySelector('#records-summary .rsb-amount.income');
  const expense = document.querySelector('#records-summary .rsb-amount.expense');
  if (income)  income.textContent  = `¥${fmt(summary.income)}`;
  if (expense) expense.textContent = `¥${fmt(summary.expense)}`;
}

// リスト部分だけ更新（フィルター・検索変更時）
function renderList() {
  const listEl = document.getElementById('records-list');
  if (!listEl) return;

  const q = searchQuery.toLowerCase();
  const filtered = _allTx.filter(tx => {
    if (currentFilter !== 'all' && tx.type !== currentFilter) return false;
    if (q) {
      if (!(tx.memo || '').toLowerCase().includes(q) &&
          !(tx.account?.name || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div class="empty-state-title">記録がありません</div>
      <div class="empty-state-sub">＋ボタンから記録を追加してください</div>
    </div>`;
    return;
  }

  // 日付グループ化
  const grouped = {};
  filtered.forEach(tx => {
    if (!grouped[tx.date]) grouped[tx.date] = [];
    grouped[tx.date].push(tx);
  });

  listEl.innerHTML = `
    <div class="panel">
      ${Object.entries(grouped).map(([date, txs]) => `
        <div class="tx-date-label">${formatDate(date)}</div>
        ${txs.map(tx => {
          const sign = tx.type==='income' ? '+¥' : tx.type==='expense' ? '−¥' : '¥';
          const acctName = tx.type==='transfer'
            ? `${tx.account?.name||''} → ${tx.to_account?.name||''}`
            : tx.account?.name || '';
          return `
            <div class="tx-item" data-tx-id="${tx.id}" style="cursor:pointer;">
              ${txIconSVG(tx.type)}
              <div class="tx-body">
                <div class="tx-name">${tx.memo || '（メモなし）'}</div>
                <div class="tx-meta">
                  <span class="tx-acct">${acctName}</span>
                  ${tagsHTML(tx.tags)}
                  ${tx.is_unsettled ? '<span class="unsettled-dot"></span><span style="font-size:11px;color:var(--gold);font-weight:500;">未精算</span>' : ''}
                </div>
              </div>
              <div class="tx-right">
                <div class="tx-amount ${tx.type}">
                  <span class="tx-currency">${sign}</span>${fmt(tx.amount)}
                </div>
                <div class="tx-account-name">${tx.account?.name || ''}</div>
              </div>
            </div>`;
        }).join('')}
      `).join('')}
    </div>`;

  // 記録行タップ → 編集シート
  listEl.querySelectorAll('.tx-item[data-tx-id]').forEach(el => {
    el.addEventListener('click', () => {
      const tx = filtered.find(t => t.id === el.dataset.txId);
      if (tx) openEditRecord(tx, () => {
        // 保存・削除後にリストを更新
        import('./router.js').then(({ MonthState: ms }) => {
          DB.getTransactions({ year: ms.year, month: ms.month, pageSize: 500 })
            .then(r => { _allTx = r.data; renderList(); })
            .catch(() => {});
        });
      });
    });
  });
}
