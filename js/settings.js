// ─────────────────────────────────────
//  settings.js  設定画面
// ─────────────────────────────────────
import { Auth }  from './auth.js';
import { Sound } from './sound.js';
import { DB }    from './db.js';
import { showToast, openModal, closeModal } from './utils.js';
import { getCachedTags, putTags } from './cache.js';
import { warmupAddRecord } from './add-record.js';
import { showOnboardingForReplay } from './onboarding.js';

export async function renderSettings() {
  const content = document.getElementById('page-content');

  // キャッシュから即表示
  const [cachedTags, user] = await Promise.all([
    getCachedTags(),
    Auth.getUser(),
  ]);
  if (cachedTags.length > 0) {
    renderSettingsContent(content, user, null, cachedTags, [], []);
  } else {
    content.innerHTML = '<div class="spinner"></div>';
  }

  // バックグラウンドで最新取得
  try {
    const [tags, allTeams] = await Promise.all([
      DB.getTags(), DB.getAllTeams()
    ]);
    await putTags(tags);

    // 自分のチーム（owner）は常に取得
    const ownEntry  = allTeams.find(t => t.role === 'owner');
    const ownTeamId = ownEntry?.team_id;
    const ownTeam   = ownEntry?.teams || null;

    // 自分のチームのメンバー一覧
    const ownMembers = ownTeamId
      ? await DB.getTeamMemberProfilesForTeam(ownTeamId)
      : [];

    // 他チームに参加している場合（role !== 'owner'）
    const joinedEntries = allTeams.filter(t => t.role !== 'owner');
    // 各参加チームのメンバー情報（オーナー名表示用）
    const joinedTeams = await Promise.all(
      joinedEntries.map(async e => {
        const members = await DB.getTeamMemberProfilesForTeam(e.team_id);
        return { entry: e, members };
      })
    );

    renderSettingsContent(content, user, ownTeam, tags, ownMembers, joinedTeams);
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
      await warmupAddRecord();
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
      await warmupAddRecord();
      Sound.playClose();
      closeSheet();
      showToast('タグを削除しました');
      renderSettings();
    } catch (e) {
      showToast('削除に失敗しました: ' + e.message);
    }
  });
}

async function renderSettingsContent(content, user, ownTeam, tags, ownMembers = [], joinedTeams = []) {
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
      <div class="form-row" id="btn-edit-team-name" style="justify-content:space-between;">
        <span style="font-size:14px;font-weight:500;">チーム名</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:var(--mid);">${ownTeam?.name || '—'}</span>
          <svg viewBox="0 0 24 24" width="13" height="13" style="color:var(--mid-lt);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
      <div class="form-row" id="btn-replay-onboarding" style="color:var(--sage);">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        オンボーディングをもう一度見る
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

    <!-- 自分のチーム（常に表示） -->
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-head"><div class="panel-title">パートナー共有</div></div>
      <div id="members-list" style="padding:0 0 4px;"></div>
      <div style="padding:12px 16px 16px;">
        <button class="btn-primary" id="btn-create-invite">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </svg>
          招待リンクを発行
        </button>
      </div>
    </div>

    <!-- 参加中のチーム（他チームに招待されている場合のみ） -->
    ${joinedTeams.length > 0 ? `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-head"><div class="panel-title">参加中のチーム</div></div>
      <div id="joined-teams-list"></div>
    </div>
    ` : ''}

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

  // 自分のチームのメンバーリスト
  renderMembersList(ownMembers, user);

  // 参加中チームリスト
  if (joinedTeams.length > 0) {
    renderJoinedTeamsList(joinedTeams, user);
  }

  // ── イベント ──

  document.getElementById('btn-replay-onboarding')?.addEventListener('click', () => {
    showOnboardingForReplay();
  });

  // チーム名編集
  document.getElementById('btn-edit-team-name')?.addEventListener('click', () => {
    if (ownTeam) openTeamNameSheet(ownTeam);
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (confirm('ログアウトしますか？')) Auth.signOut();
  });

  // 招待リンク発行（常に自分のチームへ）
  document.getElementById('btn-create-invite')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-create-invite');
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const invite = await DB.createInviteForOwnTeam('member');
      const url = `${window.location.origin}?invite=${invite.token}`;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch (_) {}
      if (copied) {
        showToast('招待リンクをコピーしました（7日間有効）');
      } else {
        showInviteUrlDialog(url);
      }
    } catch (e) {
      showToast('エラー: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> 招待リンクを発行`;
    }
  });

  document.getElementById('toggle-sound')?.addEventListener('click', function() {
    const newVal = !Sound.isEnabled();
    Sound.setEnabled(newVal);
    this.classList.toggle('on', newVal);
    if (newVal) Sound.playTap();
  });

  document.getElementById('btn-add-tag-open')?.addEventListener('click', () => {
    openTagAddSheet(tags);
  });
}

// ── メンバーリスト描画（自分のチーム用）──
function renderMembersList(members, currentUser) {
  const wrap = document.getElementById('members-list');
  if (!wrap) return;

  const others = members.filter(m => m.user_id !== currentUser?.id);

  if (!others.length) {
    wrap.innerHTML = '<div style="padding:12px 18px;font-size:13px;color:var(--mid);">まだ招待していません</div>';
    return;
  }

  wrap.innerHTML = others.map(m => {
    const name    = m.full_name || m.email?.split('@')[0] || 'メンバー';
    const initial = name.charAt(0).toUpperCase();
    return `
      <div class="form-row no-tap" style="align-items:center;gap:10px;padding:12px 16px;">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--gold);color:#fff;
          display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;">${initial}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:500;margin-bottom:4px;">${name}</div>
          <select class="member-role-select" data-user-id="${m.user_id}"
            style="font-size:12px;padding:3px 8px;border-radius:8px;border:1px solid var(--border);
            background:var(--white);color:var(--ink);cursor:pointer;margin-bottom:3px;display:block;">
            <option value="viewer"  ${m.role === 'viewer' ? 'selected' : ''}>閲覧のみ</option>
            <option value="member"  ${m.role !== 'viewer' ? 'selected' : ''}>編集・削除可</option>
          </select>
          <div style="font-size:11px;color:var(--mid-lt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.email || ''}</div>
        </div>
        <button class="btn-member-remove" data-user-id="${m.user_id}"
          style="width:28px;height:28px;border-radius:50%;background:var(--mist);border:none;
          color:var(--mid);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
          <svg viewBox="0 0 24 24" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('.member-role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      try {
        await DB.updateMemberRole(sel.dataset.userId, sel.value);
        showToast('権限を変更しました');
      } catch (e) {
        showToast('エラー: ' + e.message);
      }
    });
  });

  wrap.querySelectorAll('.btn-member-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('このメンバーを削除しますか？')) return;
      try {
        await DB.removeMember(btn.dataset.userId);
        showToast('メンバーを削除しました');
        btn.closest('.form-row').remove();
      } catch (e) {
        showToast('エラー: ' + e.message);
      }
    });
  });
}

// ── 参加中チームリスト（複数チーム対応・各チームに脱退ボタン）──
function renderJoinedTeamsList(joinedTeams, currentUser) {
  const wrap = document.getElementById('joined-teams-list');
  if (!wrap) return;

  wrap.innerHTML = joinedTeams.map(({ entry, members }) => {
    const owner = members.find(m => m.role === 'owner');
    const me    = members.find(m => m.user_id === currentUser?.id);
    if (!owner) return '';

    const name      = owner.full_name || owner.email?.split('@')[0] || 'オーナー';
    const initial   = name.charAt(0).toUpperCase();
    const roleLabel = me?.role === 'viewer' ? '閲覧のみ' : '編集・削除可';
    const roleBg    = me?.role === 'viewer' ? 'var(--stone)' : 'var(--sage-bg)';
    const roleColor = me?.role === 'viewer' ? 'var(--mid)' : 'var(--sage-dk)';

    return `
      <div style="padding:0 0 4px;">
        <div class="form-row" style="gap:10px;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--sage);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;">${initial}</div>
            <div>
              <div style="font-size:14px;font-weight:500;">${name}のチーム</div>
              <div style="font-size:11px;color:var(--mid);">${owner.email || ''}</div>
            </div>
          </div>
          <span style="font-size:11px;padding:3px 8px;border-radius:20px;white-space:nowrap;background:${roleBg};color:${roleColor};flex-shrink:0;">${roleLabel}</span>
        </div>
        <div style="padding:4px 16px 12px;text-align:center;">
          <button class="btn-leave-joined" data-team-id="${entry.team_id}"
            style="background:none;border:none;color:var(--mid);font-size:13px;cursor:pointer;text-decoration:underline;padding:8px;">
            このチームから脱退する
          </button>
        </div>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('.btn-leave-joined').forEach(btn => {
    btn.addEventListener('click', () => {
      showLeaveTeamModal(btn.dataset.teamId);
    });
  });
}

// ── 招待URL表示ダイアログ（クリップボードAPI失敗時のフォールバック）──
function showInviteUrlDialog(url) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(28,43,34,0.6);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 0.3s;';
  overlay.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:28px 28px 0 0;padding:28px 24px 48px;">
      <h3 style="font-size:16px;font-weight:600;color:var(--ink);margin-bottom:8px;">招待リンク</h3>
      <p style="font-size:13px;color:var(--mid);margin-bottom:16px;">以下のリンクをコピーしてパートナーに送ってください（7日間有効）</p>
      <div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--ink);word-break:break-all;margin-bottom:16px;-webkit-user-select:text;user-select:text;">${url}</div>
      <button id="btn-invite-share" style="width:100%;padding:14px;border-radius:14px;border:none;background:var(--sage);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">共有する</button>
      <button id="btn-invite-close" style="width:100%;padding:10px;background:none;border:none;color:var(--mid);font-size:13px;cursor:pointer;">閉じる</button>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.style.opacity = '1');

  // Web Share API（iOSで使える）
  document.getElementById('btn-invite-share')?.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Flowra 招待リンク', url });
        overlay.remove();
      } catch (_) {}
    } else {
      // Web Share APIもない場合はテキスト選択を促す
      showToast('上のURLを長押しでコピーしてください');
    }
  });

  document.getElementById('btn-invite-close')?.addEventListener('click', () => overlay.remove());
}

// ── チーム脱退確認モーダル ──
function showLeaveTeamModal(teamId = null) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(28,43,34,0.6);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 0.3s;';
  overlay.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:28px 28px 0 0;padding:32px 24px 48px;">
      <h3 style="font-family:'Noto Serif JP',serif;font-size:18px;font-weight:600;color:var(--ink);margin-bottom:12px;">チームから脱退しますか？</h3>
      <p style="font-size:14px;color:var(--mid);line-height:1.7;margin-bottom:24px;">脱退するとこのチームのデータが<br>閲覧・編集できなくなります。<br>自分の個人データに切り替わります。</p>
      <p style="font-size:13px;color:var(--mid);margin-bottom:8px;">確認のため「脱退する」と入力してください</p>
      <input id="leave-confirm-input" type="text" placeholder="脱退する"
        style="-webkit-user-select:text;user-select:text;width:100%;padding:12px 14px;border-radius:10px;border:1.5px solid var(--border);font-size:15px;background:var(--white);color:var(--ink);margin-bottom:16px;box-sizing:border-box;">
      <button id="btn-leave-confirm" disabled
        style="width:100%;padding:14px;border-radius:14px;border:none;background:var(--mid-lt);color:#fff;font-size:15px;font-weight:600;cursor:default;margin-bottom:10px;transition:background 0.15s;">
        脱退する
      </button>
      <button id="btn-leave-cancel"
        style="width:100%;padding:10px;background:none;border:none;color:var(--mid);font-size:13px;cursor:pointer;">
        キャンセル
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.style.opacity = '1');

  const input = overlay.querySelector('#leave-confirm-input');
  const confirmBtn = overlay.querySelector('#btn-leave-confirm');

  input.addEventListener('input', () => {
    const ok = input.value === '脱退する';
    confirmBtn.disabled = !ok;
    confirmBtn.style.background = ok ? 'var(--red)' : 'var(--mid-lt)';
    confirmBtn.style.cursor = ok ? 'pointer' : 'default';
  });

  confirmBtn.addEventListener('click', async () => {
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = '処理中…';
    try {
      const targetTeamId = teamId || await DB.getTeamId();
      await DB.leaveTeam(targetTeamId);
      overlay.remove();
      showToast('チームから脱退しました');
      window.location.reload();
    } catch (e) {
      showToast('エラー: ' + e.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '脱退する';
    }
  });

  overlay.querySelector('#btn-leave-cancel')?.addEventListener('click', () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  });
}

// ── チーム名編集ボトムシート ──
function openTeamNameSheet(team) {
  Sound.playOpen();

  const sheet = document.createElement('div');
  sheet.id = 'team-name-sheet';
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
        <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;">チーム名を変更</div>
        <button id="btn-close-team-name-sheet"
          style="width:28px;height:28px;border-radius:50%;background:var(--mist);border:none;
          display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mid);">
          <svg viewBox="0 0 24 24" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="form-section" style="margin-bottom:14px;">
        <div class="form-row no-tap">
          <div class="row-body">
            <div class="row-label">チーム名</div>
            <input class="text-input" id="edit-team-name" value="${team.name}"
              style="font-size:16px;" placeholder="例：遠藤家">
          </div>
        </div>
      </div>
      <div id="team-name-error" style="display:none;font-size:11.5px;color:var(--red);margin:-8px 0 10px 2px;"></div>

      <button class="btn-primary" id="btn-save-team-name">
        <svg viewBox="0 0 24 24" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
        変更を保存
      </button>
    </div>`;

  document.body.appendChild(sheet);

  setTimeout(() => document.getElementById('edit-team-name')?.focus(), 100);

  const closeSheet = () => { Sound.playClose(); sheet.remove(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  document.getElementById('btn-close-team-name-sheet')?.addEventListener('click', closeSheet);

  document.getElementById('btn-save-team-name')?.addEventListener('click', async () => {
    const name    = document.getElementById('edit-team-name').value.trim();
    const errorEl = document.getElementById('team-name-error');

    if (!name) {
      errorEl.textContent = 'チーム名を入力してください';
      errorEl.style.display = 'block';
      return;
    }

    try {
      await DB.updateTeam(team.id, { name });
      Sound.playTap();
      closeSheet();
      showToast('✓ チーム名を変更しました');
      renderSettings();
    } catch (e) {
      errorEl.textContent = '更新に失敗しました: ' + e.message;
      errorEl.style.display = 'block';
    }
  });

  document.getElementById('edit-team-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-save-team-name')?.click();
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
      await warmupAddRecord();
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
