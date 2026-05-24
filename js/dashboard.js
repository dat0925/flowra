// ─────────────────────────────────────
//  dashboard.js  ホーム画面
// ─────────────────────────────────────
import { DB }         from './db.js';
import { MonthState } from './router.js';
import { fmt }        from './app.js';

// 口座タイプ別アイコン・カラー
const ACCT_ICON = {
  cash:   { bg: '#F0EDE8', stroke: '#7A9485', path: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>' },
  bank:   { bg: '#EEF3FF', stroke: '#3B6FBF', path: '<path d="M3 22V8l9-6 9 6v14H3z"/><path d="M9 22V12h6v10"/>' },
  ic:     { bg: '#EEF5F1', stroke: '#4A7C59', path: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6M9 10h6"/><circle cx="12" cy="16" r="1"/>' },
  qr:     { bg: '#FFF2EB', stroke: '#C4602A', path: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h4"/><circle cx="12" cy="16" r="1"/>' },
  credit: { bg: '#F5F0FF', stroke: '#7B5EA7', path: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
  other:  { bg: '#F0EDE8', stroke: '#7A9485', path: '<rect x="2" y="5" width="20" height="14" rx="2"/>' },
};
const ACCT_TYPE_LABEL = { cash:'現金', bank:'銀行', ic:'ICカード', qr:'QRコード', credit:'クレカ', other:'その他' };

// 記録アイコン（typeごと）
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
  return tags.map(t => `<span class="tx-tag tx-tag-muted">${t.name}</span>`).join('');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日','月','火','水','木','金','土'];
  return `${d.getMonth()+1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

export async function renderDashboard() {
  const content = document.getElementById('page-content');
  const { year, month } = MonthState;

  try {
    const [accounts, summary, transactions] = await Promise.all([
      DB.getAccounts(),
      DB.getMonthlySummary(year, month),
      DB.getTransactions({ year, month }),
    ]);

    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

    // サマリーカード
    const summaryHTML = `
      <div class="summary-row">
        <div class="s-card total">
          <div class="s-card-label">総残高</div>
          <div class="s-amount">
            <span class="s-currency">¥</span>
            <span class="s-number">${fmt(totalBalance)}</span>
          </div>
          <div class="s-sub">全口座合計</div>
        </div>
        <div class="s-card income-card">
          <div class="s-card-label">今月の収入</div>
          <div class="s-amount">
            <span class="s-currency">¥</span>
            <span class="s-number">${fmt(summary.income)}</span>
          </div>
          <div class="s-sub">&nbsp;</div>
          <div class="s-accent-line"></div>
        </div>
        <div class="s-card expense-card">
          <div class="s-card-label">今月の支出</div>
          <div class="s-amount">
            <span class="s-currency">¥</span>
            <span class="s-number">${fmt(summary.expense)}</span>
          </div>
          <div class="s-sub">&nbsp;</div>
          <div class="s-accent-line"></div>
        </div>
      </div>`;

    // 口座一覧
    const acctItemsHTML = accounts.map((a, i) => `
      ${i > 0 ? '<div class="acct-divider"></div>' : ''}
      <div class="acct-item">
        <div class="acct-left">
          ${acctIconSVG(a.type)}
          <div>
            <div class="acct-name">${a.name}</div>
            <div class="acct-type-label">${ACCT_TYPE_LABEL[a.type] || a.type}</div>
          </div>
        </div>
        <div class="acct-balance" style="color:${a.balance < 0 ? 'var(--red)' : 'var(--ink)'}">
          <span class="acct-balance-cur">¥</span>${fmt(Math.abs(a.balance))}
        </div>
      </div>`).join('');

    const acctPanelHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">口座残高</div>
          <div class="panel-link" onclick="Router.navigate('accounts')">
            管理
            <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        ${acctItemsHTML}
        <div class="acct-total">
          <div class="acct-total-label">合計</div>
          <div class="acct-total-amount"><span style="font-size:11px;font-weight:300;color:var(--mid);margin-right:1px;">¥</span>${fmt(totalBalance)}</div>
        </div>
      </div>`;

    // 記録一覧（日付グループ）
    let txHTML = '';
    if (transactions.length === 0) {
      txHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div class="empty-state-title">記録がありません</div>
        <div class="empty-state-sub">＋ボタンから記録を追加してください</div>
      </div>`;
    } else {
      // 日付グループ化
      const grouped = {};
      transactions.forEach(tx => {
        if (!grouped[tx.date]) grouped[tx.date] = [];
        grouped[tx.date].push(tx);
      });

      txHTML = Object.entries(grouped).map(([date, txs]) => `
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
              <div class="tx-account-name">${tx.account?.name || ''}</div>
            </div>
          </div>`;
        }).join('')}
      `).join('');
    }

    const txPanelHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">記録一覧</div>
        </div>
        ${txHTML}
      </div>`;

    content.innerHTML = `
      ${summaryHTML}
      <div class="main-grid">
        ${acctPanelHTML}
        ${txPanelHTML}
      </div>`;

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">読み込みエラー</div>
      <div class="empty-state-sub">${err.message}</div>
    </div>`;
  }
}
