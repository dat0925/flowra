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

// ── 初期化 ──────────────────────────
async function init() {
  const loading = document.getElementById('loading');

  // 認証状態を確認
  const session = await Auth.getSession();

  if (!session) {
    // 未ログイン → ログイン画面
    loading.classList.add('hide');
    setTimeout(() => loading.remove(), 400);
    document.getElementById('screen-login').hidden = false;

    document.getElementById('btn-google-login')?.addEventListener('click', () => {
      Auth.signInWithGoogle();
    });
    return;
  }

  // ログイン済み → アプリ表示
  const user = session.user;
  showApp(user);

  loading.classList.add('hide');
  setTimeout(() => loading.remove(), 400);
}

function showApp(user) {
  document.getElementById('screen-login').hidden = true;
  document.getElementById('app').hidden = false;

  // ユーザー情報をUIに反映
  const initial = Auth.getInitial(user);
  const name    = Auth.getDisplayName(user);
  document.getElementById('user-avatar').textContent    = initial;
  document.getElementById('mobile-avatar').textContent  = initial;
  document.getElementById('user-name').textContent      = name;

  // 月変更時にダッシュボードを再描画
  MonthState.onChange(() => {
    if (Router.currentPage === 'dashboard') renderDashboard();
    if (Router.currentPage === 'records')   {
      // records も再描画
      Router.navigate('records');
    }
  });

  // 画面ハンドラ登録
  Router.register('dashboard', renderDashboard);
  Router.register('accounts',  renderAccounts);
  Router.register('settings',  renderSettings);
  Router.register('records', async () => {
    // 記録一覧は dashboard に統合（後で分離可）
    renderDashboard();
  });

  // ナビ初期化
  Router.init();

  // 追加ボタン
  const openAdd = () => {
    renderAddRecord(() => {
      closeModal();
      showToast('✓ 記録を保存しました');
      renderDashboard(); // 保存後にダッシュボード更新
    });
  };
  document.getElementById('btn-add-desktop')?.addEventListener('click', openAdd);
  document.getElementById('btn-add-mobile')?.addEventListener('click', openAdd);

  // 初期画面
  Router.navigate('dashboard');
}

// 認証状態変化を監視
Auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    // OAuthリダイレクト後のリロード
    window.location.reload();
  }
});

init();
