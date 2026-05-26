// ─────────────────────────────────────
//  settings.js  設定画面
// ─────────────────────────────────────
import { Auth }  from './auth.js';
import { Sound } from './sound.js';
import { DB }    from './db.js';
import { showToast, openModal, closeModal } from './utils.js';
import { getCachedTags, putTags } from './cache.js';

export async function renderSettings() {
  const content = document.getElementById('page-content');

  // キャッシュから即表示
  const [cachedTags, user] = await Promise.all([
    getCachedTags(),
    Auth.getUser(),
  ]);
  if (cachedTags.length > 0) {
    renderSettingsContent(content, user, null, cachedTags);
  } else {
    content.innerHTML = '<div class="spinner"></div>';
  }

  // バックグラウンドで最新取得
  try {
    const [team, tags] = await Promise.all([DB.getTeam(), DB.getTags()]);
    await putTags(tags);
    renderSettingsContent(content, user, team, tags);
  } catch (e) {
    if (cachedTags.length === 0) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-title">エラー: ${e.message}</div></div>`;
    }
  }
}

// ── タグリスト再描画（モーダル内・設定画面共用）──
function renderTagList(tags) {
  const wrap = document.getElementById('tag-list-wrap');
  if (!wrap) return;

  if (tags.length === 0) {
    wrap.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-state-sub">タグがありません</div></div>';
    return;
  }

  wrap.innerHTML = tags.map(t => `
    <div class="form-row" data-tag-id="${t.id}" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${t.color || 'var(--sage)'};flex-shrink:0;"></div>
        <span style="font-size:14px;font-weight:500;">${t.name}</span>
      </div>
      <svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--mid-lt);flex-shrink:0;">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>`).join('');

  // 各タグ行タップ → 編集シート
  wrap.querySelectorAll('.form-row[data-tag-id]').forEach(row => {
    row.addEventListener('click', () => {
      const tag = tags.find(t => t.id === row.dataset.tagId);
      if (tag) openTagEditSheet(tag, tags);
    });
  });
}

// ── タグ編集ボトムシート ──
function openTagEditSheet(tag, allTags) {
  Sound.playOpen();

  const sheet = document.createElement('div');
  sheet.id = 'tag-edit-sheet';
  sheet.style.cssText = `
    position:fixed;inset:0;z-index:700;
    background:rgba(28,43,34,0.45);
    display:flex;align-items:flex-end;justify-content:center;
  `;

  sheet.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;
      border-radius:20px 20px 0 0;padding:0 16px 36px;">
      <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 16px;"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
        <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">タグを編集</div>
        <button id="btn-close-tag-sheet"
          style="width:28px;height:28px;border-radius:50%;background:var(--mist);border:none;
          display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
          <svg viewBox="0 0 24 24" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="form-section" style="margin-bottom:14px;">
        <div class="form-row no-tap">
          <div class="row-body">
            <div class="row-label">タグ名</div>
            <input class="text-input" id="edit-tag-name" value="${tag.name}"
              style="font-size:16px;">
          </div>
        </div>
      </div>
      <div id="edit-tag-error" style="display:none;font-size:11.5px;color:var(--red);margin:-8px 0 10px 2px;"></div>

      <button class="btn-primary" id="btn-save-tag" style="margin-bottom:10px;">
        <svg viewBox="0 0 24 24" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
        変更を保存
      </button>
      <button id="btn-delete-tag"
        style="width:100%;padding:13px;border-radius:14px;border:1px solid var(--red-bg);
        background:var(--red-bg);color:var(--red);font-family:'Noto Sans JP',sans-serif;
        font-size:14px;font-weight:500;cursor:pointer;">
        このタグを削除
      </button>
    </div>`;

  document.body.appendChild(sheet);

  const closeSheet = () => { Sound.playClose(); sheet.remove(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  document.getElementById('btn-close-tag-sheet')?.addEventListener('click', closeSheet);

  // 保存
  document.getElementById('btn-save-tag')?.addEventListener('click', async () => {
    const name     = document.getElementById('edit-tag-name').value.trim();
    const errorEl  = document.getElementById('edit-tag-error');

    if (!name) {
      errorEl.textContent = 'タグ名を入力してください';
      errorEl.style.display = 'block';
      return;
    }
    const dup = allTags.find(t => t.name === name && t.id !== tag.id);
    if (dup) {
      errorEl.textContent = `「${name}」は既に登録されています`;
      errorEl.style.display = 'block';
      return;
    }

    try {
      await DB.updateTag(tag.id, { name });
      Sound.playTap();
      closeSheet();
      showToast('✓ タグを更新しました');
      renderSettings();
    } catch (e) {
      errorEl.textContent = '更新に失敗しました。';
      errorEl.style.display = 'block';
    }
  });

  // 削除
  document.getElementById('btn-delete-tag')?.addEventListener('click', async () => {
    if (!confirm(`「${tag.name}」を削除しますか？\n※ このタグが付いた記録からも外れます`)) return;
    try {
      await DB.deleteTag(tag.id);
      Sound.playClose();
      closeSheet();
      showToast('タグを削除しました');
      renderSettings();
    } catch (e) {
      showToast('削除に失敗しました: ' + e.message);
    }
  });
}

async function renderSettingsContent(content, user, team, tags) {
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
        <svg viewBox="0 0 24 24" width="16" height="16" style="color:var(--red)">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        ログアウト
      </div>
    </div>

    <!-- チーム共有 -->
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-head"><div class="panel-title">チーム共有</div></div>
      <div style="padding:16px 18px;">
        <p style="font-size:13px;color:var(--mid);margin-bottom:12px;">招待リンクを共有してメンバーを追加できます。</p>
        <button class="btn-primary" id="btn-copy-invite">
          <svg viewBox="0 0 24 24">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          招待リンクをコピー
        </button>
      </div>
    </div>

    <!-- タグ管理 -->
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-head">
        <div class="panel-title">タグ管理</div>
        <div class="panel-link" id="btn-add-tag-open">
          ＋ 追加
        </div>
      </div>
      <div id="tag-list-wrap"></div>
    </div>

    <!-- アプリ設定 -->
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-head"><div class="panel-title">アプリ設定</div></div>
      <div class="toggle-wrap">
        <div class="toggle-left">
          <div class="row-icon" style="background:var(--sage-bg);">
            <svg viewBox="0 0 24 24" style="stroke:var(--sage);width:15px;height:15px;">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          </div>
          <div>
            <div class="toggle-title">SE音</div>
            <div class="toggle-sub">保存・操作時の効果音</div>
          </div>
        </div>
        <div class="toggle ${Sound.isEnabled() ? 'on' : ''}" id="toggle-sound">
          <div class="toggle-knob"></div>
        </div>
      </div>
    </div>

    <div style="text-align:center;font-size:11px;color:var(--mid-lt);margin-top:24px;">
      Flowra v0.1.0 — Supabase + PWA
    </div>`;

  // タグリスト描画
  renderTagList(tags);

  // ── イベント ──

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (confirm('ログアウトしますか？')) Auth.signOut();
  });

  document.getElementById('btn-copy-invite')?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.origin + '?invite=' + (team?.id || ''))
      .then(() => showToast('招待リンクをコピーしました'));
  });

  document.getElementById('toggle-sound')?.addEventListener('click', function() {
    const newVal = !Sound.isEnabled();
    Sound.setEnabled(newVal);
    this.classList.toggle('on', newVal);
    if (newVal) Sound.playTap();
  });

  // ＋追加 → タグ追加シート
  document.getElementById('btn-add-tag-open')?.addEventListener('click', () => {
    openTagAddSheet(tags);
  });
}

// ── タグ追加ボトムシート ──
function openTagAddSheet(tags) {
  Sound.playOpen();

  const sheet = document.createElement('div');
  sheet.id = 'tag-add-sheet';
  sheet.style.cssText = `
    position:fixed;inset:0;z-index:700;
    background:rgba(28,43,34,0.45);
    display:flex;align-items:flex-end;justify-content:center;
  `;

  sheet.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;
      border-radius:20px 20px 0 0;padding:0 16px 36px;">
      <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 16px;"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
        <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">タグを追加</div>
        <button id="btn-close-add-sheet"
          style="width:28px;height:28px;border-radius:50%;background:var(--mist);border:none;
          display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
          <svg viewBox="0 0 24 24" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="form-section" style="margin-bottom:14px;">
        <div class="form-row no-tap">
          <div class="row-body">
            <div class="row-label">タグ名</div>
            <input class="text-input" id="add-tag-name" placeholder="例：食費"
              style="font-size:16px;" autofocus>
          </div>
        </div>
      </div>
      <div id="add-tag-error" style="display:none;font-size:11.5px;color:var(--red);margin:-8px 0 10px 2px;"></div>

      <button class="btn-primary" id="btn-save-new-tag">
        <svg viewBox="0 0 24 24" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
        追加する
      </button>
    </div>`;

  document.body.appendChild(sheet);

  // フォーカス
  setTimeout(() => document.getElementById('add-tag-name')?.focus(), 100);

  const closeSheet = () => { Sound.playClose(); sheet.remove(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  document.getElementById('btn-close-add-sheet')?.addEventListener('click', closeSheet);

  const doAdd = async () => {
    const name    = document.getElementById('add-tag-name').value.trim();
    const errorEl = document.getElementById('add-tag-error');

    if (!name) {
      errorEl.textContent = 'タグ名を入力してください';
      errorEl.style.display = 'block';
      return;
    }
    const dup = tags.find(t => t.name === name);
    if (dup) {
      errorEl.textContent = `「${name}」は既に登録されています`;
      errorEl.style.display = 'block';
      return;
    }

    try {
      await DB.createTag(name);
      Sound.playSave();
      closeSheet();
      showToast('✓ タグを追加しました');
      renderSettings();
    } catch (e) {
      errorEl.textContent = '追加に失敗しました。';
      errorEl.style.display = 'block';
    }
  };

  document.getElementById('btn-save-new-tag')?.addEventListener('click', doAdd);
  document.getElementById('add-tag-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAdd();
  });
}
