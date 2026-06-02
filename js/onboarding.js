// ─────────────────────────────────────
//  onboarding.js  初回オンボーディング
//  口座が0件の新規ユーザーにのみ表示
//  5ステップ: ウェルカム→口座→初回記録→招待→完了
// ─────────────────────────────────────
import { DB } from './db.js';

// チームが存在するまで最大10秒リトライ（新規ユーザーのトリガー遅延対策）
async function ensureTeam(maxWaitMs = 10000) {
  const interval = 800;
  let elapsed = 0;
  while (elapsed < maxWaitMs) {
    try {
      // セッション切れ対策: 毎回セッションを確認してから取得
      const { data: { session } } = await import('./config.js').then(m => m.supabase.auth.getSession());
      if (!session) throw new Error('セッションが切れています。再ログインしてください。');
      const teamId = await DB.getOwnTeamId();
      if (teamId) {
        DB.setActiveTeamId(teamId);
        return teamId;
      }
    } catch (e) {
      // JWTエラーはリトライせず即throw
      if (e.message && (e.message.includes('JWT') || e.message.includes('セッション'))) throw e;
    }
    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;
  }
  throw new Error('チームの初期化がタイムアウトしました。画面を再読み込みしてください。');
}

// よく使われる口座テンプレート
const ACCOUNT_PRESETS = [
  { name: '現金',         type: 'cash',    icon: '💴', color: '#7A9485' },
  { name: '楽天銀行',     type: 'bank',    icon: '🏦', color: '#4A7C59' },
  { name: 'みずほ銀行',   type: 'bank',    icon: '🏦', color: '#4A7C59' },
  { name: '三菱UFJ銀行', type: 'bank',    icon: '🏦', color: '#4A7C59' },
  { name: 'PayPay銀行',  type: 'bank',    icon: '🏦', color: '#4A7C59' },
  { name: '楽天カード',   type: 'credit',  icon: '💳', color: '#B83232' },
  { name: 'PayPay',       type: 'ic',      icon: '📱', color: '#B8973E' },
  { name: 'Suica',        type: 'ic',      icon: '🚃', color: '#2F5239' },
  { name: 'メルペイ',     type: 'ic',      icon: '📱', color: '#B8973E' },
  { name: 'その他口座',   type: 'other',   icon: '🏷️', color: '#7A9485' },
];

export async function checkAndShowOnboarding(onComplete) {
  try {
    const accounts = await DB.getAccounts();
    if (accounts.length > 0) {
      onComplete();
      return;
    }
    showOnboarding(onComplete);
  } catch (e) {
    onComplete();
  }
}

// 設定画面からの再表示用（データそのままで体験）
export function showOnboardingForReplay() {
  showOnboarding(() => {});
}

function showOnboarding(onComplete) {
  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.innerHTML = buildHTML();
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('visible'));

  let step = 1;
  const TOTAL_STEPS = 5;
  const selected = new Set();
  let createdAccounts = [];  // Step2で作成した口座
  let inviteUrl = null;      // Step4で生成した招待URL

  function goTo(n) {
    const current = overlay.querySelector('[data-step="' + step + '"]');
    const next    = overlay.querySelector('[data-step="' + n + '"]');
    if (!next) return;
    current?.classList.remove('active');
    next.classList.add('active');
    step = n;
    updateProgress(step);
  }

  function updateProgress(n) {
    const bar = overlay.querySelector('.ob-progress-fill');
    if (bar) bar.style.width = ((n / TOTAL_STEPS) * 100) + '%';
    overlay.querySelectorAll('.ob-dot').forEach((d, i) => {
      d.classList.toggle('active', i + 1 === n);
      d.classList.toggle('done', i + 1 < n);
    });
  }

  // ── Step 1: はじめる ──
  overlay.querySelector('#ob-next-1')?.addEventListener('click', () => goTo(2));

  // ── Step 1: フィーチャーカード展開 ──
  overlay.addEventListener('click', e => {
    const card = e.target.closest('.ob-feature-item[data-feature]');
    if (!card) return;
    const isOpen = card.getAttribute('aria-expanded') === 'true';
    // 他を閉じる
    overlay.querySelectorAll('.ob-feature-item[data-feature]').forEach(c => {
      c.setAttribute('aria-expanded', 'false');
    });
    // 同じカードなら閉じるだけ、別カードなら開く
    if (!isOpen) card.setAttribute('aria-expanded', 'true');
  });

  // ── Step 2: 口座選択 ──
  overlay.addEventListener('click', e => {
    const chip = e.target.closest('.ob-chip');
    if (!chip) return;
    const idx = chip.dataset.idx;
    if (selected.has(idx)) {
      selected.delete(idx);
      chip.classList.remove('selected');
    } else {
      selected.add(idx);
      chip.classList.add('selected');
    }
    const btn = overlay.querySelector('#ob-next-2');
    if (btn) {
      btn.disabled = selected.size === 0;
      btn.textContent = selected.size > 0 ? (selected.size + '件で次へ') : '選択してください';
    }
  });

  overlay.querySelector('#ob-next-2')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#ob-next-2');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await ensureTeam();
      const toCreate = [...selected].map(idx => ACCOUNT_PRESETS[parseInt(idx)]);
      // Promise.all の並列実行によるRLS競合を避けるため直列で実行
      createdAccounts = [];
      for (let i = 0; i < toCreate.length; i++) {
        const p = toCreate[i];
        btn.textContent = '保存中… ' + (i + 1) + ' / ' + toCreate.length;
        const account = await DB.createAccount({
          name: p.name, type: p.type, icon: p.icon, color: p.color,
          balance: 0, sort_order: i
        });
        createdAccounts.push(account);
      }
      // Step3: 口座セレクトを動的に埋める
      _populateAccountSelect(overlay, createdAccounts);
      goTo(3);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = selected.size + '件で次へ';
      console.error('[onboarding] createAccount error:', e);
      const msg = e.message || '';
      const isAuth = msg.includes('JWT') || msg.includes('auth') || msg.includes('session');
      if (isAuth) {
        alert('ログインセッションが切れました。ページを再読み込みしてもう一度お試しください。');
      } else {
        alert('保存に失敗しました。もう一度タップしてお試しください。');
      }
    }
  });

  overlay.querySelector('#ob-skip-2')?.addEventListener('click', async () => {
    // スキップでも ensureTeam だけはやっておく
    try { await ensureTeam(); } catch (_) {}
    goTo(3);
  });

  // ── Step 3: 初回記録 ──
  // 金額入力: コンマ表示
  const amountInput = overlay.querySelector('#ob-amount');
  amountInput?.addEventListener('focus', () => {
    if (amountInput.value) amountInput.value = amountInput.value.replace(/,/g, '');
  });
  amountInput?.addEventListener('blur', () => {
    const n = parseInt(amountInput.value.replace(/,/g, ''), 10);
    if (!isNaN(n) && n > 0) amountInput.value = n.toLocaleString('ja-JP');
  });

  overlay.querySelector('#ob-next-3')?.addEventListener('click', async () => {
    const rawAmount = parseInt((amountInput?.value || '').replace(/,/g, ''), 10);
    const memo = (overlay.querySelector('#ob-memo')?.value || '').trim();
    const accountId = overlay.querySelector('#ob-account-select')?.value;

    if (!rawAmount || rawAmount <= 0) {
      _shake(overlay.querySelector('#ob-amount'));
      return;
    }
    if (!memo) {
      _shake(overlay.querySelector('#ob-memo'));
      return;
    }

    const btn = overlay.querySelector('#ob-next-3');
    btn.disabled = true;
    btn.textContent = '保存中…';

    try {
      const today = new Date();
      const dateStr = today.getFullYear() + '-'
        + String(today.getMonth() + 1).padStart(2, '0') + '-'
        + String(today.getDate()).padStart(2, '0');
      await DB.createTransaction({
        type: 'expense',
        amount: rawAmount,
        account_id: accountId || null,
        date: dateStr,
        memo,
      });
      // Step4: 招待ステップへ
      _startInviteStep(overlay);
      goTo(4);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '記録して次へ';
      alert('記録の保存に失敗しました: ' + e.message);
    }
  });

  overlay.querySelector('#ob-skip-3')?.addEventListener('click', () => {
    _startInviteStep(overlay);
    goTo(4);
  });

  // ── Step 4: 招待 ──
  overlay.querySelector('#ob-copy-invite')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#ob-copy-invite');
    if (inviteUrl) {
      _copyToClipboard(inviteUrl, btn);
      return;
    }
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const invite = await DB.createInviteForOwnTeam('member');
      inviteUrl = location.origin + '/?invite=' + invite.token;
      _showInviteUrl(overlay, inviteUrl, btn);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '招待リンクを発行する';
      alert('招待リンクの発行に失敗しました');
    }
  });

  overlay.querySelector('#ob-skip-4')?.addEventListener('click', () => goTo(5));
  overlay.querySelector('#ob-next-4')?.addEventListener('click', () => goTo(5));

  // ── Step 5: 完了 ──
  overlay.querySelector('#ob-finish')?.addEventListener('click', () => finish());

  function finish() {
    overlay.classList.remove('visible');
    setTimeout(() => { overlay.remove(); onComplete(); }, 400);
  }
}

// ── ヘルパー ──

function _populateAccountSelect(overlay, accounts) {
  const sel = overlay.querySelector('#ob-account-select');
  if (!sel) return;
  sel.innerHTML = accounts.map(a =>
    '<option value="' + a.id + '">' + a.icon + ' ' + a.name + '</option>'
  ).join('');
  // 口座がないならラベルを「口座なし」に
  if (accounts.length === 0) {
    sel.innerHTML = '<option value="">口座を選択（任意）</option>';
  }
}

function _startInviteStep(overlay) {
  // 既に生成済みなら表示だけ更新
}

function _showInviteUrl(overlay, url, btn) {
  const box = overlay.querySelector('#ob-invite-url-box');
  if (box) {
    box.textContent = url;
    box.style.display = 'block';
  }
  const nextBtn = overlay.querySelector('#ob-next-4');
  if (nextBtn) nextBtn.style.display = 'block';
  btn.textContent = 'コピーしました ✓';
  btn.style.background = 'var(--sage-dk)';
  setTimeout(() => {
    btn.textContent = 'もう一度コピー';
    btn.disabled = false;
    btn.style.background = '';
  }, 2000);
}

function _copyToClipboard(text, btn) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'コピーしました ✓';
      btn.style.background = 'var(--sage-dk)';
      setTimeout(() => {
        btn.textContent = 'もう一度コピー';
        btn.style.background = '';
      }, 2000);
    });
  }
}

function _shake(el) {
  if (!el) return;
  el.classList.add('ob-shake');
  el.focus();
  setTimeout(() => el.classList.remove('ob-shake'), 500);
}

function buildHTML() {
  const chips = ACCOUNT_PRESETS.map((p, i) =>
    '<button class="ob-chip" data-idx="' + i + '">' +
      '<span class="ob-chip-icon">' + p.icon + '</span>' +
      '<span class="ob-chip-name">' + p.name + '</span>' +
    '</button>'
  ).join('');

  return `
    <div class="ob-sheet">

      <div class="ob-progress">
        <div class="ob-progress-fill" style="width:20%"></div>
      </div>

      <!-- Step 1: ウェルカム -->
      <div class="ob-step active" data-step="1">
        <div class="ob-logo">
          <div class="ob-logo-icon">🌿</div>
          <div class="ob-logo-text">Flow<span>ra</span></div>
        </div>
        <h2 class="ob-title">2人のお金を、<br>もっとシンプルに。</h2>
        <p class="ob-desc">夫婦やパートナーと収支を共有して、<br>毎月のお金の流れを一緒に把握できます。</p>
        <div class="ob-feature-list">
          <button class="ob-feature-item" data-feature="0" aria-expanded="false">
            <span class="ob-feature-icon">📊</span>
            <span class="ob-feature-label">収支を記録してグラフで見える化</span>
            <svg class="ob-feature-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            <div class="ob-feature-detail">収入・支出・振替を記録すると、月ごとの収支グラフで傾向が一目でわかります。タグ別の予算管理にも対応しています。</div>
          </button>
          <button class="ob-feature-item" data-feature="1" aria-expanded="false">
            <span class="ob-feature-icon">👥</span>
            <span class="ob-feature-label">パートナーとリアルタイム共有</span>
            <svg class="ob-feature-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            <div class="ob-feature-detail">招待リンクを送るだけで、すぐに共有スタート。どちらが記録してもリアルタイムで反映されるので「知らなかった」がなくなります。</div>
          </button>
          <button class="ob-feature-item" data-feature="2" aria-expanded="false">
            <span class="ob-feature-icon">🏷️</span>
            <span class="ob-feature-label">タグで支出カテゴリを管理</span>
            <svg class="ob-feature-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            <div class="ob-feature-detail">食費・交通・娯楽など自由にカスタマイズできます。タグごとに月予算も設定でき、使いすぎを色でお知らせします。</div>
          </button>
        </div>
        <button class="ob-btn-primary" id="ob-next-1">はじめる</button>
        <p class="ob-step-hint">設定まで2〜3分です</p>
      </div>

      <!-- Step 2: 口座選択 -->
      <div class="ob-step" data-step="2">
        <div class="ob-step-num">STEP 1 / 3</div>
        <h2 class="ob-title">使っている口座を<br>選んでください</h2>
        <p class="ob-desc">あとから追加・編集もできます</p>
        <div class="ob-chips">${chips}</div>
        <button class="ob-btn-primary" id="ob-next-2" disabled>選択してください</button>
        <button class="ob-btn-skip" id="ob-skip-2">スキップ</button>
      </div>

      <!-- Step 3: 初回記録 -->
      <div class="ob-step" data-step="3">
        <div class="ob-step-num">STEP 2 / 3</div>
        <h2 class="ob-title">今日の支出を<br>1件記録してみましょう</h2>
        <p class="ob-desc">実際に入力すると使い方がわかります</p>
        <div class="ob-form">
          <div class="ob-form-row">
            <label class="ob-label">金額</label>
            <div class="ob-amount-wrap">
              <span class="ob-yen">¥</span>
              <input type="number" class="ob-input ob-input-amount" id="ob-amount"
                placeholder="0" inputmode="numeric" min="1">
            </div>
          </div>
          <div class="ob-form-row">
            <label class="ob-label">メモ</label>
            <input type="text" class="ob-input" id="ob-memo"
              placeholder="コンビニ、ランチ、電車代…" maxlength="50">
          </div>
          <div class="ob-form-row">
            <label class="ob-label">口座</label>
            <select class="ob-input ob-select" id="ob-account-select">
              <option value="">あとで設定する</option>
            </select>
          </div>
        </div>
        <button class="ob-btn-primary" id="ob-next-3">記録して次へ</button>
        <button class="ob-btn-skip" id="ob-skip-3">あとで記録する</button>
      </div>

      <!-- Step 4: パートナー招待 -->
      <div class="ob-step" data-step="4">
        <div class="ob-step-num">STEP 3 / 3</div>
        <div class="ob-invite-illust">
          <svg width="96" height="56" viewBox="0 0 96 56" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- 左のアバター -->
            <circle cx="18" cy="18" r="11" fill="#EEF5F1" stroke="#4A7C59" stroke-width="1.8"/>
            <circle cx="18" cy="14" r="4" fill="#4A7C59"/>
            <path d="M9 28c0-5 4-8 9-8s9 3 9 8" stroke="#4A7C59" stroke-width="1.8" stroke-linecap="round"/>
            <!-- 右のアバター -->
            <circle cx="78" cy="18" r="11" fill="#EEF5F1" stroke="#6FA882" stroke-width="1.8"/>
            <circle cx="78" cy="14" r="4" fill="#6FA882"/>
            <path d="M69 28c0-5 4-8 9-8s9 3 9 8" stroke="#6FA882" stroke-width="1.8" stroke-linecap="round"/>
            <!-- 中央の接続矢印 -->
            <line x1="33" y1="18" x2="63" y2="18" stroke="#B0C4BB" stroke-width="1.5" stroke-dasharray="3 3"/>
            <circle cx="48" cy="18" r="6" fill="#4A7C59"/>
            <path d="M45 18h6M51 15l3 3-3 3" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <!-- ラベル -->
            <text x="18" y="48" text-anchor="middle" font-family="'Noto Sans JP',sans-serif" font-size="9" fill="#7A9485">あなた</text>
            <text x="78" y="48" text-anchor="middle" font-family="'Noto Sans JP',sans-serif" font-size="9" fill="#7A9485">パートナー</text>
          </svg>
        </div>
        <h2 class="ob-title">パートナーを<br>招待しましょう</h2>
        <p class="ob-desc">招待リンクを送るだけで、<br>すぐに一緒に使えます。</p>
        <button class="ob-btn-primary" id="ob-copy-invite">招待リンクを発行する</button>
        <div class="ob-invite-url-box" id="ob-invite-url-box" style="display:none"></div>
        <button class="ob-btn-primary ob-btn-next4" id="ob-next-4" style="display:none">次へ</button>
        <button class="ob-btn-skip" id="ob-skip-4">あとで招待する</button>
      </div>

      <!-- Step 5: 完了 -->
      <div class="ob-step" data-step="5">
        <div class="ob-complete-icon">✓</div>
        <h2 class="ob-title">準備完了！</h2>
        <p class="ob-desc">Flowraへようこそ。<br>ホーム画面から収支を確認できます。</p>
        <button class="ob-btn-primary" id="ob-finish">Flowraを使い始める</button>
      </div>

    </div>
  `;
}
