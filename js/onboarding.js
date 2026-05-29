// ─────────────────────────────────────
//  onboarding.js  初回オンボーディング
//  口座が0件の新規ユーザーにのみ表示
// ─────────────────────────────────────
import { DB } from './db.js';

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

function showOnboarding(onComplete) {
  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.innerHTML = buildHTML();
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('visible'));

  let step = 1;
  const selected = new Set();

  function goTo(n) {
    const current = overlay.querySelector(`[data-step="${step}"]`);
    const next    = overlay.querySelector(`[data-step="${n}"]`);
    if (!next) return;
    current?.classList.remove('active');
    next.classList.add('active');
    step = n;
    updateDots(step);
  }

  function updateDots(n) {
    overlay.querySelectorAll('.ob-dot').forEach((d, i) => {
      d.classList.toggle('active', i + 1 === n);
    });
  }

  overlay.querySelector('#ob-next-1')?.addEventListener('click', () => goTo(2));

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
    btn.disabled = selected.size === 0;
    btn.textContent = selected.size > 0 ? `${selected.size}件追加して始める` : '選択してください';
  });

  overlay.querySelector('#ob-next-2')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#ob-next-2');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const toCreate = [...selected].map(idx => ACCOUNT_PRESETS[parseInt(idx)]);
      await Promise.all(
        toCreate.map((p, i) =>
          DB.createAccount({ name: p.name, type: p.type, icon: p.icon, color: p.color, balance: 0, sort_order: i })
        )
      );
      goTo(3);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = `${selected.size}件追加して始める`;
      alert('保存に失敗しました: ' + e.message);
    }
  });

  overlay.querySelector('#ob-skip')?.addEventListener('click', () => finish());
  overlay.querySelector('#ob-finish')?.addEventListener('click', () => finish());

  function finish() {
    overlay.classList.remove('visible');
    setTimeout(() => { overlay.remove(); onComplete(); }, 400);
  }
}

function buildHTML() {
  const chips = ACCOUNT_PRESETS.map((p, i) => `
    <button class="ob-chip" data-idx="${i}">
      <span class="ob-chip-icon">${p.icon}</span>
      <span class="ob-chip-name">${p.name}</span>
    </button>
  `).join('');

  return `
    <div class="ob-sheet">
      <div class="ob-dots">
        <div class="ob-dot active"></div>
        <div class="ob-dot"></div>
        <div class="ob-dot"></div>
      </div>

      <div class="ob-step active" data-step="1">
        <div class="ob-logo">
          <div class="ob-logo-icon">🌿</div>
          <div class="ob-logo-text">Flow<span>ra</span></div>
        </div>
        <h2 class="ob-title">お金の流れが、<br>静かに見える。</h2>
        <p class="ob-desc">収支を記録して、毎月のお金の動きを<br>シンプルに把握できるアプリです。<br>まず使う口座を登録しましょう。</p>
        <button class="ob-btn-primary" id="ob-next-1">はじめる</button>
      </div>

      <div class="ob-step" data-step="2">
        <h2 class="ob-title">使っている口座を<br>選んでください</h2>
        <p class="ob-desc">あとから追加・編集もできます</p>
        <div class="ob-chips">${chips}</div>
        <button class="ob-btn-primary" id="ob-next-2" disabled>選択してください</button>
        <button class="ob-btn-skip" id="ob-skip">スキップ</button>
      </div>

      <div class="ob-step" data-step="3">
        <div class="ob-complete-icon">✓</div>
        <h2 class="ob-title">準備完了！</h2>
        <p class="ob-desc">さっそく今日の支出を<br>記録してみましょう</p>
        <button class="ob-btn-primary" id="ob-finish">記録を始める</button>
      </div>
    </div>
  `;
}
