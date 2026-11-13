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
  toast.classList.remove('actionable');
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// アクションボタン付きトースト（「元に戻す」など）。
// 通常トーストと同じ #toast 要素を使い回す。
export function showActionToast(msg, { label, onAction, duration = 6000 } = {}) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  toast.appendChild(span);
  if (label) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      clearTimeout(toast._timer);
      toast.classList.remove('show');
      toast.classList.remove('actionable');
      if (onAction) onAction();
    });
    toast.appendChild(btn);
  }
  toast.classList.add('actionable');
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.remove('actionable');
  }, duration);
}

export function openModal(contentHTML) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = contentHTML;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  Sound.playOpen();

  // 下スワイプで閉じる（リスナーは一度だけ登録）
  const sheet = document.getElementById('modal-add-record');
  if (sheet && !sheet._swipeInit) {
    sheet._swipeInit = true;
    let startY = 0;
    let startScrollTop = 0;
    const onTouchStart = (e) => {
      startY = e.touches[0].clientY;
      startScrollTop = sheet.scrollTop;
    };
    const onTouchEnd = (e) => {
      const dy = e.changedTouches[0].clientY - startY;
      // スクロール位置が一番上 かつ 60px以上下スワイプで閉じる
      if (startScrollTop === 0 && dy > 60) {
        closeModal();
      }
    };
    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchend', onTouchEnd, { passive: true });
    // リスナーを保持しておく（将来の削除に備えて）
    sheet._swipeHandlers = { onTouchStart, onTouchEnd };
  }
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const sheet = document.getElementById('modal-add-record');
  if (sheet) sheet._swipeInit = false;
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
//  共通ボトムシート土台（UI洗練9）
//  個別実装が乱立していたピッカー系シートをここへ寄せる。
//  開閉アニメーション・背景クリック・下スワイプ・Esc・背景の
//  スクロール固定を1か所で面倒みる。呼び出し側は title と
//  bodyHTML（スクロール領域の中身）だけを渡す。
// ─────────────────────────────────────

/**
 * @param {Object}   opts
 * @param {string}   [opts.id]       シート識別子（多重表示防止に使う）
 * @param {string}   [opts.title]    見出し
 * @param {string}   opts.bodyHTML   スクロール領域に入れるHTML
 * @param {number}   [opts.zIndex]   重なり（既定 1100: 保存バー1000より前面）
 * @param {Function} [opts.onClose]  閉じ終わった後に呼ばれる
 * @returns {{ el: HTMLElement, close: Function }} el はオーバーレイ要素
 */
export function showSheet({ id = '', title = '', bodyHTML = '', zIndex = 1100, onClose } = {}) {
  if (id) document.getElementById(id)?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ui-sheet-overlay';
  if (id) overlay.id = id;
  overlay.style.zIndex = zIndex;
  overlay.innerHTML = `
    <div class="ui-sheet">
      <div class="modal-handle"></div>
      <div class="ui-sheet-head">
        <div class="ui-sheet-title">${title}</div>
        <button class="ui-sheet-close" aria-label="閉じる">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="ui-sheet-scroll">${bodyHTML}</div>
    </div>`;

  const sheet = overlay.querySelector('.ui-sheet');
  const scroller = overlay.querySelector('.ui-sheet-scroll');
  // 親モーダルが開いている間に出すこともあるため、元の overflow を保存して戻す
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  Sound.playOpen();

  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    Sound.playClose();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      onClose?.();
    };
    sheet.classList.add('closing');
    const fallbackTimer = setTimeout(finish, 400);
    sheet.addEventListener('animationend', () => {
      clearTimeout(fallbackTimer);
      finish();
    }, { once: true });
  }

  overlay.querySelector('.ui-sheet-close')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // 下スワイプで閉じる（openModal と同じ判定: スクロール最上部で 60px 以上）
  let startY = 0;
  let startScrollTop = 0;
  sheet.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    startScrollTop = scroller.scrollTop;
  }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - startY;
    if (startScrollTop === 0 && dy > 60) close();
  }, { passive: true });

  document.body.appendChild(overlay);
  return { el: overlay, close };
}

// ─────────────────────────────────────
//  共通ダイアログ土台（UI洗練9-2）
//  z-index 9000 のブラー背景オーバーレイで出る確認・招待系
//  ダイアログ（設定と招待フローに個別実装が5か所あった）を寄せる。
//  土台が面倒を見るのはオーバーレイの生成とフェードイン/アウトだけ。
//  パネルの中身は呼び出し側が html で渡す。判断を仰ぐダイアログなので
//  背景クリック・Esc では閉じない、サウンドも鳴らさない（従来どおり）。
// ─────────────────────────────────────

/**
 * @param {Object}   opts
 * @param {string}   opts.html       パネルのHTML
 * @param {number}   [opts.zIndex]   重なり（既定 9000）
 * @param {Function} [opts.onClose]  閉じ終わった後に呼ばれる
 * @returns {{ el: HTMLElement, close: Function }} el はオーバーレイ要素
 */
export function showDialog({ html = '', zIndex = 9000, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-dialog-overlay';
  overlay.style.zIndex = zIndex;
  overlay.innerHTML = html;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.classList.remove('open');
    setTimeout(() => {
      overlay.remove();
      onClose?.();
    }, 300);
  }
  return { el: overlay, close };
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
