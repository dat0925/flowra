// ─────────────────────────────────────
//  app.js  エントリーポイント
// ─────────────────────────────────────
import { Auth }       from './auth.js';
import { Router, MonthState } from './router.js';
import { renderDashboard }    from './dashboard.js';
import { renderAddRecord }    from './add-record.js';
import { renderAccounts }     from './accounts.js';
import { renderSettings }     from './settings.js';

// ── ユーティリティ ──────────────────
export function fmt(amount) {
  return Number(amount).toLocaleString('ja-JP');
}

export function showToast(msg, duration = 2500) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── モーダル ────────────────────────
export function openModal(contentHTML) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = contentHTML;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.hidden = true;
  document.body.style.overflow = '';
}

// モーダル外クリックで閉じる
document.getElementById('modal-overlay')?.addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') closeModal();
});

// ── ローディング非表示ユーティリティ ──
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

    // ログイン済み → アプリ表示
    showApp(session.user);
    hideLoading();

  } catch (e) {
    console.error('init error:', e);
    // エラーが起きてもローディングは必ず消す
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
  document.getElementById('user-avatar').textContent    = initial;
  document.getElementById('mobile-avatar').textContent  = initial;
  document.getElementById('user-name').textContent      = name;

  MonthState.onChange(() => {
    if (Router.currentPage === 'dashboard') renderDashboard();
    if (Router.currentPage === 'records')   Router.navigate('records');
  });

  Router.register('dashboard', renderDashboard);
  Router.register('accounts',  renderAccounts);
  Router.register('settings',  renderSettings);
  Router.register('records', async () => {
    renderDashboard();
  });

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

// 認証状態変化を監視
Auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    window.location.reload();
  }
});

init();
