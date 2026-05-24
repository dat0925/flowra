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
  try {
    const session = await Auth.getSession();

    if (!session) {
      hideLoading();
      document.getElementById('screen-login').hidden = false;
      document.getElementById('btn-google-login')?.addEventListener('click', () => {
        Auth.signInWithGoogle();
      });
      return;
    }

    showApp(session.user);
    hideLoading();

  } catch (e) {
    console.error('init error:', e);
    hideLoading();
    document.getElementById('screen-login').hidden = false;
    document.getElementById('btn-google-login')?.addEventListener('click', () => {
      Auth.signInWithGoogle();
    });
  }
}

function showApp(user) {
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

// 認証状態変化を監視
Auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    window.location.reload();
  }
});

init();
