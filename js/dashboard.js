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
import { supabase }     from './config.js';

const PAGE_SIZE = 50;

// AIアドバイスのメモリキャッシュ（SPA内ナビゲーション間で保持）
let _aiAdviceCache = null; // { answer, question, ts, year, month }
export function clearAiAdviceCache() { _aiAdviceCache = null; }
let _freeAnswerCache = null; // { answer, ts, year, month }
let _freeHistoryCache = []; // [{ q, a }, ...] 画面切り替えをまたいで保持
let _limitShownThisSession = false; // AI上限ポップアップは1セッション1回のみ

// 自動一言アドバイス（ページ読み込み時）の永続キャッシュ
// 重要: _aiAdviceCacheはモジュール変数のためフルリロード（PWA再起動・iOSのバックグラウンド
// プロセス終了後の再起動等）で消える。これに加えて、これまで自動一言の.then()内で
// _aiAdviceCacheへの保存が行われていなかったため「ホームに来るたび」呼ばれ続けていた
// （SPA内のタブ切り替えで戻るだけでも再実行される状態だった）。
// localStorageにチーム×年月単位で保存し、両方のケースで再呼び出しを防止する。
function _autoAdviceStorageKey() {
  const teamId = DB.getActiveTeamId() || 'noteam';
  return 'flowra_ai_auto_' + teamId;
}
function _loadAutoAdviceFromStorage() {
  try {
    const raw = localStorage.getItem(_autoAdviceStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function _saveAutoAdviceToStorage(payload) {
  try { localStorage.setItem(_autoAdviceStorageKey(), JSON.stringify(payload)); } catch {}
}

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
  syncInBackground(year, month, hasCached, cachedTxs.length);
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
    <div style="margin-bottom:14px;">
      <div class="s-card total" id="s-card-total" style="cursor:pointer;user-select:none;margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="s-card-label">総残高</div>
          <div id="btn-toggle-balance" style="font-size:11px;opacity:0.6;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.15);">
            ${hidden ? '表示' : '残高・収入を隠す'}
          </div>
        </div>
        <div class="s-amount" id="s-total-amount">${totalDisp}</div>
        <div class="s-sub">全口座合計${fromCache ? ' <span style="font-size:10px;opacity:0.4;">●</span>' : ''}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="s-card income-card" style="overflow:hidden;">
          <div class="s-card-label">今月の収入</div>
          <div class="s-amount" style="white-space:nowrap;overflow:hidden;">
            ${hidden
              ? '<span class="s-currency" style="opacity:0.4;">¥</span><span class="s-number" style="font-size:30px;letter-spacing:2px;color:var(--sage-lt);">••••••</span>'
              : '<span class="s-currency">¥</span><span class="s-number" style="font-size:30px;">' + fmt(income) + '</span>'
            }
          </div>
          <div class="s-accent-line"></div>
        </div>
        <div class="s-card expense-card" style="overflow:hidden;">
          <div class="s-card-label">今月の支出</div>
          <div class="s-amount" style="white-space:nowrap;overflow:hidden;">
            <span class="s-currency">¥</span>
            <span class="s-number" style="font-size:30px;">${fmt(expense)}</span>
          </div>
          <div class="s-accent-line"></div>
        </div>
      </div>
    </div>`;

    // 予算進捗を取得して表示
    let budgetHTML = '';
    try {
      const monthKey = `${year}-${String(month).padStart(2,'0')}`;
      const [budgetMap, tags] = await Promise.all([
        DB.getBudgets(monthKey),
        DB.getTags()
      ]);
      const budgetEntries = Object.entries(budgetMap);
      if (budgetEntries.length > 0) {
        // タグIDで支出合計を集計
        const spendByTag = {};
        transactions.filter(t => t.type === 'expense' && !t.is_excluded).forEach(tx => {
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
              <div class="panel-head ac-head" data-ac="budget-body" style="cursor:pointer;">
                <div style="display:flex;align-items:center;gap:5px;">
                  <div class="panel-title">予算 <span style="font-size:11px;font-weight:400;color:var(--mid);margin-left:4px;">${year}年${month}月</span></div>
                  <svg id="ac-chevron-budget" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--sage)" stroke-width="2.5" style="transition:transform 0.25s;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <div class="panel-link" id="link-budget-setting">設定
                  <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </div>
              ${validCount >= 2 ? `
              <div id="budget-summary-bar" style="padding:12px 18px 14px;border-top:1px solid var(--border);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
                  <span style="font-size:12px;font-weight:600;color:var(--mid);">合計</span>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:13px;font-weight:700;color:${totalColor};">¥${fmt(totalSpent)}</span>
                    <span style="font-size:12px;color:var(--mid-lt);">/ ¥${fmt(totalBudget)}</span>
                    <span style="font-size:12px;font-weight:700;color:${totalColor};min-width:34px;text-align:right;">${totalPct}%</span>
                  </div>
                </div>
                <div style="height:7px;border-radius:3px;background:var(--mist);overflow:hidden;">
                  <div style="height:100%;width:${Math.min(100,totalPct)}%;border-radius:3px;background:${totalColor};transition:width 0.4s;"></div>
                </div>
              </div>` : ''}
              <div id="budget-body" style="overflow:hidden;transition:max-height 0.28s ease;">
                <div style="padding:4px 18px 16px;">${rows}${totalRow}</div>
              </div>
            </div>`;
        } else {
          budgetHTML = `
            <div class="panel" style="margin-bottom:0;">
              <div class="panel-head" style="cursor:default;">
                <div class="panel-title">予算 <span style="font-size:11px;font-weight:400;color:var(--mid);margin-left:4px;">${year}年${month}月</span></div>
                <a id="link-budget-setting-empty" style="font-size:12px;color:var(--sage);text-decoration:none;cursor:pointer;">設定 ›</a>
              </div>
              <div style="padding:20px 18px 24px;text-align:center;">
                <div style="font-size:24px;margin-bottom:10px;">📊</div>
                <div style="font-size:13px;font-weight:500;color:var(--ink);margin-bottom:6px;">予算をまだ設定していません</div>
                <div style="font-size:12px;color:var(--mid);line-height:1.6;margin-bottom:16px;">タグごとに予算を設定すると<br>使いすぎを防げます</div>
                <button id="btn-go-budget-empty" style="padding:9px 24px;border-radius:100px;border:1.5px solid var(--sage);background:none;color:var(--sage);font-size:13px;font-weight:500;cursor:pointer;">予算を設定する</button>
              </div>
            </div>`;
        }
      }
    } catch(e) { console.error('[Budget]', e); /* 予算取得失敗は無視 */ }




    content.innerHTML = `
      ${summaryHTML}
      <div id="ai-summary-panel" style="
          background:var(--sage-bg);border:1.5px solid var(--sage-lt);
          border-radius:16px;margin-top:10px;margin-bottom:10px;overflow:hidden;">
        <div style="padding:14px 16px 12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:5px;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--sage)" stroke-width="2">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
              </svg>
              <span style="font-size:10px;font-weight:600;color:var(--sage);letter-spacing:0.08em;">AI アドバイス</span>
            </div>
            <div id="ai-usage-badge" style="font-size:11px;color:var(--mid-lt);"></div>
          </div>
          <!-- 回答エリア（ボタンを押すまで空） -->
          <div id="ai-auto-answer" style="display:none;font-size:13px;line-height:1.75;
            color:var(--ink);margin-bottom:10px;"></div>
          <div id="ai-timestamp" style="display:none;font-size:10px;color:var(--mid-lt);
            margin-bottom:8px;"></div>
          <!-- チップ群 -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-ai-q" data-q="monthly"
              style="font-size:11px;padding:5px 11px;border-radius:20px;
                border:1px solid var(--sage-lt);background:none;
                color:var(--sage);cursor:pointer;font-weight:500;white-space:nowrap;">
              今月どう？
            </button>
            <button class="btn-ai-q" data-q="compare"
              style="font-size:11px;padding:5px 11px;border-radius:20px;
                border:1px solid var(--border);background:none;
                color:var(--mid);cursor:pointer;font-weight:500;white-space:nowrap;">
              先月と比べて
            </button>
            <button class="btn-ai-q" data-q="saving"
              style="font-size:11px;padding:5px 11px;border-radius:20px;
                border:1px solid var(--border);background:none;
                color:var(--mid);cursor:pointer;font-weight:500;white-space:nowrap;">
              節約ヒント
            </button>
            <button class="btn-ai-q" data-q="toptag"
              style="font-size:11px;padding:5px 11px;border-radius:20px;
                border:1px solid var(--border);background:none;
                color:var(--mid);cursor:pointer;font-weight:500;white-space:nowrap;">
              一番多い支出は？
            </button>
            <button class="btn-ai-q" data-q="budget_check"
              style="font-size:11px;padding:5px 11px;border-radius:20px;
                border:1px solid var(--border);background:none;
                color:var(--mid);cursor:pointer;font-weight:500;white-space:nowrap;">
              予算内に収まりそう？
            </button>
          </div>
          <!-- フリー入力 -->
          <div style="display:flex;gap:6px;margin-top:10px;">
            <input id="ai-free-input" type="text" placeholder="今日いくら使った？　5/1の支出は？　など"
              style="flex:1;font-size:12px;padding:7px 12px;border-radius:20px;
                border:1px solid var(--border);background:var(--stone);
                color:var(--ink);outline:none;min-width:0;">
            <button id="ai-free-btn"
              style="font-size:12px;padding:7px 14px;border-radius:20px;
                border:none;background:var(--sage);color:#fff;
                cursor:pointer;font-weight:600;white-space:nowrap;flex-shrink:0;">
              聞く
            </button>
          </div>
          <div style="font-size:10px;color:var(--mid-lt);margin-top:5px;padding:0 2px;">
            直近3ヶ月の記録をもとに回答します
          </div>
        </div>
        <div id="ai-answer" style="display:none;padding:0 16px 14px;border-top:1px solid var(--sage-lt);padding-top:12px;margin-top:-2px;"></div>
      </div>
      ${budgetHTML}
`;


  document.getElementById('link-budget-setting')?.addEventListener('click', () => {
    import('./router.js').then(({ Router }) => Router.navigate('settings'));
  });
  document.getElementById('link-budget-setting-empty')?.addEventListener('click', () => {
    import('./router.js').then(({ Router }) => Router.navigate('settings'));
  });
  document.getElementById('btn-go-budget-empty')?.addEventListener('click', () => {
    import('./router.js').then(({ Router }) => Router.navigate('settings'));
  });
  setupBalanceToggle();
  setupAiSummary(transactions, year, month);
  setupAccordions();

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
async function syncInBackground(year, month, hadCache, cachedTxCount = 0) {
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

    // キャッシュなし or 当月取引が空 or 過去月の場合は画面を更新
    const isCurrentMonth = (() => {
      const now = new Date();
      return year === now.getFullYear() && month === now.getMonth() + 1;
    })();
    if (!hadCache || cachedTxCount === 0 || !isCurrentMonth) {
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
  const btns     = document.querySelectorAll('.btn-ai-q');
  const answerEl = document.getElementById('ai-answer');
  const autoEl   = document.getElementById('ai-auto-answer');

  // モジュール変数のキャッシュが無い場合（フルリロード直後等）はlocalStorageから復元を試みる
  if (!_aiAdviceCache) {
    const stored = _loadAutoAdviceFromStorage();
    if (stored && stored.year === year && stored.month === month) {
      _aiAdviceCache = stored;
    }
  }

  // 月が変わったらチップ回答・フリー回答・会話履歴をクリア
  const sameMonth = _aiAdviceCache && _aiAdviceCache.year === year && _aiAdviceCache.month === month;
  if (!sameMonth) {
    if (answerEl) { answerEl.style.display = 'none'; answerEl.innerHTML = ''; }
    _freeAnswerCache = null;
    _freeHistoryCache = [];
  }

  // チップ回答：同じ年月なら即復元
  if (sameMonth) {
    if (autoEl) {
      autoEl.style.display = 'block';
      autoEl.innerHTML = _aiAdviceCache.answer.split('\n').join('<br>');
    }
    const tsEl = document.getElementById('ai-timestamp');
    if (tsEl && _aiAdviceCache.ts) {
      const d = new Date(_aiAdviceCache.ts);
      const label = (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0');
      tsEl.style.display = 'block';
      tsEl.textContent = label + ' のアドバイス';
    }
  }

  // フリー回答：同じ年月なら即復元
  if (_freeAnswerCache && _freeAnswerCache.year === year && _freeAnswerCache.month === month) {
    if (answerEl) {
      answerEl.style.display = 'block';
      answerEl.innerHTML = _freeAnswerCache.answer.split('\n').join('<br>');
    }
    const tsEl = document.getElementById('ai-timestamp');
    if (tsEl && _freeAnswerCache.ts) {
      const d = new Date(_freeAnswerCache.ts);
      const label = (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0');
      tsEl.style.display = 'block';
      tsEl.textContent = label + ' の回答';
    }
  }

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

  // 過去3ヶ月のデータから固定費タグを推定
  // 毎月±20%以内のブレで継続して発生しているタグを固定費とみなす
  async function estimateFixedCostTags(currentYear, currentMonth) {
    try {
      const months = [];
      for (let i = 1; i <= 3; i++) {
        let m = currentMonth - i;
        let y = currentYear;
        if (m <= 0) { m += 12; y -= 1; }
        months.push({ year: y, month: m });
      }
      const results = await Promise.all(
        months.map(({ year, month }) => DB.getTransactions({ year, month, pageSize: 500 }))
      );
      // タグ別に各月の金額を収集
      const tagAmounts = {};
      results.forEach(r => {
        const breakdown = getTagBreakdown(r.data || []);
        breakdown.forEach(({ name, amount }) => {
          if (!tagAmounts[name]) tagAmounts[name] = [];
          tagAmounts[name].push(amount);
        });
      });
      // 3ヶ月すべてに登場 かつ 最大/最小の比が1.4以内 → 固定費と推定
      const fixedTags = new Set();
      Object.entries(tagAmounts).forEach(([name, amounts]) => {
        if (amounts.length < 2) return;
        const max = Math.max(...amounts);
        const min = Math.min(...amounts);
        if (min > 0 && max / min <= 1.4) fixedTags.add(name);
      });
      return fixedTags;
    } catch {
      return new Set();
    }
  }

  // 過去の確定済み月の平均収入を推定（給料未入金による「無収入っぽい」誤判定を防ぐための参考値）
  // 収入が0だった月（記録漏れ等の可能性）は平均から除外する
  async function estimateAvgIncome(currentYear, currentMonth) {
    try {
      const months = [];
      for (let i = 1; i <= 3; i++) {
        let m = currentMonth - i;
        let y = currentYear;
        if (m <= 0) { m += 12; y -= 1; }
        months.push({ year: y, month: m });
      }
      const results = await Promise.all(
        months.map(({ year, month }) => DB.getTransactions({ year, month, pageSize: 500 }))
      );
      const monthlyIncomes = results
        .map(r => (r.data || []).filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0))
        .filter(v => v > 0);
      if (monthlyIncomes.length === 0) return 0;
      return Math.round(monthlyIncomes.reduce((s, v) => s + v, 0) / monthlyIncomes.length);
    } catch {
      return 0;
    }
  }

  // Edge Function呼び出し（使用回数チェック付き）
  async function callAI(question, data) {
    const plan = await DB.getUserPlan().catch(() => 'free');
    const isAdmin = plan === 'admin';
    const isPremium = plan === 'premium';

    // 使用回数チェック（adminのみ完全無制限）
    if (!isAdmin) {
      const usage = await DB.getAiUsageThisMonth().catch(() => 0);
      const limit = isPremium ? DB.PREMIUM_AI_LIMIT : DB.FREE_AI_LIMIT;
      if (usage >= limit) {
        if (!_limitShownThisSession) {
          _limitShownThisSession = true;
          showUpgradeSheet(isPremium);
        }
        throw new Error('LIMIT_REACHED');
      }
    }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    const res = await fetch('https://copyzpsyagscqrvkrwjo.supabase.co/functions/v1/flowra-ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'apikey': token,
      },
      body: JSON.stringify({ question, data }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    // カウントアップ（admin以外）
    if (!isAdmin) DB.incrementAiUsage().catch(() => {});

    return json.answer;
  }

  function showUpgradeSheet(isPremium = false) {
    if (document.getElementById('upgrade-sheet')) return;
    const sheet = document.createElement('div');
    sheet.id = 'upgrade-sheet';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(28,43,34,0.5);'
      + 'display:flex;align-items:flex-end;justify-content:center;';

    const premiumContent = `
      <div style="font-size:32px;margin-bottom:12px;">✨</div>
      <div style="font-family:'Noto Serif JP',serif;font-size:20px;font-weight:600;
        color:var(--ink);margin-bottom:10px;">今月のAI利用上限に達しました</div>
      <div style="font-size:14px;color:var(--mid);line-height:1.7;margin-bottom:8px;">
        Premiumプランは月${DB.PREMIUM_AI_LIMIT.toLocaleString()}回まで利用できます。<br>
        来月になるとリセットされます。
      </div>
      <div style="font-size:12px;color:var(--mid-lt);margin-bottom:28px;">
        ※ サービスの原価ベースで設定した上限です
      </div>
      <button id="upgrade-sheet-close"
        style="width:100%;padding:15px;border-radius:14px;border:1.5px solid var(--border);
        background:var(--white);color:var(--mid);font-family:'Noto Sans JP',sans-serif;
        font-size:14px;cursor:pointer;">
        閉じる
      </button>`;

    const freeContent = `
      <div style="font-size:32px;margin-bottom:12px;">✨</div>
      <div style="font-family:'Noto Serif JP',serif;font-size:20px;font-weight:600;
        color:var(--ink);margin-bottom:10px;">今月のAI回数を使い切りました</div>
      <div style="font-size:14px;color:var(--mid);line-height:1.7;margin-bottom:8px;">
        無料プランは月${DB.FREE_AI_LIMIT}回まで利用できます。<br>
        Premiumプランで月${DB.PREMIUM_AI_LIMIT.toLocaleString()}回まで使えます。
      </div>
      <div style="font-size:12px;color:var(--mid-lt);margin-bottom:28px;">
        来月になるとリセットされます
      </div>
      <div style="background:var(--white);border-radius:18px;padding:20px;margin-bottom:16px;
        border:1.5px solid var(--sage-lt);">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--sage);
          margin-bottom:6px;">PREMIUM PLAN</div>
        <div style="display:flex;align-items:baseline;justify-content:center;gap:4px;margin-bottom:4px;">
          <span style="font-family:'Noto Serif JP',serif;font-size:32px;font-weight:700;
            color:var(--ink);">¥398</span>
          <span style="font-size:13px;color:var(--mid);">/ 月</span>
        </div>
        <div style="font-size:12px;color:var(--mid-lt);margin-bottom:16px;">
          2人で割れば ¥199 / 人
        </div>
        <ul style="text-align:left;list-style:none;padding:0;margin:0 0 16px;
          display:flex;flex-direction:column;gap:8px;">
          <li style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);">
            <span style="color:var(--sage);font-weight:700;">✓</span> AIアドバイス月${DB.PREMIUM_AI_LIMIT.toLocaleString()}回
          </li>
          <li style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);">
            <span style="color:var(--sage);font-weight:700;">✓</span> 口座・タグ無制限
          </li>
          <li style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);">
            <span style="color:var(--sage);font-weight:700;">✓</span> 新機能への優先アクセス
          </li>
        </ul>
        <button onclick="window.open('https://buy.stripe.com/00w00i1Rx4Lwbmy2c3fQI02','_blank')"
          style="width:100%;padding:15px;border-radius:14px;border:none;background:var(--sage);
          color:#fff;font-size:15px;font-weight:600;cursor:pointer;">
          Premiumプランに申し込む
        </button>
      </div>
      <button id="upgrade-sheet-close"
        style="background:none;border:none;color:var(--mid);font-size:13px;cursor:pointer;padding:8px;">
        来月まで待つ
      </button>`;

    sheet.innerHTML = `
      <div style="background:var(--stone);width:100%;max-width:480px;border-radius:24px 24px 0 0;
        padding:32px 24px 48px;text-align:center;">
        <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:0 auto 24px;"></div>
        ${isPremium ? premiumContent : freeContent}
      </div>`;

    document.body.appendChild(sheet);
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
    document.getElementById('upgrade-sheet-close')?.addEventListener('click', () => sheet.remove());
  }

  // 自動一言表示（ページ読み込み時・既存データのみ使用）
  // キャッシュ復元済みの場合はAPI呼び出しをスキップ
  if (autoEl && !(_aiAdviceCache && _aiAdviceCache.year === year && _aiAdviceCache.month === month)) {
    const income  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    const tid = setTimeout(() => {
      const el = document.getElementById('ai-auto-answer');
      if (el && el.innerHTML.includes('分析中')) {
        el.innerHTML = '<span style="color:rgba(255,180,100,0.7);font-size:11px;">⚠ タイムアウト。ボタンから試してください。</span>';
      }
    }, 12000);

    estimateAvgIncome(year, month).then(avgIncome => callAI('monthly', {
      year, month, income, expense,
      tagBreakdown: getTagBreakdown(transactions),
      budgets: [],
      prevYear: month === 1 ? year - 1 : year,
      prevMonth: month === 1 ? 12 : month - 1,
      prevIncome: 0, prevExpense: 0, prevTagBreakdown: [],
      avgIncome,
      todayDate: new Date().getDate(),
      daysInMonth: new Date(year, month, 0).getDate(),
    })).then(answer => {
      clearTimeout(tid);
      const el = document.getElementById('ai-auto-answer');
      if (el) el.innerHTML = answer.split('\n').join('<br>');
      // ここでキャッシュに保存しないと、ホーム画面に戻るたび（タブ切り替え含む）に
      // 自動でAPIが再実行されてしまう。月が変わるまでは再利用する。
      const payload = { answer, question: 'monthly', ts: new Date().toISOString(), year, month };
      _aiAdviceCache = payload;
      _saveAutoAdviceToStorage(payload);
    }).catch(e => {
      clearTimeout(tid);
      const el = document.getElementById('ai-auto-answer');
      if (!el) return;
      if (e.message === 'LIMIT_REACHED') {
        el.innerHTML = '<span style="font-size:12px;color:var(--mid-lt);">今月のAI回数上限に達しました</span>';
      } else {
        el.innerHTML = '<span style="color:rgba(255,180,100,0.7);font-size:11px;">⚠ ' + (e.message || 'エラー') + '</span>';
      }
    });
  }

  if (!btns.length || !answerEl) return;

  // ボタンクリック → 詳細回答
  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const q = btn.dataset.q;

      btns.forEach(b => {
        b.style.border = '1px solid var(--border)';
        b.style.color  = 'var(--mid)';
        b.style.background = 'none';
      });
      btn.style.border = '1px solid var(--sage)';
      btn.style.color  = 'var(--sage)';
      btn.style.background = 'var(--sage-bg)';

      answerEl.style.display = 'block';
      answerEl.innerHTML = '<div style="display:flex;align-items:center;gap:6px;color:var(--mid-lt);font-size:12px;padding:4px 0 8px;">'
        + '<div style="width:11px;height:11px;border:1.5px solid var(--sage-lt);border-top-color:var(--sage);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;"></div>'
        + '考え中…</div>';

      try {
        const prevM = month === 1 ? 12 : month - 1;
        const prevY = month === 1 ? year - 1 : year;
        const prevData    = await DB.getTransactions({ year: prevY, month: prevM, pageSize: 1000 });
        const prevTxs     = prevData.data || [];
        const prevIncome  = prevTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const prevExpense = prevTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        const monthKey  = year + '-' + String(month).padStart(2, '0');
        const budgetMap = await DB.getBudgets(monthKey);
        const spendByTag = {};
        transactions.filter(t => t.type === 'expense' && !t.is_excluded).forEach(tx => {
          (tx.tags || []).filter(t => t).forEach(tag => {
            spendByTag[tag.id] = (spendByTag[tag.id] || 0) + tx.amount;
          });
        });

        const income  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        // 固定費推定（過去3ヶ月から）
        const fixedTags = await estimateFixedCostTags(year, month);

        const answer = await callAI(q, {
          year, month, income, expense,
          tagBreakdown: getTagBreakdown(transactions),
          budgets: Object.entries(budgetMap).map(([tid2, b]) => ({
            name: b.tag_name || tid2, amount: b.amount, spent: spendByTag[tid2] || 0,
          })),
          prevYear: prevY, prevMonth: prevM, prevIncome, prevExpense,
          prevTagBreakdown: getTagBreakdown(prevTxs),
          todayDate: new Date().getDate(),
          daysInMonth: new Date(year, month, 0).getDate(),
          fixedCostTags: Array.from(fixedTags),
        });

        // 回答をai-auto-answerに表示（answerElは非表示に）
        answerEl.style.display = 'none';
        const autoElUpdate = document.getElementById('ai-auto-answer');
        const tsElUpdate   = document.getElementById('ai-timestamp');
        if (autoElUpdate) {
          autoElUpdate.style.display = 'block';
          autoElUpdate.innerHTML = answer.split('\n').join('<br>');
        }
        const now = new Date();
        const label = now.getMonth()+1 + '/' + now.getDate() + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0');
        if (tsElUpdate) {
          tsElUpdate.style.display = 'block';
          tsElUpdate.textContent = label + ' のアドバイス';
        }
        // モジュール変数にキャッシュ
        _aiAdviceCache = { answer, question: q, ts: now.toISOString(), year, month };
        _saveAutoAdviceToStorage(_aiAdviceCache);
        // 残り回数バッジを更新
        DB.getUserPlan().catch(() => 'free').then(async plan => {
          if (plan === 'premium' || plan === 'admin') return;
          const usage = await DB.getAiUsageThisMonth().catch(() => 0);
          const remaining = Math.max(0, DB.FREE_AI_LIMIT - usage);
          const badge = document.getElementById('ai-usage-badge');
          if (!badge) return;
          if (remaining === 0) {
            badge.innerHTML = '<span style="color:var(--red);">今月の上限に達しました</span>';
          } else if (remaining <= 2) {
            badge.innerHTML = '<span style="color:var(--gold);">残り' + remaining + '回</span>';
          } else {
            badge.textContent = '残り' + remaining + '回';
            badge.style.color = 'var(--mid-lt)';
          }
        });
      } catch (e) {
        if (e.message === 'LIMIT_REACHED') {
          answerEl.style.display = 'block';
          answerEl.innerHTML = '<div style="font-size:12px;color:var(--mid-lt);padding:4px 0;">今月のAI回数上限に達しました。<br><span style="color:var(--sage);cursor:pointer;text-decoration:underline;" onclick="document.querySelector(\'[data-upgrade]\')?.click()">Premiumにアップグレードする →</span></div>';
          if (!_limitShownThisSession) {
            _limitShownThisSession = true;
            showUpgradeSheet(false);
          }
        } else {
          answerEl.innerHTML = '<div style="font-size:12px;color:rgba(255,100,100,0.8);padding:4px 0;">エラー: ' + e.message + '</div>';
        }
      }
    });
  });

  // フリー入力
  const freeInput = document.getElementById('ai-free-input');
  const freeBtn   = document.getElementById('ai-free-btn');

  // 会話履歴はモジュール変数 _freeHistoryCache を使用（画面切り替えで消えない）

  async function submitFreeQuery() {
    const q = freeInput?.value?.trim();
    if (!q) return;

    answerEl.style.display = 'block';
    answerEl.innerHTML = '<div style="font-size:12px;color:var(--mid);">考え中…</div>';

    const tsEl = document.getElementById('ai-timestamp');

    try {
      const income  = transactions.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0);
      const expense = transactions.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0);
      const fixedTags = await estimateFixedCostTags(year, month);

      // 直近3ヶ月分の全取引を取得
      const months3 = [];
      for (let i = 0; i <= 2; i++) {
        let m = month - i; let y = year;
        if (m <= 0) { m += 12; y -= 1; }
        months3.push({ year: y, month: m });
      }
      const results3 = await Promise.all(
        months3.map(({ year: y, month: m }) =>
          DB.getTransactions({ year: y, month: m, pageSize: 500 }).then(r => r.data || [])
        )
      );
      const allTxs3 = results3.flat().map(t => ({
        date: t.date,
        type: t.type,
        amount: t.amount,
        memo: t.memo || '',
        tags: (t.tags || []).map(tg => tg.name || tg).filter(Boolean),
      }));

      const prevM = month === 1 ? 12 : month - 1;
      const prevY = month === 1 ? year - 1 : year;
      const prevTxs = results3[1] || [];

      const answer = await callAI('free', {
        year, month, income, expense,
        tagBreakdown: getTagBreakdown(transactions),
        prevIncome:  prevTxs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0),
        prevExpense: prevTxs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0),
        prevTagBreakdown: getTagBreakdown(prevTxs),
        todayDate: new Date().getDate(),
        daysInMonth: new Date(year, month, 0).getDate(),
        fixedCostTags: Array.from(fixedTags),
        freeQuestion: q,
        conversationHistory: _freeHistoryCache.slice(-10),
        allTransactions: allTxs3,
      });

      // 会話履歴に追加（モジュール変数）
      _freeHistoryCache.push({ q, a: answer });

      answerEl.innerHTML = answer.split('\n').join('<br>');
      if (freeInput) freeInput.value = '';

      // フリー回答をキャッシュ（画面切り替えで消えない）
      const now = new Date();
      _freeAnswerCache = { answer, ts: now.toISOString(), year, month };

      // タイムスタンプ更新
      if (tsEl) {
        const label = (now.getMonth()+1) + '/' + now.getDate() + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0');
        tsEl.style.display = 'block';
        tsEl.textContent = label + ' の回答';
      }

    } catch(e) {
      answerEl.innerHTML = '<div style="font-size:12px;color:rgba(255,100,100,0.8);">エラー: ' + e.message + '</div>';
    }
  }

  freeBtn?.addEventListener('click', submitFreeQuery);
  freeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFreeQuery();
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

function setupAccordions() {
  ['budget'].forEach(function(key) {
    var body = document.getElementById(key + '-body');
    var chevron = document.getElementById('ac-chevron-' + key);
    var head = document.querySelector('[data-ac="' + key + '-body"]');
    var summaryBar = document.getElementById('budget-summary-bar');
    if (!body || !head) return;

    var stored = localStorage.getItem('ac-' + key);
    var isOpen = key === "budget" ? true : stored !== "closed";

    // 初期状態設定
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      if (summaryBar) summaryBar.style.display = 'none';
    } else {
      body.style.maxHeight = '0px';
      if (chevron) chevron.style.transform = 'rotate(-90deg)';
      if (summaryBar) summaryBar.style.display = '';
    }

    head.addEventListener('click', function(e) {
      if (e.target.closest('.panel-link')) return;
      var open = body.style.maxHeight !== '0px';
      if (open) {
        body.style.maxHeight = '0px';
        if (chevron) chevron.style.transform = 'rotate(-90deg)';
        if (summaryBar) summaryBar.style.display = '';
        localStorage.setItem('ac-' + key, 'closed');
      } else {
        body.style.maxHeight = body.scrollHeight + 'px';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
        if (summaryBar) summaryBar.style.display = 'none';
        localStorage.setItem('ac-' + key, 'open');
      }
    });
  });
}


