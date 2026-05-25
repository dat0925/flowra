// ─────────────────────────────────────
//  settings.js  設定画面
// ─────────────────────────────────────
import { Auth }  from './auth.js';
import { Sound } from './sound.js';
import { DB }   from './db.js';
import { showToast } from './utils.js';
import { getCachedTags, putTags, getCachedAccounts } from './cache.js';

export async function renderSettings() {
  const content = document.getElementById('page-content');

  // ── STEP 1: キャッシュから即表示（タグ・口座）──
  const [cachedTags, user] = await Promise.all([
    getCachedTags(),
    Auth.getUser(),
  ]);

  if (cachedTags.length > 0) {
    renderSettingsContent(content, user, null, cachedTags);
  } else {
    content.innerHTML = '<div class="spinner"></div>';
  }

  // ── STEP 2: バックグラウンドで最新取得 ──
  try {
    const [team, tags] = await Promise.all([
      DB.getTeam(),
      DB.getTags(),
    ]);
    await putTags(tags);
    renderSettingsContent(content, user, team, tags);
  } catch (e) {
    if (cachedTags.length === 0) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-title">エラー: ${e.message}</div></div>`;
    }
  }
}

async function renderSettingsContent(content, user, team, tags) {

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
        <div id="tag-list-wrap">
          ${tags.length > 0 ? tagsHTML : '<div class="empty-state" style="padding:24px;"><div class="empty-state-sub">タグがありません</div></div>'}
        </div>
        <div style="padding:12px 18px;border-top:1px solid var(--border);">
          <div style="display:flex;gap:10px;">
            <div style="flex:1;position:relative;">
              <input class="text-input" id="new-tag-name" placeholder="タグ名を入力"
                style="width:100%;background:var(--warm);border:1px solid var(--border);border-radius:8px;padding:8px 12px;transition:border-color 0.15s;">
              <div id="tag-input-error" style="display:none;font-size:11.5px;color:var(--red);margin-top:5px;padding-left:2px;"></div>
            </div>
            <button class="btn-primary" id="btn-add-tag" style="width:auto;padding:8px 16px;flex-shrink:0;">追加</button>
          </div>
        </div>
      </div>

      <!-- サウンド設定 -->
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

    // サウンドトグル
    document.getElementById('toggle-sound')?.addEventListener('click', function() {
      const newVal = !Sound.isEnabled();
      Sound.setEnabled(newVal);
      this.classList.toggle('on', newVal);
      if (newVal) Sound.playTap(); // ONにした瞬間に音を鳴らす
    });

    // タグ追加（インラインバリデーション付き）
    const tagInput  = document.getElementById('new-tag-name');
    const tagError  = document.getElementById('tag-input-error');

    function clearTagError() {
      tagError.style.display = 'none';
      tagError.textContent = '';
      tagInput.style.borderColor = 'var(--border)';
      // ハイライト解除
      document.querySelectorAll('.tag-chip.highlight').forEach(el => {
        el.classList.remove('highlight');
        el.style.outline = '';
      });
    }

    function showTagError(msg, duplicateTagName = null) {
      tagError.textContent = msg;
      tagError.style.display = 'block';
      tagInput.style.borderColor = 'var(--red)';
      tagInput.focus();

      // 重複タグをハイライト
      if (duplicateTagName) {
        document.querySelectorAll('.tag-chip').forEach(el => {
          if (el.textContent.trim() === duplicateTagName) {
            el.style.outline = '2px solid var(--red)';
            el.style.outlineOffset = '2px';
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      }

      Sound.playError();
    }

    tagInput?.addEventListener('input', clearTagError);

    document.getElementById('btn-add-tag')?.addEventListener('click', async () => {
      const name = tagInput.value.trim();

      // ① 空欄チェック（クライアント）
      if (!name) {
        showTagError('タグ名を入力してください');
        return;
      }

      // ② 重複チェック（クライアント・即時）
      const duplicate = tags.find(t => t.name === name);
      if (duplicate) {
        showTagError(`「${name}」は既に登録されています`, name);
        return;
      }

      try {
        await DB.createTag(name);
        Sound.playTap();
        showToast('✓ タグを追加しました');
        renderSettings();
      } catch (e) {
        // サーバー側エラー（念のため）
        if (e.message?.includes('unique') || e.code === '23505') {
          showTagError(`「${name}」は既に登録されています`, name);
        } else {
          showTagError('追加に失敗しました。もう一度お試しください。');
        }
      }
    });

    // Enterキーでも追加
    tagInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-add-tag')?.click();
    });
}
