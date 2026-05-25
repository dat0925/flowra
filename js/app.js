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

// ── ログイン画面を表示 ──────────────
function showLogin() {
  hideLoading();
  document.getElementById('screen-login').hidden = false;
}

// ── 初期化 ──────────────────────────
async function init() {
  // ログインボタンのバインド
  document.getElementById('btn-google-login')?.addEventListener('click', () => {
    Auth.signInWithGoogle();
  });

  // PKCEコールバック判定（?code= がURLにある場合）
  const isOAuthCallback =
    window.location.hash.includes('access_token') ||
    window.location.search.includes('code=');

  // onAuthStateChange を主軸にする
  // SIGNED_IN はOAuthコールバック後・セッション復元時どちらでも発火する
  Auth.onAuthStateChange((event, session) => {
    console.log('[Auth] event:', event, 'session:', !!session);

    if (event === 'SIGNED_IN' && session) {
      // OAuthパラメータをURLから除去
      if (window.location.search.includes('code=') || window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname);
      }
      showApp(session.user);
      hideLoading();
    } else if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });

  // OAuthコールバック中はSupabaseがURLのcodeを処理するのを待つ
  // → onAuthStateChange の SIGNED_IN が発火するので何もしない
  if (isOAuthCallback) {
    console.log('[Auth] OAuth callback detected, waiting for SIGNED_IN...');
    // タイムアウト保険: 10秒以内にSIGNED_INが来なければログイン画面へ
    setTimeout(() => {
      if (!_appInitialized) showLogin();
    }, 10000);
    return;
  }

  // 通常ページロード: 既存セッションを確認
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
  Router.register('records', () => { renderDashboard(); });

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
