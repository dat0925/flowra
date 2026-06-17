// ─────────────────────────────────────
//  announcements.js  お知らせ機能
//  ヘッダーのベルアイコン＋バッジ＋ログ一覧（Backlogのお知らせ風）
//  既読管理は端末ごとのlocalStorageで行う簡易設計
// ─────────────────────────────────────
import { supabase } from './config.js';
import { Sound } from './sound.js';

const LAST_SEEN_KEY = 'flowra_announce_last_seen';
const PAGE_SIZE = 20; // 1回の取得件数（「もっと見る」で追加読み込み）

export const Announcements = {

  // お知らせ一覧をページ単位で取得（新しい順）。offsetは0始まり。
  async listPage(offset = 0) {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, body, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error('お知らせ取得エラー:', error); return []; }
    return data || [];
  },

  getLastSeenAt() {
    return localStorage.getItem(LAST_SEEN_KEY);
  },

  setLastSeenAt(iso) {
    try { localStorage.setItem(LAST_SEEN_KEY, iso); } catch {}
  },

  // 未読件数を計算（lastSeenより新しいものをカウント。未取得なら全件未読扱い）
  // バッジは最大9+でまとめて表示するため、直近1ページ分のチェックで十分。
  async getUnreadCount() {
    const items = await this.listPage(0);
    if (items.length === 0) return 0;
    const lastSeen = this.getLastSeenAt();
    if (!lastSeen) return items.length;
    return items.filter(a => new Date(a.created_at) > new Date(lastSeen)).length;
  },

  // ヘッダーのバッジ表示を更新（モバイル・デスクトップ両方）
  async refreshBadge() {
    const count = await this.getUnreadCount();
    document.querySelectorAll('.announce-badge').forEach(el => {
      if (count > 0) {
        el.textContent = count > 9 ? '9+' : String(count);
        el.style.display = 'flex';
      } else {
        el.style.display = 'none';
      }
    });
  },

  // お知らせ一覧パネルを開く（開いた時点で既読にする）
  async openPanel() {
    Sound.playOpen();

    document.getElementById('announce-panel')?.remove();
    if (!document.getElementById('announce-panel-style')) {
      const s = document.createElement('style');
      s.id = 'announce-panel-style';
      s.textContent = '@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}';
      document.head.appendChild(s);
    }

    const panel = document.createElement('div');
    panel.id = 'announce-panel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:600;background:var(--stone);display:flex;flex-direction:column;animation:slideInRight 0.25s ease;';
    panel.innerHTML =
      '<div style="flex-shrink:0;padding:14px 16px 12px;border-bottom:1px solid var(--border);background:var(--stone);text-align:center;">'
      + '<span style="font-size:16px;font-weight:600;color:var(--ink);">お知らせ</span>'
      + '</div>'
      + '<div id="announce-list" style="flex:1;overflow-y:auto;padding:8px 16px;"><div class="spinner" style="margin:40px auto;"></div></div>'
      + '<div style="flex-shrink:0;padding:10px 16px;padding-bottom:calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--border);background:var(--stone);">'
      + '<button id="btn-announce-back" style="width:100%;padding:12px;background:none;border:1.5px solid var(--border);border-radius:12px;font-size:14px;color:var(--mid);cursor:pointer;">← 戻る</button>'
      + '</div>';
    document.body.appendChild(panel);

    const close = () => {
      Sound.playClose();
      panel.style.transform = 'translateX(100%)';
      panel.style.transition = 'transform 0.2s ease';
      setTimeout(() => panel.remove(), 200);
    };
    document.getElementById('btn-announce-back').addEventListener('click', close);

    // 右スワイプで閉じる（他のサブページと挙動を揃える）
    let startX = 0, startY = 0, swiping = false;
    panel.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; swiping = false;
    }, { passive: true });
    panel.addEventListener('touchmove', e => {
      const dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (!swiping && dx > 10 && dy < dx * 0.8) swiping = true;
      if (swiping) { panel.style.transform = 'translateX(' + Math.max(0, dx) + 'px)'; panel.style.transition = 'none'; }
    }, { passive: true });
    panel.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      if (swiping && dx > window.innerWidth * 0.35) close();
      else { panel.style.transform = ''; panel.style.transition = 'transform 0.2s ease'; }
    }, { passive: true });

    const listEl = document.getElementById('announce-list');
    let offset = 0;
    let markedRead = false;

    const renderItem = a => {
      const d = new Date(a.created_at);
      const dateStr = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
      return '<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;">'
        + '<div style="font-size:11px;color:var(--mid-lt);margin-bottom:4px;">' + dateStr + '</div>'
        + '<div style="font-size:14px;font-weight:600;color:var(--ink);margin-bottom:6px;">' + escapeHtml(a.title) + '</div>'
        + '<div style="font-size:13px;color:var(--mid);white-space:pre-wrap;line-height:1.6;">' + escapeHtml(a.body) + '</div>'
        + '</div>';
    };

    const loadMore = async () => {
      const items = await this.listPage(offset);
      if (!document.getElementById('announce-list')) return; // パネルが既に閉じられていた場合

      document.getElementById('announce-more-wrap')?.remove();

      if (offset === 0 && items.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--mid-lt);font-size:13px;padding:40px 0;">お知らせはまだありません</div>';
        return;
      }
      if (offset === 0) listEl.innerHTML = '';

      listEl.insertAdjacentHTML('beforeend', items.map(renderItem).join(''));

      // 最初の1件目（一番新しいお知らせ）を既読として保存し、バッジを消す
      if (!markedRead && items.length > 0) {
        markedRead = true;
        this.setLastSeenAt(items[0].created_at);
        this.refreshBadge();
      }

      offset += items.length;

      // 取得件数がPAGE_SIZEちょうど＝まだ続きがある可能性が高い→もっと見るボタンを表示
      if (items.length === PAGE_SIZE) {
        const moreWrap = document.createElement('div');
        moreWrap.id = 'announce-more-wrap';
        moreWrap.style.cssText = 'text-align:center;padding:8px 0 16px;';
        moreWrap.innerHTML = '<button id="btn-announce-more" style="padding:8px 20px;background:none;border:1.5px solid var(--border);border-radius:20px;font-size:13px;color:var(--mid);cursor:pointer;">もっと見る</button>';
        listEl.appendChild(moreWrap);
        document.getElementById('btn-announce-more').addEventListener('click', () => {
          document.getElementById('btn-announce-more').textContent = '読み込み中...';
          loadMore();
        });
      }
    };

    await loadMore();
  },
};

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
