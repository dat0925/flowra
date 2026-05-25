// ─────────────────────────────────────
//  app.js  エントリーポイント
// ─────────────────────────────────────
import { Auth }       from './auth.js';
import { Router, MonthState } from './router.js';
import { renderDashboard }    from './dashboard.js';
import { renderAddRecord }    from './add-record.js';
import { renderAccounts }     from './accounts.js';
import { renderSettings }     from './settings.js';
import { fmt, showToast, openModal, closeModal } from './utils.js';

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

  const openAdd = () => {
    renderAddRecord(() => {
      closeModal();
      showToast('✓ 記録を保存しました');
      renderDashboard();
    });
  };
  document.getElementById('btn-add-desktop')?.addEventListener('click', openAdd);
  document.getElementById('btn-add-mobile')?.addEventListener('click', openAdd);

  Router.navigate('dashboard');
}

// モーダル外クリックで閉じる
document.getElementById('modal-overlay')?.addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') closeModal();
});

init();
