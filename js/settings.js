// ─────────────────────────────────────
//  settings.js  設定画面
// ─────────────────────────────────────
import { Auth } from './auth.js';
import { DB }   from './db.js';
import { showToast } from './utils.js';

export async function renderSettings() {
  const content = document.getElementById('page-content');
  try {
    const [user, team, tags] = await Promise.all([
      Auth.getUser(),
      DB.getTeam(),
      DB.getTags(),
    ]);

    const tagsHTML = tags.map((t, i) => `
      <div class="form-row no-tap" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${t.color || 'var(--sage)'};"></div>
          <span>${t.name}</span>
        </div>
        <span style="font-size:11px;color:var(--mid-lt);">sort: ${t.sort_order}</span>
      </div>`).join('');

    content.innerHTML = `
      <!-- プロフィール -->
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head"><div class="panel-title">アカウント</div></div>
        <div class="form-row no-tap">
          <div class="avatar" style="width:40px;height:40px;font-size:16px;">${Auth.getInitial(user)}</div>
          <div class="row-body">
            <div class="row-value">${Auth.getDisplayName(user)}</div>
            <div class="row-label">${user?.email || ''}</div>
          </div>
        </div>
        <div class="form-row no-tap" style="justify-content:space-between;">
          <span style="font-size:14px;font-weight:500;">チーム名</span>
          <span style="color:var(--mid);">${team?.name || '—'}</span>
        </div>
        <div class="form-row" id="btn-logout" style="color:var(--red);">
          <svg viewBox="0 0 24 24" width="16" height="16" style="color:var(--red)"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          ログアウト
        </div>
      </div>

      <!-- チーム共有 -->
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head"><div class="panel-title">チーム共有</div></div>
        <div style="padding:16px 18px;">
          <p style="font-size:13px;color:var(--mid);margin-bottom:12px;">招待リンクを共有してメンバーを追加できます。</p>
          <button class="btn-primary" id="btn-copy-invite">
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            招待リンクをコピー
          </button>
        </div>
      </div>

      <!-- タグ管理 -->
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head">
          <div class="panel-title">タグ管理</div>
        </div>
        ${tags.length > 0 ? tagsHTML : '<div class="empty-state" style="padding:24px;"><div class="empty-state-sub">タグがありません</div></div>'}
        <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:10px;">
          <input class="text-input" id="new-tag-name" placeholder="タグ名を入力"
            style="flex:1;background:var(--warm);border:1px solid var(--border);border-radius:8px;padding:8px 12px;">
          <button class="btn-primary" id="btn-add-tag" style="width:auto;padding:8px 16px;flex-shrink:0;">追加</button>
        </div>
      </div>

      <!-- バージョン情報 -->
      <div style="text-align:center;font-size:11px;color:var(--mid-lt);margin-top:24px;">
        Flowra v0.1.0 — Supabase + PWA
      </div>`;

    // ログアウト
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      if (confirm('ログアウトしますか？')) Auth.signOut();
    });

    // 招待リンク（仮実装）
    document.getElementById('btn-copy-invite')?.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.origin + '?invite=' + (team?.id || ''))
        .then(() => showToast('招待リンクをコピーしました'));
    });

    // タグ追加
    document.getElementById('btn-add-tag')?.addEventListener('click', async () => {
      const name = document.getElementById('new-tag-name').value.trim();
      if (!name) return;
      try {
        await DB.createTag(name);
        showToast('タグを追加しました');
        renderSettings();
      } catch (e) { showToast('エラー: ' + e.message); }
    });

  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-title">エラー: ${err.message}</div></div>`;
  }
}
