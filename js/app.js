// ─────────────────────────────────────
//  app.js  エントリーポイント
// ─────────────────────────────────────
import { Auth }       from './auth.js';
import { Router, MonthState } from './router.js';
import { renderDashboard }    from './dashboard.js';
import { renderAddRecord, warmupAddRecord } from './add-record.js';
import { renderAccounts }     from './accounts.js';
import { renderSettings }     from './settings.js';
import { fmt, showToast, openModal, closeModal } from './utils.js';
import { renderRecords }     from './records.js';

export { fmt, showToast, openModal, closeModal };

// ── ローディング非表示 ──────────────
function hideLoading() {
  const loading = document.getElementById('loading');
  if (!loading) return;
  loading.classList.add('hide');
  setTimeout(() => loading.remove(), 400);
}

// ── ログイン画面表示 ──────────────
function showLogin() {
  hideLoading();
  document.getElementById('screen-login').hidden = false;
}

// ── 初期化 ──────────────────────────
async function init() {
  document.getElementById('btn-google-login')?.addEventListener('click', () => {
    Auth.signInWithGoogle();
  });

  // セッション変化を監視（ログアウト検知用）
  Auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });

  // 既存セッションを確認してアプリ表示
  try {
    const session = await Auth.getSession();
    if (session) {
      showApp(session.user);
      hideLoading();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('init error:', e);
    showLogin();
  }
}

let _appInitialized = false;
function showApp(user) {
  if (_appInitialized) return;
  _appInitialized = true;

  document.getElementById('screen-login').hidden = true;
  document.getElementById('app').hidden = false;

  const initial = Auth.getInitial(user);
  const name    = Auth.getDisplayName(user);
  document.getElementById('user-avatar').textContent   = initial;
  document.getElementById('mobile-avatar').textContent = initial;
  document.getElementById('user-name').textContent     = name;

  MonthState.onChange(() => {
    if (Router.currentPage === 'dashboard') renderDashboard();
    if (Router.currentPage === 'records')   Router.navigate('records');
  });

  Router.register('dashboard', renderDashboard);
  Router.register('accounts',  renderAccounts);
  Router.register('settings',  renderSettings);
  Router.register('records', renderRecords);

  Router.init();

  // データを事前ウォームアップ（次回のaddが同期的に開けるようにする）
  warmupAddRecord();

  // ボタンのクリックハンドラ
  const openAdd = () => {
    // iOSのキーボード表示トリック：awaitの前に同期的にfocusしておく
    const dummy = document.getElementById('ios-focus-trick');
    dummy?.focus();

    renderAddRecord(
      (savedTx) => {
        closeModal();
        showToast('✓ 記録を保存しました');
        warmupAddRecord(); // 保存後にキャッシュ更新
        if (savedTx) {
          patchAfterSave(savedTx);
        } else {
          const page = Router.currentPage;
          if (page === 'records')       renderRecords();
          else if (page === 'accounts') renderAccounts();
          else                          renderDashboard();
        }
      },
      () => {
        // モーダルのスライドアニメーション(280ms)の後にキーボードを表示
        setTimeout(() => {
          document.getElementById('amount-input')?.focus();
        }, 500);
      }
    );
  };
  document.getElementById('btn-add-desktop')?.addEventListener('click', openAdd);
  document.getElementById('btn-add-mobile')?.addEventListener('click', openAdd);

  Router.navigate('dashboard');
}

// ── 保存後の軽量DOM更新 ──────────────────
function patchAfterSave(tx) {
  const page = Router.currentPage;

  // 記録画面・口座画面は構造が異なるので再描画が確実
  if (page === 'records') {
    // records.js の _allTx に追加してrenderListを呼ぶ
    import('./records.js').then(({ patchAddRecord }) => {
      if (patchAddRecord) patchAddRecord(tx);
      else renderRecords();
    }).catch(() => renderRecords());
    return;
  }
  if (page === 'accounts') {
    renderAccounts();
    return;
  }

  // ── ホーム画面のDOMパッチ ──
  const txList = document.getElementById('tx-list');
  if (txList) {
    const today = new Date(tx.date + 'T00:00:00');
    const w = ['日','月','火','水','木','金','土'];
    const dateLabel = `${today.getMonth()+1}月${today.getDate()}日（${w[today.getDay()]}）`;
    const sign = tx.type==='income' ? '+¥' : tx.type==='expense' ? '−¥' : '¥';
    const TX_ICON = {
      income:   { bg:'#EEF5F1', stroke:'#4A7C59', path:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
      expense:  { bg:'#F0EDE8', stroke:'#7A9485', path:'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
      transfer: { bg:'#FBF5E6', stroke:'#B8973E', path:'<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
    };
    const ic = TX_ICON[tx.type] || TX_ICON.expense;

    const newRow = document.createElement('div');
    newRow.innerHTML = `
      <div class="tx-date-label">${dateLabel}</div>
      <div class="tx-item" data-tx-id="${tx.id}" style="cursor:pointer;">
        <div class="tx-icon" style="background:${ic.bg};">
          <svg viewBox="0 0 24 24" style="stroke:${ic.stroke}">${ic.path}</svg>
        </div>
        <div class="tx-body">
          <div class="tx-name">${tx.memo || '（メモなし）'}</div>
          <div class="tx-meta">
            <span class="tx-acct">${tx._acctName || ''}</span>
          </div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${tx.type}">
            <span class="tx-currency">${sign}</span>${Number(tx.amount).toLocaleString('ja-JP')}
          </div>
        </div>
      </div>`;
    txList.prepend(newRow);
  }

  // サマリー数字を差分更新
  if (tx.type === 'income') {
    const el = document.querySelector('.income-card .s-number');
    if (el) el.textContent = (parseInt(el.textContent.replace(/,/g,''),10)||0 + tx.amount).toLocaleString('ja-JP');
  }
  if (tx.type === 'expense') {
    const el = document.querySelector('.expense-card .s-number');
    if (el) el.textContent = (parseInt(el.textContent.replace(/,/g,''),10)||0 + tx.amount).toLocaleString('ja-JP');
  }
  const totalEl = document.querySelector('.s-card.total .s-number');
  if (totalEl) {
    const delta = tx.type==='income' ? tx.amount : tx.type==='expense' ? -tx.amount : 0;
    if (delta !== 0) totalEl.textContent = (parseInt(totalEl.textContent.replace(/,/g,''),10)||0 + delta).toLocaleString('ja-JP');
  }
}

// モーダル外クリックで閉じる
document.getElementById('modal-overlay')?.addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') closeModal();
});

init();
