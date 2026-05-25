// ローディングを即座に非表示（モジュール読み込み完了時）
window.addEventListener('DOMContentLoaded', () => {}, false);
document.addEventListener('DOMContentLoaded', () => {
  // フォールバック：3秒後に強制的にローディングを消す
  setTimeout(() => {
    const l = document.getElementById('loading');
    if (l) { l.style.display = 'none'; }
  }, 3000);
});

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

// ── 初期化 ──────────────────────────
async function init() {
  // ログインボタンは最初にバインドしておく
  document.getElementById('btn-google-login')?.addEventListener('click', () => {
    Auth.signInWithGoogle();
  });

  // OAuthコールバック（URLにcode or access_tokenが含まれる場合）は
  // onAuthStateChange の SIGNED_IN イベントを待つ
  const isOAuthCallback =
    window.location.hash.includes('access_token') ||
    window.location.search.includes('code=');

  // onAuthStateChange を主軸にする
  Auth.onAuthStateChange((event, session) => {
    if (session) {
      // URLからOAuthパラメータを消す（ブラウザ履歴を汚さない）
      if (isOAuthCallback) {
        history.replaceState(null, '', window.location.pathname);
      }
      document.getElementById('screen-login').hidden = true;
      showApp(session.user);
      hideLoading();
    } else {
      // 未ログイン or ログアウト後
      hideLoading();
      document.getElementById('screen-login').hidden = false;
    }
  });

  // OAuthコールバック中は onAuthStateChange の発火を待つ（ここでは何もしない）
  if (isOAuthCallback) return;

  // 通常ページロード: すでにセッションがあれば即反映
  try {
    const session = await Auth.getSession();
    if (session) {
      document.getElementById('screen-login').hidden = true;
      showApp(session.user);
      hideLoading();
    } else {
      hideLoading();
      document.getElementById('screen-login').hidden = false;
    }
  } catch (e) {
    console.error('init error:', e);
    hideLoading();
    document.getElementById('screen-login').hidden = false;
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
