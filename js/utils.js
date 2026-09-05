// ─────────────────────────────────────
//  utils.js  共通ユーティリティ
// ─────────────────────────────────────
import { Sound } from './sound.js';

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

export function openModal(contentHTML) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = contentHTML;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  Sound.playOpen();

  // 下スワイプでの誤クローズ防止:
  // このシートは記録追加・複製・口座編集など入力フォームを表示する共通コンポーネントで、
  // 途中で下スワイプすると未保存のまま閉じてしまっていたため、スワイプでは閉じない。
  // 閉じるのは×ボタン／キャンセルなど明示的な操作のみとする。
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const sheet = document.getElementById('modal-add-record');
  // save-barを非表示
  const saveBar = document.getElementById('save-bar');
  if (saveBar) saveBar.hidden = true;
  Sound.playClose();

  const forceClose = () => {
    if (overlay.hidden) return; // 既に閉じていれば何もしない
    if (sheet) sheet.classList.remove('closing');
    overlay.hidden = true;
    document.body.style.overflow = '';
  };

  if (sheet) {
    sheet.classList.add('closing');
    // animationend が発火しない場合に備えてフォールバックタイマーを設定
    const fallbackTimer = setTimeout(forceClose, 400);
    sheet.addEventListener('animationend', () => {
      clearTimeout(fallbackTimer);
      forceClose();
    }, { once: true });
  } else {
    forceClose();
  }
}

// ─────────────────────────────────────
//  メモ欄（新規・複製・編集で共通）
//  改行を扱える textarea + URLリンクチップを1か所にまとめ、
//  どの画面から開いても同じ見た目・挙動になるようにしている。
// ─────────────────────────────────────

/** HTML属性・テキストへ値を埋め込むときのエスケープ */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** メモ入力行のHTML（#memo-input / #memo-links を含む） */
export function memoRowHTML(memo) {
  return `
          <div class="form-row no-tap">
            <div class="row-icon" style="background:#F0EDE8;">
              <svg viewBox="0 0 24 24" style="stroke:var(--mid)"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="row-body">
              <div class="row-label">メモ</div>
              <textarea class="text-input" id="memo-input"
                placeholder="メモを入力（任意）"
                rows="1"
                style="resize:none;overflow:hidden;line-height:1.5;padding-top:10px;padding-bottom:10px;"
              >
${escapeHtml(memo)}</textarea>
              <div id="memo-links" style="display:none;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>
            </div>
          </div>`;
}

/**
 * メモ欄の自動高さ調整とURLリンクチップの描画を設定する。
 * @param {HTMLTextAreaElement} memoEl  #memo-input
 * @param {HTMLElement}         linksEl #memo-links
 * @param {(value:string)=>void} onInput 入力のたびに呼ぶコールバック
 * @returns {{refresh:()=>void}} 外部から値を差し替えたときに呼ぶ再描画関数
 */
export function setupMemoField(memoEl, linksEl, onInput) {
  if (!memoEl) return { refresh: () => {} };

  // 行数に合わせて高さを伸縮させる
  const autoResize = () => {
    memoEl.style.height = 'auto';
    memoEl.style.height = memoEl.scrollHeight + 'px';
  };

  // メモ内のURLをタップ可能なリンクとして欄の下に表示する。
  // textareaは編集領域なので中の文字を直接リンク化できない（タップでカーソルが入る）ため、
  // URLを抽出して別途リンクチップを描画する方式にしている。
  const renderLinks = () => {
    if (!linksEl) return;
    linksEl.innerHTML = '';
    const matches = (memoEl.value || '').match(/https?:\/\/[^\s<>"'）)」』】、。]+/g) || [];
    const seen = new Set();
    matches.forEach(m => {
      // 末尾に紛れ込みやすい記号を除去
      const url = m.replace(/[.,;:)）」』】]+$/, '');
      if (!url || seen.has(url)) return;
      seen.add(url);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const shown = url.replace(/^https?:\/\//, '');
      a.textContent = '🔗 ' + (shown.length > 36 ? shown.slice(0, 36) + '…' : shown);
      a.style.cssText = 'display:inline-flex;align-items:center;max-width:100%;'
        + 'font-size:12px;color:var(--sage);background:var(--sage-bg);'
        + 'border:1px solid rgba(74,124,89,0.18);border-radius:8px;'
        + 'padding:5px 10px;text-decoration:none;word-break:break-all;line-height:1.3;';
      linksEl.appendChild(a);
    });
    linksEl.style.display = seen.size ? 'flex' : 'none';
  };

  const refresh = () => { autoResize(); renderLinks(); };
  refresh();

  memoEl.addEventListener('input', () => {
    refresh();
    if (onInput) onInput(memoEl.value);
  });

  return { refresh };
}
