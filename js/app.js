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

  // onAuthStateChange を主軸にする（OAuthコールバックのハッシュ処理後に確実に発火）
  Auth.onAuthStateChange((event, session) => {
    if (session) {
      // ログイン済み or OAuth コールバック後
      document.getElementById('screen-login').hidden = true;
      showApp(session.user);
      hideLoading();
    } else {
      // 未ログイン or ログアウト後
      hideLoading();
      document.getElementById('screen-login').hidden = false;
    }
  });

  // 初回: すでにセッションがあれば即反映（onAuthStateChangeが発火しない場合のフォールバック）
  try {
    const session = await Auth.getSession();
    if (session) {
      document.getElementById('screen-login').hidden = true;
      showApp(session.user);
      hideLoading();
    } else if (!window.location.hash.includes('access_token')) {
      // OAuthコールバックでない場合のみログイン画面を表示
      // （access_tokenがある場合はonAuthStateChangeの発火を待つ）
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
