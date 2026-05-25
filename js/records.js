// ─────────────────────────────────────
//  records.js  記録一覧画面
// ─────────────────────────────────────
import { DB }         from './db.js';
import { MonthState } from './router.js';
import { fmt }        from './utils.js';

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
  const weekdays = ['日','月','火','水','木','金','土'];
  return `${d.getMonth()+1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

function tagsHTML(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.map(t => `<span class="tx-tag tx-tag-muted">${t.name}</span>`).join('');
}

let currentFilter = 'all';
let searchQuery = '';

export async function renderRecords() {
  const content = document.getElementById('page-content');
  const { year, month } = MonthState;

  try {
    const [summary, result] = await Promise.all([
      DB.getMonthlySummary(year, month),
      DB.getTransactions({ year, month, pageSize: 500 }), // 記録一覧は多め取得
    ]);
    const transactions = result.data;

    // フィルター適用
    let filtered = transactions.filter(tx => {
      if (currentFilter !== 'all' && tx.type !== currentFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!(tx.memo || '').toLowerCase().includes(q) &&
            !(tx.account?.name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    // サマリーバー
    const balance = summary.income - summary.expense;
    const summaryBar = `
      <div class="records-summary-bar">
        <div class="rsb-item">
          <div class="rsb-label">収入</div>
          <div class="rsb-amount income">¥${fmt(summary.income)}</div>
        </div>
        <div class="rsb-divider"></div>
        <div class="rsb-item">
          <div class="rsb-label">支出</div>
          <div class="rsb-amount expense">¥${fmt(summary.expense)}</div>
        </div>
        <div class="rsb-divider"></div>
        <div class="rsb-item">
          <div class="rsb-label">収支</div>
          <div class="rsb-amount ${balance >= 0 ? 'income' : 'expense'}">${balance >= 0 ? '+' : '−'}¥${fmt(Math.abs(balance))}</div>
        </div>
      </div>`;

    // フィルターバー
    const filters = [
      { key: 'all', label: 'すべて' },
      { key: 'expense', label: '支出' },
      { key: 'income', label: '収入' },
      { key: 'transfer', label: '振替' },
    ];
    const filterBar = `
      <div class="records-filter-bar">
        <div class="filter-tabs">
          ${filters.map(f => `
            <button class="filter-tab ${currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>
          `).join('')}
        </div>
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="search-input" placeholder="メモ・口座で検索" value="${searchQuery}" id="records-search">
        </div>
      </div>`;

    // 記録リスト
    let listHTML = '';
    if (filtered.length === 0) {
      listHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div class="empty-state-title">記録がありません</div>
        <div class="empty-state-sub">＋ボタンから記録を追加してください</div>
      </div>`;
    } else {
      const grouped = {};
      filtered.forEach(tx => {
        if (!grouped[tx.date]) grouped[tx.date] = [];
        grouped[tx.date].push(tx);
      });

      listHTML = Object.entries(grouped).map(([date, txs]) => `
        <div class="tx-date-label">${formatDate(date)}</div>
        ${txs.map(tx => {
          const sign = tx.type === 'income' ? '+¥' : tx.type === 'expense' ? '−¥' : '¥';
          const acctName = tx.type === 'transfer'
            ? `${tx.account?.name || ''} → ${tx.to_account?.name || ''}`
            : tx.account?.name || '';
          return `
          <div class="tx-item">
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
            </div>
          </div>`;
        }).join('')}
      `).join('');
    }

    content.innerHTML = `
      ${summaryBar}
      <div class="records-wrap">
        ${filterBar}
        <div class="panel records-list">
          ${listHTML}
        </div>
      </div>`;

    // フィルタータブのイベント
    content.querySelectorAll('.filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        renderRecords();
      });
    });

    // 検索のイベント
    const searchInput = content.querySelector('#records-search');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        searchQuery = e.target.value;
        renderRecords();
      });
    }

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">読み込みエラー</div>
      <div class="empty-state-sub">${err.message}</div>
    </div>`;
  }
}
