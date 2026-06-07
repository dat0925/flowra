// ─────────────────────────────────────
//  settings.js  設定画面
// ─────────────────────────────────────
import { Auth }  from './auth.js';
import { Sound } from './sound.js';
import { supabase } from './config.js';
import { DB }    from './db.js';
import { showToast, openModal, closeModal } from './utils.js';
import { getCachedTags, putTags } from './cache.js';
import { warmupAddRecord } from './add-record.js';
import { showOnboardingForReplay } from './onboarding.js';

// サブページを全画面でオーバーレイ表示
function openSubPage(title, renderFn, { showSave = false, onSave = null, onAdd = null } = {}) {
  document.getElementById('settings-subpage')?.remove();

  if (!document.getElementById('subpage-style')) {
    const s = document.createElement('style');
    s.id = 'subpage-style';
    s.textContent = '@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}';
    document.head.appendChild(s);
  }

  const page = document.createElement('div');
  page.id = 'settings-subpage';
  page.style.cssText = 'position:fixed;inset:0;z-index:500;background:var(--stone);display:flex;flex-direction:column;animation:slideInRight 0.25s ease;';

  // 下部バー（タグ管理: 戻る＋追加、予算管理: 戻る＋保存）
  const bottomBtn = showSave
    ? '<button id="btn-subpage-save" class="btn-primary" style="flex:1;">保存</button>'
    : '<button id="btn-subpage-add" style="flex:1;padding:12px;background:var(--sage-bg);border:1.5px solid var(--sage);border-radius:12px;font-size:14px;font-weight:600;color:var(--sage);cursor:pointer;">＋ タグを追加</button>';

  page.innerHTML =
    // タイトルのみのヘッダー（操作なし）
    '<div style="flex-shrink:0;padding:14px 16px 12px;border-bottom:1px solid var(--border);background:var(--stone);text-align:center;">'
    + '<span style="font-size:16px;font-weight:600;color:var(--ink);">' + title + '</span>'
    + '</div>'
    // コンテンツ
    + '<div id="subpage-content" style="flex:1;overflow-y:auto;padding:16px 0 8px;"></div>'
    // 下部固定バー（セーフエリア対応）
    + '<div style="flex-shrink:0;padding:10px 16px;padding-bottom:calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--border);background:var(--stone);display:flex;gap:10px;">'
    + '<button id="btn-subpage-back" style="flex:0 0 auto;min-width:88px;padding:12px;background:none;border:1.5px solid var(--border);border-radius:12px;font-size:14px;color:var(--mid);cursor:pointer;">← 戻る</button>'
    + bottomBtn
    + '</div>';

  document.body.appendChild(page);

  const closeSubPage = () => {
    Sound.playClose();
    page.style.animation = 'none';
    page.style.transform = 'translateX(100%)';
    page.style.transition = 'transform 0.2s ease';
    setTimeout(() => { page.remove(); renderSettings(); }, 200);
  };

  document.getElementById('btn-subpage-back')?.addEventListener('click', closeSubPage);
  document.getElementById('btn-subpage-save')?.addEventListener('click', () => {
    if (onSave) onSave(closeSubPage);
  });
  document.getElementById('btn-subpage-add')?.addEventListener('click', () => {
    if (onAdd) onAdd();
  });

  // 右スワイプで閉じる
  let startX = 0, startY = 0, swiping = false;
  page.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = false;
  }, { passive: true });
  page.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (!swiping && dx > 10 && dy < dx * 0.8) swiping = true;
    if (swiping) {
      page.style.transform = 'translateX(' + Math.max(0, dx) + 'px)';
      page.style.transition = 'none';
    }
  }, { passive: true });
  page.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (swiping && dx > window.innerWidth * 0.35) {
      closeSubPage();
    } else {
      page.style.transform = '';
      page.style.transition = 'transform 0.2s ease';
    }
    swiping = false;
  }, { passive: true });

  const container = document.getElementById('subpage-content');
  renderFn(container);
}

export async function renderSettings() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="spinner"></div>';

  try {
    // ユーザー・タグは即時取得して先に描画
    const [user, tags, allTeams] = await Promise.all([
      Auth.getUser(),
      DB.getTags(),
      DB.getAllTeams(),
    ]);
    await putTags(tags);

    const ownEntry  = allTeams.find(t => t.role === 'owner');
    const ownTeamId = ownEntry?.team_id;
    const ownTeam   = ownTeamId ? await DB.getTeamById(ownTeamId) : null;

    // メンバー情報なしで先に描画（画面揺れを防ぐためスペーサーを確保）
    renderSettingsContent(content, user, ownTeam, ownTeamId, tags, [], []);

    // メンバー情報はバックグラウンドで取得して差し込む
    const ownMembers = ownTeamId
      ? await DB.getTeamMemberProfilesForTeam(ownTeamId)
      : [];
    const joinedEntries = allTeams.filter(t => t.role !== 'owner');
    const joinedTeams = await Promise.all(
      joinedEntries.map(async e => {
        const members = await DB.getTeamMemberProfilesForTeam(e.team_id);
        return { entry: e, members };
      })
    );

    // メンバーリストだけ更新（画面全体を再描画しない）
    updateMembersSection(ownTeamId, ownMembers, joinedTeams, tags);

  } catch (e) {
    content.innerHTML = '<div class="empty-state"><div class="empty-state-title">エラー: ' + e.message + '</div></div>';
  }
}

// ── タグリスト再描画（モーダル内・設定画面共用）──
async function renderTagList(tags) {
  const wrap = document.getElementById('tag-list-wrap');
  if (!wrap) return;

  if (tags.length === 0) {
    wrap.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-state-sub">タグがありません</div></div>';
    return;
  }

  // 予算情報を取得
  let budgetMap = {};
  try { budgetMap = await DB.getBudgets(null); } catch(_) {}

  wrap.innerHTML = tags.map(t => {
    const ico = getTagIcon(t);
    const c   = t.color || '#7A9485';
    const dotOrIcon = ico
      ? '<div style="width:28px;height:28px;border-radius:8px;background:' + ico.bg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="' + ico.stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + ico.path + '"/></svg></div>'
      : '<div style="width:28px;height:28px;border-radius:8px;background:' + c + '33;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
        + '<div style="width:10px;height:10px;border-radius:50%;background:' + c + ';"></div></div>';
    const budget = budgetMap[t.id];
    const budgetLabel = budget
      ? '<span style="font-size:11px;color:var(--sage);font-weight:600;margin-left:6px;">¥' + Number(budget.amount).toLocaleString() + '</span>'
      : '';
    return '<div class="tag-item" data-tag-id="' + t.id + '" style="cursor:pointer;">'
      + '<div class="drag-handle" style="width:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--mid-lt);touch-action:none;cursor:grab;padding:8px 4px;">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="17" r="1" fill="currentColor"/><circle cx="15" cy="17" r="1" fill="currentColor"/></svg>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">'
      + dotOrIcon
      + '<span style="font-size:14px;">' + t.name + '</span>'
      + budgetLabel
      + '</div>'
      + '<svg viewBox="0 0 24 24" width="13" height="13" style="color:var(--mid-lt);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>'
      + '</div>';
  }).join('');

  // 行全体タップ → 編集シート（シェブロンだけでなく行全体）
  wrap.querySelectorAll('.tag-item').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.drag-handle')) return; // ドラッグハンドルは除外
      const tag = tags.find(t => t.id === row.dataset.tagId);
      if (tag) openTagEditSheet(tag, tags);
    });
  });

  // ドラッグ並び替え
  initTagDragSort(wrap, tags, async (newOrder) => {
    try {
      await DB.reorderTags(newOrder);
      const updated = await DB.getTags();
      const { putTags } = await import('./cache.js');
      await putTags(updated);
      const { warmupAddRecord } = await import('./add-record.js');
      await warmupAddRecord();
      renderTagList(updated);
    } catch (e) {
      showToast('エラー: ' + e.message);
    }
  });
}

// ── タグ用ドラッグソート（口座と同じ実装）──
function initTagDragSort(listEl, tags, onReorder) {
  const items = Array.from(listEl.querySelectorAll('.tag-item'));
  if (items.length <= 1) return;

  let dragging = null, dragIdx = -1, newIdx = -1;
  let startY = 0, dragH = 0, origCenters = [];

  const onMove = e => {
    if (!dragging) return;
    e.preventDefault();
    const dy = e.touches[0].clientY - startY;
    dragging.style.transform = `translateY(${dy}px)`;

    const fingerY = e.touches[0].clientY;
    let best = dragIdx, bestDist = Infinity;
    origCenters.forEach((cy, i) => {
      const d = Math.abs(fingerY - cy);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    newIdx = best;

    items.forEach((el, i) => {
      if (el === dragging) return;
      el.style.transition = 'transform 0.15s ease';
      let shift = 0;
      if (newIdx > dragIdx && i > dragIdx && i <= newIdx) shift = -dragH;
      else if (newIdx < dragIdx && i >= newIdx && i < dragIdx) shift = dragH;
      el.style.transform = `translateY(${shift}px)`;
    });
  };

  const onEnd = () => {
    if (!dragging) return;
    const finalIdx = newIdx >= 0 ? newIdx : dragIdx;
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onEnd);

    if (finalIdx === dragIdx) {
      items.forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
      dragging.classList.remove('is-dragging');
      dragging = null; newIdx = -1;
      return;
    }

    const newItemOrder = [...items];
    const [movedItem] = newItemOrder.splice(dragIdx, 1);
    newItemOrder.splice(finalIdx, 0, movedItem);

    const parent = items[0].parentNode;
    items.forEach(el => { el.style.transition = 'none'; el.style.transform = ''; });
    dragging.classList.remove('is-dragging');
    newItemOrder.forEach(el => parent.appendChild(el));

    dragging = null; newIdx = -1;

    const newOrder = [...tags];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(finalIdx, 0, moved);
    onReorder(newOrder);
  };

  listEl.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('touchstart', e => {
      const item = handle.closest('.tag-item');
      const idx  = items.indexOf(item);
      if (idx < 0) return;

      dragging    = item;
      dragIdx     = idx;
      newIdx      = idx;
      dragH       = item.offsetHeight + 1;
      startY      = e.touches[0].clientY;
      origCenters = items.map(el => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });

      item.classList.add('is-dragging');
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onEnd,  { passive: true });
      e.stopPropagation();
    }, { passive: true });
  });
}

// ── タグ編集ボトムシート ──

// ── 予算管理 ────────────────────────────────────────────

async function renderBudgetList(tags) {
  const wrap = document.getElementById('budget-list-wrap');
  if (!wrap) return;

  let budgetMap = {};
  try {
    budgetMap = await DB.getBudgets(null);
  } catch(e) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--red);padding:8px 0;">読み込みエラー</div>';
    return;
  }

  if (tags.length === 0) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--mid-lt);padding:12px 0;">タグがありません</div>';
    return;
  }

  const totalBudget = tags.reduce((s, tag) => {
    const b = budgetMap[tag.id];
    return s + (b ? b.amount : 0);
  }, 0);

  const renderRows = () => {
    const currentTotal = wrap.querySelectorAll('.budget-input')
      ? (() => { let t = 0; wrap.querySelectorAll('.budget-input').forEach(el => { t += parseInt((el.value||'0').replace(/,/g,''),10)||0; }); return t; })()
      : totalBudget;

    return tags.map(tag => {
      const b = budgetMap[tag.id];
      const budget = b ? b.amount : 0;
      const pct = currentTotal > 0 && budget > 0 ? Math.round(budget / currentTotal * 100) : 0;
      const barHTML = currentTotal > 0 && budget > 0
        ? '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">' +
          '<div style="flex:1;height:4px;border-radius:2px;background:var(--mist);overflow:hidden;">' +
          '<div style="height:100%;width:' + Math.min(100,pct) + '%;background:' + (tag.color||'var(--sage)') + ';border-radius:2px;transition:width 0.4s;"></div>' +
          '</div>' +
          '<span style="font-size:10px;font-weight:600;color:var(--mid);min-width:28px;text-align:right;">' + pct + '%</span>' +
          '</div>'
        : '';
      return '<div class="budget-tag-row" style="padding:6px 0;border-bottom:1px solid var(--border);">' +
        '<label class="budget-row" data-tag-id="' + tag.id + '" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:text;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + (tag.color||'var(--sage)') + ';flex-shrink:0;display:inline-block;"></span>' +
        '<span style="font-size:14px;">' + tag.name + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
        '<div style="display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;padding:3px 8px;background:var(--white);">' +
        '<span style="font-size:12px;color:var(--mid);margin-right:2px;">¥</span>' +
        '<input type="text" inputmode="numeric" class="text-input budget-input" data-tag-id="' + tag.id + '" value="' + (b ? Number(b.amount).toLocaleString() : '') + '" placeholder="−" style="width:72px;text-align:right;font-size:14px;padding:0;border:none;background:transparent;border-bottom:1.5px solid var(--border);" />' +
        '</div>' +
        '<button class="btn-budget-month" data-tag-id="' + tag.id + '" style="font-size:11px;color:var(--sage);background:var(--sage-bg);border:none;border-radius:6px;padding:4px 8px;cursor:pointer;white-space:nowrap;">月で調整</button>' +
        '</div></label>' + barHTML + '</div>';
    }).join('');
  };

  const buildHTML = () =>
    '<div style="font-size:11px;color:var(--mid-lt);padding:8px 0 6px;line-height:1.6;">金額をタップして編集 / 月で調整で特定月だけ変更</div>' +
    renderRows() +
    '<div id="budget-total-row" style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border);margin-top:2px;">' +
    '<span style="font-size:13px;font-weight:600;color:var(--ink);">合計</span>' +
    '<span id="budget-total-amount" style="font-size:14px;font-weight:600;color:var(--ink);">¥0</span></div>' +
    '';

  wrap.innerHTML = buildHTML();

  function updateBudgetTotal() {
    const inputs = wrap.querySelectorAll('.budget-input');
    let total = 0;
    inputs.forEach(input => {
      const n = parseInt((input.value || '0').replace(/,/g, ''), 10);
      if (!isNaN(n)) total += n;
    });
    const el = document.getElementById('budget-total-amount');
    if (el) el.textContent = '¥' + total.toLocaleString('ja-JP');
    // バーを再描画
    const newTotal = total;
    wrap.querySelectorAll('.budget-tag-row').forEach((row, i) => {
      const tag = tags[i];
      if (!tag) return;
      const input = row.querySelector('.budget-input');
      const budget = parseInt((input?.value||'0').replace(/,/g,''),10)||0;
      const pct = newTotal > 0 && budget > 0 ? Math.round(budget / newTotal * 100) : 0;
      let barEl = row.querySelector('.pct-bar-wrap');
      if (!barEl && budget > 0) {
        barEl = document.createElement('div');
        barEl.className = 'pct-bar-wrap';
        barEl.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;';
        row.appendChild(barEl);
      }
      if (barEl) {
        barEl.innerHTML = newTotal > 0 && budget > 0
          ? '<div style="flex:1;height:4px;border-radius:2px;background:var(--mist);overflow:hidden;"><div style="height:100%;width:' + Math.min(100,pct) + '%;background:' + (tag.color||'var(--sage)') + ';border-radius:2px;transition:width 0.4s;"></div></div>' +
            '<span style="font-size:10px;font-weight:600;color:var(--mid);min-width:28px;text-align:right;">' + pct + '%</span>'
          : '';
      }
    });
  }

  updateBudgetTotal();

  // 保存処理を外から呼べるようにwrapに保持
  wrap._saveBudgets = async () => {
    const inputs = wrap.querySelectorAll('.budget-input');
    try {
      for (const input of inputs) {
        const tagId = input.dataset.tagId;
        const amount = parseInt((input.value || '0').replace(/,/g, ''), 10);
        await DB.upsertBudget(tagId, amount || 0, null);
      }
      showToast('✓ 予算を保存しました');
      Sound.playTap();
    } catch(e) {
      showToast('エラー: ' + e.message);
    }
  };

  wrap.querySelectorAll('.budget-input').forEach(input => {
    input.addEventListener('focus', () => { input.value = input.value.replace(/,/g, ''); });
    input.addEventListener('blur', () => {
      const n = parseInt(input.value.replace(/,/g, '') || '0', 10);
      input.value = n > 0 ? n.toLocaleString() : '';
      updateBudgetTotal();
    });
    input.addEventListener('input', updateBudgetTotal);
  });


  // 月別上書きシート
  wrap.querySelectorAll('.btn-budget-month').forEach(btn => {
    btn.addEventListener('click', () => {
      const tagId = btn.dataset.tagId;
      const tag   = tags.find(t => t.id === tagId);
      if (tag) openBudgetMonthSheet(tag, budgetMap[tagId]);
    });
  });
}

function openBudgetMonthSheet(tag, defaultBudget) {
  Sound.playOpen();
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  // 翌月 + 当月 + 過去5ヶ月
  const months = [];
  for (let i = 1; i >= -5; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const defaultAmt = defaultBudget ? Number(defaultBudget.amount).toLocaleString('ja-JP') : null;

  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(28,43,34,0.45);display:flex;align-items:flex-end;justify-content:center;';
  sheet.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:20px 20px 0 0;padding:0 16px 36px;max-height:80vh;overflow-y:auto;">
      <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 16px;"></div>
      <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;margin-bottom:4px;">月別予算 — ${tag.name}</div>
      <div style="font-size:12px;color:var(--mid);margin-bottom:4px;line-height:1.6;">
        特定の月だけ予算を変えたいときに入力します。<br>空欄の月はデフォルト予算（${defaultAmt ? '¥' + defaultAmt : '未設定'}）が使われます。
      </div>
      <div style="font-size:11px;color:var(--mid-lt);background:var(--sage-bg);border-radius:8px;padding:8px 10px;margin-bottom:14px;">
        例）旅行の月だけ食費を多めに設定、ボーナス月に娯楽費を増やすなど
      </div>
      <div class="form-section" style="margin-bottom:14px;">
        ${months.map(m => {
          const isCurrentMonth = m === currentMonthKey;
          const label = m.slice(0,4) + '年' + parseInt(m.slice(5)) + '月' + (isCurrentMonth ? ' <span style="font-size:10px;color:var(--sage);background:var(--sage-bg);padding:1px 6px;border-radius:4px;margin-left:6px;">今月</span>' : '');
          return `
          <label style="display:flex;align-items:center;justify-content:space-between;
            padding:13px 16px;cursor:pointer;border-bottom:1px solid var(--border);">
            <span style="font-size:14px;">${label}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:13px;color:var(--mid);">¥</span>
              <input type="text" inputmode="numeric" class="text-input month-budget-input"
                data-month="${m}" placeholder="${defaultAmt ? defaultAmt : '−'}"
                style="width:110px;text-align:right;font-size:15px;padding:4px 8px;border-radius:8px;">
            </div>
          </label>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:10px;">
        <button id="btn-close-month-budget"
          style="min-width:88px;padding:14px;border-radius:14px;border:1.5px solid var(--border);
          background:var(--white);color:var(--mid);font-family:'Noto Sans JP',sans-serif;
          font-size:14px;font-weight:500;cursor:pointer;">
          キャンセル
        </button>
        <button id="btn-save-month-budget" class="btn-primary" style="flex:1;margin-bottom:0;">保存</button>
      </div>
    </div>`;

  document.body.appendChild(sheet);

  // 既存の月別予算を取得してinputに反映
  months.forEach(async m => {
    try {
      const map = await DB.getBudgets(m);
      const b   = map[tag.id];
      if (b && b.month === m) {
        const input = sheet.querySelector('input[data-month="' + m + '"]');
        if (input) input.value = Number(b.amount).toLocaleString('ja-JP');
      }
    } catch(_) {}
  });

  // 月別入力欄のコンマ整形
  sheet.querySelectorAll('.month-budget-input').forEach(input => {
    input.addEventListener('focus', () => { input.value = input.value.replace(/,/g, ''); });
    input.addEventListener('blur', () => {
      const n = parseInt(input.value.replace(/,/g, '') || '0', 10);
      input.value = n > 0 ? n.toLocaleString() : '';
    });
  });

  sheet.addEventListener('click', e => { if (e.target === sheet) { Sound.playClose(); sheet.remove(); } });
  document.getElementById('btn-close-month-budget')?.addEventListener('click', () => { Sound.playClose(); sheet.remove(); });

  document.getElementById('btn-save-month-budget')?.addEventListener('click', async () => {
    try {
      const inputs = sheet.querySelectorAll('.month-budget-input');
      for (const input of inputs) {
        const m      = input.dataset.month;
        const amount = parseInt((input.value || '0').replace(/,/g, ''), 10);
        await DB.upsertBudget(tag.id, amount || 0, m);
      }
      showToast('✓ 月別予算を保存しました');
      Sound.playTap();
      sheet.remove();
    } catch(e) {
      showToast('エラー: ' + e.message);
    }
  });
}


// ── タグアイコン定義（settings.js内完結） ────────────────
const TAG_ICON_REGISTRY = {
  food:       { label:'食費',     bg:'#E8F2ED', stroke:'#5C8C72', path:'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z' },
  dining:     { label:'外食',     bg:'#E8F5EE', stroke:'#4A8C6A', path:'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z' },
  daily:      { label:'日用品',   bg:'#EEF0F2', stroke:'#6A7A8A', path:'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.9 18 9 18h12v-2H9.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0023.43 5H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z' },
  home:       { label:'住居',     bg:'#F0EDE8', stroke:'#8C7A5C', path:'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z' },
  utility:    { label:'光熱水道', bg:'#F2EEE0', stroke:'#9C8040', path:'M17 8C8 10 5.9 16.17 3.82 19.5c1.17.74 2.63 1 4.18.62C9 22.57 11.26 24 14 24c4.97 0 9-5.46 9-10 0-2.48-1.28-4.83-2-6h-4z' },
  phone:      { label:'通信費',   bg:'#ECEEF8', stroke:'#6068A0', path:'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z' },
  subscription:{ label:'サブスク',bg:'#EEE8F5', stroke:'#7A60A0', path:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z' },
  bus:        { label:'交通費',   bg:'#E8F5F0', stroke:'#508C78', path:'M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z' },
  car:        { label:'車',       bg:'#EEF2E0', stroke:'#789050', path:'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z' },
  medical:    { label:'医療',     bg:'#F5E8E8', stroke:'#A05858', path:'M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z' },
  insurance:  { label:'保険',     bg:'#F5F0E8', stroke:'#9C8050', path:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z' },
  education:  { label:'教育',     bg:'#E8EEF8', stroke:'#5870A0', path:'M12 3L1 9l4 2.18V17h2v-4.82L9 13.4V17c0 1.1 1.34 2 3 2s3-.9 3-2v-3.6l5-2.22V17h2V9L12 3z' },
  hobby:      { label:'娯楽趣味', bg:'#EDE8F8', stroke:'#7058A8', path:'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm1-11h-2v3H8v2h3v3h2v-3h3v-2h-3z' },
  fashion:    { label:'服・美容', bg:'#F8E8F0', stroke:'#A05878', path:'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z' },
  salary:     { label:'給与',     bg:'#E8F5ED', stroke:'#4A8C6A', path:'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z' },
  baby:       { label:'子育て',   bg:'#FFF0E8', stroke:'#C07840', path:'M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z' },
  tax:        { label:'税金',     bg:'#EEE8F0', stroke:'#806890', path:'M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5v-2h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z' },
  travel:     { label:'旅行',     bg:'#E8F0F8', stroke:'#4870A0', path:'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z' },
  gift:       { label:'交際費',   bg:'#F8EEF0', stroke:'#A06878', path:'M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5v-2h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z' },
  pocket:     { label:'小遣い',   bg:'#F5F0E0', stroke:'#A09040', path:'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z' },
  other:      { label:'その他',   bg:'#EEF0EE', stroke:'#6A8A6A', path:'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z' },
};

function getTagIcon(tag) {
  if (tag && tag.icon && TAG_ICON_REGISTRY[tag.icon]) return TAG_ICON_REGISTRY[tag.icon];
  return null;
}

// タグカラースウォッチ
const TAG_COLORS = [
  '#7A9485', '#4A7C59', '#3B6FBF', '#7B5EA7',
  '#C4602A', '#B8973E', '#B83232', '#2F5239',
  '#5C8C72', '#6068A0', '#A05878', '#789050',
  '#808080', '#A09040', '#9C8050', '#5870A0',
];

function renderTagColorPicker(containerId, selectedColor, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = TAG_COLORS.map(c => `
    <button data-color="${c}" style="
      width:28px;height:28px;border-radius:50%;background:${c};
      border:${c === selectedColor ? '3px solid var(--ink)' : '2px solid transparent'};
      box-shadow:${c === selectedColor ? '0 0 0 2px var(--stone),0 0 0 4px '+c : 'none'};
      cursor:pointer;outline:none;transition:all 0.15s;flex-shrink:0;
    "></button>
  `).join('');
  container.querySelectorAll('button[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('button[data-color]').forEach(b => {
        const c = b.dataset.color;
        b.style.border = '2px solid transparent';
        b.style.boxShadow = 'none';
      });
      const c = btn.dataset.color;
      btn.style.border = '3px solid var(--ink)';
      btn.style.boxShadow = `0 0 0 2px var(--stone),0 0 0 4px ${c}`;
      onChange(c);
    });
  });
}

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
        <div class="form-row no-tap">
          <div class="row-body" style="flex-direction:column;align-items:flex-start;gap:10px;">
            <div class="row-label">アイコン</div>
            <div id="edit-tag-icon-picker"
              style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;width:100%;"></div>
            <button id="btn-clear-tag-icon"
              style="font-size:11px;color:var(--mid);background:none;border:1px solid var(--border);
                border-radius:8px;padding:5px 12px;cursor:pointer;margin-top:4px;">
              自動推定に戻す
            </button>
          </div>
        </div>
        <div class="form-row no-tap" style="border-bottom:none;">
          <div class="row-body" style="flex-direction:column;align-items:flex-start;gap:10px;">
            <div class="row-label">カラー</div>
            <div id="edit-tag-color-picker"
              style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;"></div>
          </div>
        </div>
      </div>
      <div id="edit-tag-error" style="display:none;font-size:11.5px;color:var(--red);margin:-8px 0 10px 2px;"></div>

      <!-- キャンセル・保存を横並び（記録画面と同じパターン） -->
      <div style="display:flex;gap:10px;margin-bottom:20px;">
        <button id="btn-cancel-tag"
          style="min-width:88px;padding:14px;border-radius:14px;border:1.5px solid var(--border);
          background:var(--white);color:var(--mid);font-family:'Noto Sans JP',sans-serif;
          font-size:14px;font-weight:500;cursor:pointer;">
          キャンセル
        </button>
        <button class="btn-primary" id="btn-save-tag" style="flex:1;margin-bottom:0;">
          <svg viewBox="0 0 24 24" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
          変更を保存
        </button>
      </div>

      <!-- 削除は十分な余白をとって別ゾーンに -->
      <div style="border-top:1px solid var(--border);padding-top:16px;">
        <button id="btn-delete-tag"
          style="width:100%;padding:13px;border-radius:14px;border:1px solid var(--border);
          background:var(--white);color:var(--mid);font-family:'Noto Sans JP',sans-serif;
          font-size:13px;font-weight:400;cursor:pointer;">
          このタグを削除…
        </button>
      </div>
    </div>`;

  document.body.appendChild(sheet);

  const closeSheet = () => { Sound.playClose(); sheet.remove(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  document.getElementById('btn-close-tag-sheet')?.addEventListener('click', closeSheet);
  document.getElementById('btn-cancel-tag')?.addEventListener('click', closeSheet);

  // アイコンピッカー初期化
  let selectedTagIcon = tag.icon || null;
  const iconPickerEl = document.getElementById('edit-tag-icon-picker');
  if (iconPickerEl) {
    iconPickerEl.innerHTML = Object.entries(TAG_ICON_REGISTRY).map(([key, ico]) => `
      <button data-icon-key="${key}" title="${ico.label}"
        style="display:flex;flex-direction:column;align-items:center;gap:4px;
          padding:8px 4px;border-radius:12px;border:2px solid ${key === selectedTagIcon ? 'var(--sage)' : 'transparent'};
          background:${key === selectedTagIcon ? 'var(--sage-bg)' : ico.bg};
          cursor:pointer;transition:all 0.15s;">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
          stroke="${ico.stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="${ico.path}"/>
        </svg>
        <span style="font-size:9px;color:var(--mid);line-height:1.2;text-align:center;">${ico.label}</span>
      </button>`).join('');

    iconPickerEl.querySelectorAll('button[data-icon-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedTagIcon = btn.dataset.iconKey;
        iconPickerEl.querySelectorAll('button[data-icon-key]').forEach(b => {
          const k = b.dataset.iconKey;
          const ico = TAG_ICON_REGISTRY[k];
          b.style.border = k === selectedTagIcon ? '2px solid var(--sage)' : '2px solid transparent';
          b.style.background = k === selectedTagIcon ? 'var(--sage-bg)' : ico.bg;
        });
      });
    });
  }

  document.getElementById('btn-clear-tag-icon')?.addEventListener('click', () => {
    selectedTagIcon = null;
    iconPickerEl?.querySelectorAll('button[data-icon-key]').forEach(b => {
      b.style.border = '2px solid transparent';
      b.style.background = TAG_ICON_REGISTRY[b.dataset.iconKey]?.bg || 'var(--mist)';
    });
  });

  // カラーピッカー初期化
  let selectedTagColor = tag.color || '#7A9485';
  renderTagColorPicker('edit-tag-color-picker', selectedTagColor, c => { selectedTagColor = c; });

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
      await DB.updateTag(tag.id, { name, color: selectedTagColor, icon: selectedTagIcon });
      await warmupAddRecord();
      Sound.playTap();
      closeSheet();
      showToast('✓ タグを更新しました');
      document.getElementById('page-content').innerHTML = '<div class="spinner"></div>';
      await renderSettings();
    } catch (e) {
      errorEl.textContent = '更新に失敗しました。';
      errorEl.style.display = 'block';
    }
  });

  // 削除（2ステップ確認: 1回目でボタンを赤く、2回目で実行）
  let deleteConfirmPending = false;
  document.getElementById('btn-delete-tag')?.addEventListener('click', async () => {
    const delBtn = document.getElementById('btn-delete-tag');
    if (!deleteConfirmPending) {
      deleteConfirmPending = true;
      delBtn.textContent = '本当に削除しますか？ もう一度タップ';
      delBtn.style.background = 'var(--red-bg)';
      delBtn.style.color = 'var(--red)';
      delBtn.style.borderColor = 'var(--red-bg)';
      setTimeout(() => {
        deleteConfirmPending = false;
        if (delBtn.isConnected) {
          delBtn.textContent = 'このタグを削除…';
          delBtn.style.background = 'var(--white)';
          delBtn.style.color = 'var(--mid)';
          delBtn.style.borderColor = 'var(--border)';
        }
      }, 3000);
      return;
    }
    try {
      await DB.deleteTag(tag.id);
      await warmupAddRecord();
      Sound.playClose();
      closeSheet();
      showToast('タグを削除しました');
      document.getElementById('page-content').innerHTML = '<div class="spinner"></div>';
      await renderSettings();
    } catch (e) {
      showToast('削除に失敗しました: ' + e.message);
    }
  });
}

// 差分更新時にイベントを再登録する（招待ボタンなどownTeamId依存のイベント）
function setupSettingsDynamicEvents(content, user, ownTeam, ownTeamId, tags, ownMembers, joinedTeams) {
  // btn-create-invite は既にDOMにあるのでリスナーを付け直す
  const oldBtn = document.getElementById('btn-create-invite');
  if (oldBtn) {
    const newBtn = oldBtn.cloneNode(true); // リスナーをリセット
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    newBtn.addEventListener('click', async () => {
      newBtn.disabled = true;
      newBtn.textContent = '生成中…';
      try {
        const invite = await DB.createInviteForOwnTeam('member');
        const url = window.location.origin + '?invite=' + invite.token;
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
        newBtn.disabled = false;
        newBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> 招待リンクを発行';
      }
    });
  }

  // チーム名編集
  const teamNameBtn = document.getElementById('btn-edit-team-name');
  if (teamNameBtn && ownTeam) {
    const newTeamBtn = teamNameBtn.cloneNode(true);
    teamNameBtn.parentNode.replaceChild(newTeamBtn, teamNameBtn);
    newTeamBtn.addEventListener('click', () => openTeamNameSheet(ownTeam, ownTeamId));
  }

  // タグ管理・予算管理ページ遷移（再登録）
  setupTagBudgetPageEvents(tags);
}

async function renderSettingsContent(content, user, ownTeam, ownTeamId, tags, ownMembers = [], joinedTeams = []) {
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
          <span id="team-name-display" style="color:var(--mid);">${ownTeam?.name || '—'}</span>
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
      <div class="form-row" id="btn-resync" style="color:var(--sage-dk);">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        データを再同期
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

    <!-- タグ管理・予算管理（別画面へ） -->
    <div class="panel" style="margin-bottom:16px;">
      <div class="form-row" id="btn-open-tag-page" style="cursor:pointer;">
        <div class="row-icon" style="background:var(--sage-bg);">
          <svg viewBox="0 0 24 24" style="stroke:var(--sage);width:15px;height:15px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
            <line x1="7" y1="7" x2="7.01" y2="7"/>
          </svg>
        </div>
        <div class="row-body">
          <div class="row-value">タグ管理</div>
          <div class="row-label" id="tag-count-label">—</div>
        </div>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--mid-lt)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="form-row" id="btn-open-budget-page" style="cursor:pointer;border-bottom:none;">
        <div class="row-icon" style="background:#E8F0F8;">
          <svg viewBox="0 0 24 24" style="stroke:#4870A0;width:15px;height:15px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
        </div>
        <div class="row-body">
          <div class="row-value">予算管理</div>
          <div class="row-label" id="budget-count-label">—</div>
        </div>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--mid-lt)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>

    <!-- 自分のチーム（常に表示） -->
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-head"><div class="panel-title">パートナー共有</div></div>
      <div id="members-list" style="padding:0 0 4px;min-height:48px;"></div>
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

    <!-- 参加中のチーム -->
    <div id="joined-teams-panel" style="margin-bottom:16px;"></div>

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
    </div>
    <div id="admin-link-wrap" style="text-align:center;margin-top:8px;display:none;">
      <a href="/admin.html" style="font-size:11px;color:var(--mid-lt);text-decoration:none;
        padding:4px 10px;border-radius:6px;border:1px solid var(--border);">
        ⚙ 管理画面
      </a>
    </div>`;

  // タグリスト描画
  // タグ件数ラベルを更新
  const tagCountEl = document.getElementById('tag-count-label');
  if (tagCountEl) tagCountEl.textContent = tags.length + '個';

  // 管理者のみ管理画面リンクを表示
  const ADMIN_IDS = ['6fa4c2af-ea85-4207-aacc-538f6b481d66'];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && ADMIN_IDS.includes(user.id)) {
      const el = document.getElementById('admin-link-wrap');
      if (el) el.style.display = 'block';
    }
  } catch(_) {}

  // 予算件数ラベル（非同期で取得）
  const budgetCountEl = document.getElementById('budget-count-label');
  if (budgetCountEl) {
    DB.getBudgets(null).then(map => {
      const n = Object.keys(map).length;
      budgetCountEl.textContent = n > 0 ? n + '個設定済み' : '未設定';
    }).catch(() => { budgetCountEl.textContent = ''; });
  }

  // タグ管理・予算管理ページ遷移（初回描画時）
  setupTagBudgetPageEvents(tags);

  // ── イベント ──

  document.getElementById('btn-replay-onboarding')?.addEventListener('click', () => {
    showOnboardingForReplay();
  });


  // チーム名編集
  document.getElementById('btn-edit-team-name')?.addEventListener('click', () => {
    if (ownTeam) openTeamNameSheet(ownTeam, ownTeamId);
  });

  document.getElementById('btn-resync')?.addEventListener('click', async () => {
    if (!confirm('ローカルキャッシュをクリアしてサーバーから再取得します。よろしいですか？')) return;
    const { clearAll } = await import('./cache.js');
    await clearAll();
    showToast('✓ キャッシュをクリアしました。再読み込みします…');
    setTimeout(() => location.reload(), 1000);
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
// メンバー情報だけ後から差し込む（画面全体を再描画しない）
async function updateMembersSection(ownTeamId, ownMembers, joinedTeams, tags) {
  const { data: { user } } = await supabase.auth.getUser();

  // パートナー共有メンバーリスト
  renderMembersList(ownMembers, user);

  // 参加中のチーム
  const joinedPanel = document.getElementById('joined-teams-panel');
  if (joinedPanel) {
    if (joinedTeams.length > 0) {
      joinedPanel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div class="panel-title">参加中のチーム</div></div>
          <div id="joined-teams-list"></div>
        </div>`;
      renderJoinedTeamsList(joinedTeams, user);
    }
  }

  // タグ・予算ページのイベントを設定
  setupTagBudgetPageEvents(tags);
}

function setupTagBudgetPageEvents(tags) {
  const tagBtn = document.getElementById('btn-open-tag-page');
  if (tagBtn && !tagBtn.dataset.bound) {
    tagBtn.dataset.bound = '1';
    tagBtn.addEventListener('click', () => {
      Sound.playOpen();
      openSubPage('タグ管理', (container) => {
        container.innerHTML = '<div id="tag-list-wrap"></div>';
        renderTagList(tags);
      }, { onAdd: () => openTagAddSheet(tags) });
    });
  }

  const budgetBtn = document.getElementById('btn-open-budget-page');
  if (budgetBtn && !budgetBtn.dataset.bound) {
    budgetBtn.dataset.bound = '1';
    budgetBtn.addEventListener('click', () => {
      Sound.playOpen();
      openSubPage('予算管理', (container) => {
        container.innerHTML = '<div id="budget-list-wrap" style="padding:0 16px 12px;"><div style="font-size:12px;color:var(--mid-lt);padding:12px 0;">読み込み中…</div></div>';
        renderBudgetList(tags);
      }, {
        showSave: true,
        onSave: async (close) => {
          const wrap = document.getElementById('budget-list-wrap');
          if (wrap?._saveBudgets) await wrap._saveBudgets();
          setTimeout(close, 400);
        }
      });
    });
  }
}

function renderMembersListSkeleton() {
  const wrap = document.getElementById('members-list');
  if (!wrap) return;
  // スケルトン: メンバー行と同じ高さのプレースホルダー
  wrap.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;">'
    + '<div style="width:36px;height:36px;border-radius:50%;background:var(--mist);flex-shrink:0;"></div>'
    + '<div style="flex:1;">'
    + '<div style="width:40%;height:12px;border-radius:6px;background:var(--mist);margin-bottom:8px;"></div>'
    + '<div style="width:24%;height:10px;border-radius:6px;background:var(--mist);"></div>'
    + '</div></div>';
}

function renderMembersList(members, currentUser) {
  const wrap = document.getElementById('members-list');
  if (!wrap) return;

  const others = members.filter(m => m.user_id !== currentUser?.id);

  if (!others.length) {
    wrap.innerHTML = '<div style="padding:12px 18px;font-size:13px;color:var(--mid);">まだ招待していません</div>';
    return;
  }

  wrap.innerHTML = others.map(m => {
    const name      = m.full_name || m.email?.split('@')[0] || 'メンバー';
    const initial   = name.charAt(0).toUpperCase();
    const roleLabel = m.role === 'viewer' ? '閲覧のみ' : '編集・削除可';
    const roleBg    = m.role === 'viewer' ? 'var(--stone)' : 'var(--sage-bg)';
    const roleColor = m.role === 'viewer' ? 'var(--mid)' : 'var(--sage-dk)';
    return `
      <div class="form-row member-row" data-user-id="${m.user_id}" style="align-items:center;gap:10px;padding:12px 16px;cursor:pointer;">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--gold);color:#fff;
          display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;">${initial}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:500;margin-bottom:4px;">${name}</div>
          <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:${roleBg};color:${roleColor};">${roleLabel}</span>
        </div>
        <svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--mid-lt);flex-shrink:0;">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    `;
  }).join('');

  // 行タップ → メンバー管理ボトムシート
  wrap.querySelectorAll('.member-row').forEach(row => {
    row.addEventListener('click', () => {
      const member = others.find(m => m.user_id === row.dataset.userId);
      if (member) openMemberSheet(member, async () => {
        // 削除・変更後はDBから再取得して再描画
        const freshMembers = await DB.getTeamMembers().catch(() => []);
        renderMembersList(freshMembers, currentUser);
      });
    });
  });
}

// ── メンバー管理ボトムシート ──
function openMemberSheet(member, onUpdate) {
  Sound.playOpen();
  const name = member.full_name || member.email?.split('@')[0] || 'メンバー';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(28,43,34,0.45);display:flex;align-items:flex-end;justify-content:center;';
  sheet.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:20px 20px 0 0;padding:0 16px 40px;">
      <div style="width:36px;height:4px;border-radius:2px;background:var(--border);margin:12px auto 20px;"></div>

      <!-- メンバー情報 -->
      <div style="display:flex;align-items:center;gap:12px;padding:0 2px 20px;border-bottom:1px solid var(--border);margin-bottom:20px;">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--gold);color:#fff;
          display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;flex-shrink:0;">
          ${name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style="font-size:15px;font-weight:600;">${name}</div>
          <div style="font-size:12px;color:var(--mid);margin-top:2px;">${member.email || ''}</div>
        </div>
      </div>

      <!-- 権限変更 -->
      <div style="font-size:12px;color:var(--mid);font-weight:500;margin-bottom:8px;letter-spacing:0.04em;">アクセス権限</div>
      <div style="display:flex;gap:8px;margin-bottom:24px;">
        <button class="role-btn ${member.role !== 'viewer' ? 'role-btn-active' : ''}" data-role="member"
          style="flex:1;padding:10px;border-radius:12px;border:1.5px solid ${member.role !== 'viewer' ? 'var(--sage)' : 'var(--border)'};
          background:${member.role !== 'viewer' ? 'var(--sage-bg)' : 'var(--white)'};
          color:${member.role !== 'viewer' ? 'var(--sage-dk)' : 'var(--mid)'};font-size:13px;font-weight:500;cursor:pointer;">
          <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:3px;">
            <span style="font-size:12px;">編集・削除可</span>
          </div>
          <div style="font-size:10px;opacity:0.65;">記録の追加・変更ができる</div>
        </button>
        <button class="role-btn ${member.role === 'viewer' ? 'role-btn-active' : ''}" data-role="viewer"
          style="flex:1;padding:10px;border-radius:12px;border:1.5px solid ${member.role === 'viewer' ? 'var(--sage)' : 'var(--border)'};
          background:${member.role === 'viewer' ? 'var(--sage-bg)' : 'var(--white)'};
          color:${member.role === 'viewer' ? 'var(--sage-dk)' : 'var(--mid)'};font-size:13px;font-weight:500;cursor:pointer;">
          <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:3px;">
            <span style="font-size:12px;">閲覧のみ</span>
          </div>
          <div style="font-size:10px;opacity:0.65;">記録を見るだけ</div>
        </button>
      </div>

      <!-- 削除 -->
      <button id="btn-sheet-remove"
        style="width:100%;padding:13px;border-radius:14px;border:1px solid var(--border);
        background:var(--white);color:var(--mid);font-size:14px;font-weight:500;cursor:pointer;">
        このメンバーを削除…
      </button>
    </div>`;

  document.body.appendChild(sheet);
  const closeSheet = () => { Sound.playClose(); sheet.remove(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

  // 権限ボタン
  let currentRole = member.role;
  sheet.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newRole = btn.dataset.role;
      if (newRole === currentRole) return;
      try {
        await DB.updateMemberRole(member.user_id, newRole);
        currentRole = newRole;
        member.role = newRole;
        // ボタンのスタイルを更新
        sheet.querySelectorAll('.role-btn').forEach(b => {
          const active = b.dataset.role === newRole;
          b.style.border      = `1.5px solid ${active ? 'var(--sage)' : 'var(--border)'}`;
          b.style.background  = active ? 'var(--sage-bg)' : 'var(--white)';
          b.style.color       = active ? 'var(--sage-dk)' : 'var(--mid)';
        });
        showToast('✓ 権限を変更しました');
        onUpdate();
      } catch (e) {
        showToast('エラー: ' + e.message);
      }
    });
  });

  // 削除 → 確認モーダル
  sheet.querySelector('#btn-sheet-remove')?.addEventListener('click', () => {
    closeSheet();
    showRemoveMemberModal(member, name, onUpdate);
  });
}

// ── メンバー削除確認モーダル ──
function showRemoveMemberModal(member, name, onUpdate) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(28,43,34,0.6);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 0.25s;';
  overlay.innerHTML = `
    <div style="background:var(--stone);width:100%;max-width:480px;border-radius:28px 28px 0 0;padding:32px 24px 48px;">
      <h3 style="font-family:'Noto Serif JP',serif;font-size:18px;font-weight:600;color:var(--ink);margin-bottom:10px;">${name}を削除しますか？</h3>
      <p style="font-size:14px;color:var(--mid);line-height:1.7;margin-bottom:28px;">
        削除するとこのメンバーはチームのデータにアクセスできなくなります。再度招待することで復元できます。
      </p>
      <button id="btn-remove-confirm"
        style="width:100%;padding:14px;border-radius:14px;border:none;background:var(--red);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">
        削除する
      </button>
      <button id="btn-remove-cancel"
        style="width:100%;padding:10px;background:none;border:none;color:var(--mid);font-size:13px;cursor:pointer;">
        キャンセル
      </button>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.style.opacity = '1');

  overlay.querySelector('#btn-remove-confirm')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-remove-confirm');
    btn.disabled = true;
    btn.textContent = '処理中…';
    try {
      await DB.removeMember(member.user_id);
      overlay.remove();
      showToast('メンバーを削除しました');
      onUpdate();
    } catch (e) {
      showToast('エラー: ' + e.message);
      btn.disabled = false;
      btn.textContent = '削除する';
    }
  });

  overlay.querySelector('#btn-remove-cancel')?.addEventListener('click', () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 250);
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

    const ownerName  = owner.full_name || owner.email?.split('@')[0] || 'オーナー';
    const teamData   = Array.isArray(entry.teams) ? entry.teams[0] : entry.teams;
    const teamName   = teamData?.name || `${ownerName}のチーム`;
    const initial    = teamName.charAt(0).toUpperCase();
    const roleLabel  = me?.role === 'viewer' ? '閲覧のみ' : '編集・削除可';
    const roleBg     = me?.role === 'viewer' ? 'var(--stone)' : 'var(--sage-bg)';
    const roleColor  = me?.role === 'viewer' ? 'var(--mid)' : 'var(--sage-dk)';

    return `
      <div style="padding:0 0 4px;">
        <div class="form-row" style="gap:10px;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--sage);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;">${initial}</div>
            <div>
              <div style="font-size:14px;font-weight:500;">${teamName}</div>
              <div style="font-size:11px;color:var(--mid);">${ownerName}</div>
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
function openTeamNameSheet(team, teamId) {
  // teamIdが明示されていない場合はteam.idを使う（後方互換）
  const resolvedTeamId = teamId || (Array.isArray(team) ? team[0]?.id : team?.id);
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
            <input class="text-input" id="edit-team-name" value="${Array.isArray(team) ? team[0]?.name : team?.name || ''}"
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
      await DB.updateTeam(resolvedTeamId, { name });
      Sound.playTap();
      closeSheet();
      showToast('✓ チーム名を変更しました');
      // DOM直接更新（re-renderのキャッシュ問題を回避）
      const displayEl = document.getElementById('team-name-display');
      if (displayEl) {
        displayEl.textContent = name;
      } else {
        // フォールバック: フルre-render
        document.getElementById('page-content').innerHTML = '<div class="spinner"></div>';
        await renderSettings();
      }
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
      document.getElementById('page-content').innerHTML = '<div class="spinner"></div>';
      await renderSettings();
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

