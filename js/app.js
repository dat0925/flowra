// ─────────────────────────────────────
//  app.js  エントリーポイント
// ─────────────────────────────────────
import { Auth }       from './auth.js';
import { Router, MonthState } from './router.js';
import { renderDashboard }    from './dashboard.js';
import { renderAddRecord, warmupAddRecord } from './add-record.js';
import { checkAndShowOnboarding } from './onboarding.js';
import { renderAccounts }     from './accounts.js';
import { renderSettings }     from './settings.js';
import { fmt, showToast, openModal, closeModal } from './utils.js';
import { renderRecords }     from './records.js';
import { clearAll }          from './cache.js';
import { DB }                from './db.js';

export { fmt, showToast, openModal, closeModal };

// ── スプラッシュ非表示 ──────────────
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('fade-out');
  setTimeout(() => splash.classList.add('hidden'), 400);
}

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
  hideSplash();
  document.getElementById('screen-login').hidden = false;
}

// ── 初期化 ──────────────────────────
async function init() {
  // 招待トークンをURLから取得して保存
  const urlParams = new URLSearchParams(window.location.search);
  const inviteToken = urlParams.get('invite');
  if (inviteToken) {
    sessionStorage.setItem('pendingInviteToken', inviteToken);
    // URLをクリーンに
    window.history.replaceState({}, '', window.location.pathname);
  }

  document.getElementById('btn-google-login')?.addEventListener('click', () => {
    Auth.signInWithGoogle();
  });

  // セッション変化を監視（ログアウト検知用）
  Auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      DB.clearActiveTeamId();
      clearAll().finally(() => showLogin());
    }
  });

  // 既存セッションを確認してアプリ表示
  try {
    const session = await Auth.getSession();
    if (session) {
      showApp(session.user);
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

  hideSplash();
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

  // チーム切り替えUIを初期化
  initTeamSwitcher();

  // viewer制限を適用
  applyViewerMode();

  // ログイン後の招待処理 or 通常オンボーディング
  const pendingToken = sessionStorage.getItem('pendingInviteToken');
  if (pendingToken) {
    sessionStorage.removeItem('pendingInviteToken');
    showInviteAcceptDialog(pendingToken);
  } else {
    checkAndShowOnboarding(() => { warmupAddRecord(); });
  }

  // 新規ユーザー向けデフォルトカテゴリタグを自動シード
  _seedDefaultTags();

  // ボタンのクリックハンドラ
  const openAdd = () => {
    renderAddRecord(
      (savedTx) => {
        showToast('✓ 記録を保存しました');
        warmupAddRecord();
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
        // add-record.js内でfocus済み
      }
    );
  };
  document.getElementById('btn-add-desktop')?.addEventListener('click', openAdd);
  document.getElementById('btn-add-mobile')?.addEventListener('click', openAdd);

  Router.navigate('dashboard');
}

async function _seedDefaultTags() {
  try {
    const existing = await DB.getTags();
    if (existing.length > 0) return; // すでにタグがあればスキップ
    const defaults = [
      { name: '食費',       color: '#7A9485', sort_order: 1 },
      { name: '日用品',     color: '#7A8BA0', sort_order: 2 },
      { name: '住居',       color: '#8A8070', sort_order: 3 },
      { name: '光熱・水道', color: '#A09070', sort_order: 4 },
      { name: '通信費',     color: '#7A7A9A', sort_order: 5 },
      { name: 'サブスク',   color: '#8A7A9A', sort_order: 6 },
      { name: '交通費',     color: '#7A9A8A', sort_order: 7 },
      { name: '車',         color: '#8A9070', sort_order: 8 },
      { name: '医療・健康', color: '#9A7A7A', sort_order: 9 },
      { name: '保険料',     color: '#9A8A70', sort_order: 10 },
      { name: '教育',       color: '#7A8A9A', sort_order: 11 },
      { name: '娯楽・趣味', color: '#8A7A8A', sort_order: 12 },
      { name: '服・美容',   color: '#9A7A8A', sort_order: 13 },
    ];
    for (const tag of defaults) {
      await DB.createTag(tag.name, tag.color);
    }
  } catch (e) { /* silent */ }
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

// ── 招待受け入れダイアログ ──────────────
async function showInviteAcceptDialog(token) {
  let invite;
  try {
    invite = await DB.getInviteByToken(token);
  } catch (e) {
    showToast('エラー詳細: ' + e.message);
    checkAndShowOnboarding(() => { warmupAddRecord(); });
    return;
  }

  if (invite.used_at) {
    showToast('この招待リンクは既に使用済みです');
    checkAndShowOnboarding(() => { warmupAddRecord(); });
    return;
  }
  if (new Date(invite.expires_at) < new Date()) {
    showToast('招待リンクの有効期限が切れています');
    checkAndShowOnboarding(() => { warmupAddRecord(); });
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(28,43,34,0.6);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 0.3s;';
  overlay.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:28px 28px 0 0;padding:32px 24px 48px;text-align:center;">
      <div style="font-size:40px;margin-bottom:16px;">🤝</div>
      <h2 style="font-family:'Noto Serif JP',serif;font-size:20px;font-weight:600;color:var(--ink);margin-bottom:12px;">共有への招待</h2>
      <p style="font-size:14px;color:var(--mid);line-height:1.7;margin-bottom:32px;">家計データの共有に招待されています。<br>参加すると、同じデータを閲覧・編集できます。</p>
      <button id="btn-accept-invite" style="width:100%;padding:16px;border-radius:14px;border:none;background:var(--sage);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:12px;">参加する</button>
      <button id="btn-decline-invite" style="background:none;border:none;color:var(--mid);font-size:13px;cursor:pointer;padding:8px;">断る</button>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.style.opacity = '1');

  document.getElementById('btn-accept-invite')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-accept-invite');
    btn.disabled = true;
    btn.textContent = '参加中…';
    try {
      await DB.acceptInvite(token);
      overlay.remove();
      showToast('✓ 共有に参加しました');
      window.location.reload();
    } catch (e) {
      showToast('エラー: ' + e.message);
      btn.disabled = false;
      btn.textContent = '参加する';
    }
  });

  document.getElementById('btn-decline-invite')?.addEventListener('click', () => {
    overlay.remove();
    checkAndShowOnboarding(() => { warmupAddRecord(); });
  });
}

// ── チーム切り替えUI ──────────────────
// ── viewer制限：+ボタンの表示制御 ────────────
async function applyViewerMode() {
  try {
    const role = await DB.getMyRole();
    const isViewer = role === 'viewer';
    const addMobile  = document.getElementById('btn-add-mobile');
    const addDesktop = document.getElementById('btn-add-desktop');
    if (addMobile)  addMobile.style.display  = isViewer ? 'none' : '';
    if (addDesktop) addDesktop.style.display = isViewer ? 'none' : '';
  } catch (e) {
    // エラー時は何もしない（デフォルト表示を維持）
  }
}

async function initTeamSwitcher() {
  try {
    const teams = await DB.getAllTeams();
    const switcher = document.getElementById('team-switcher');
    if (!switcher) return;

    // 1チームのみなら非表示
    if (teams.length <= 1) {
      switcher.hidden = true;
      return;
    }

    switcher.hidden = false;
    const activeId = await DB.getTeamId();

    // オーナーのチームのprofileを取得して表示名を決める
    const profiles = await DB.getTeamMemberProfiles(teams.map(t => t.team_id));

    switcher.innerHTML = teams.map(t => {
      const teamId = t.team_id;
      const isActive = teamId === activeId;
      let name;
      if (t.role === 'owner') {
        name = '個人';
      } else {
        // オーナーの名前を表示
        const ownerProfile = profiles.find(p => p.team_id === teamId && p.role === 'owner');
        name = ownerProfile?.full_name || ownerProfile?.email?.split('@')[0] || '共有';
      }
      return `
        <button class="team-switch-btn ${isActive ? 'active' : ''}" data-team-id="${teamId}"
          style="font-size:11px;padding:4px 10px;border-radius:20px;border:1px solid ${isActive ? 'var(--sage)' : 'rgba(255,255,255,0.25)'};background:${isActive ? 'var(--sage)' : 'transparent'};color:${isActive ? '#fff' : 'rgba(255,255,255,0.6)'};cursor:pointer;white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;">
          ${t.role === 'owner' ? '🏠' : '👥'} ${name}
        </button>
      `;
    }).join('');

    switcher.querySelectorAll('.team-switch-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const teamId = btn.dataset.teamId;
        if (teamId === DB.getActiveTeamId()) return;
        DB.setActiveTeamId(teamId);
        const { clearAll: clearCache } = await import('./cache.js');
        await clearCache();
        await initTeamSwitcher();
        applyViewerMode();
        Router.navigate(Router.currentPage);
        showToast('チームを切り替えました');
      });
    });
  } catch (e) {
    console.error('team switcher error:', e);
  }
}
