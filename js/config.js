// ─────────────────────────────────────
//  config.js  Supabase クライアント設定
// ─────────────────────────────────────
const SUPABASE_URL      = 'https://copyzpsyagscqrvkrwjo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvcHl6cHN5YWdzY3Fydmtyd2pvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTI4NTEsImV4cCI6MjA5NTE4ODg1MX0.4g0Rzo4TyM0NPWF53swUWhLD4nDYMSOD7KB9ZBW80Kc';

// ===== メンテナンス表示 =====
// 2026-09-29 に Supabase の無料枠（org 単位の Egress）を超過し、API が 402 を返して全停止した。
// Supabase への通信をすべてここで受け、サーバー側が止まっているときは画面上部に帯を出す。
//  - 402（プランの利用枠超過で Supabase が制限中）… 1回で表示。復旧見込み日時も出す
//  - 5xx / Cloudflare 52x / 接続失敗（522 は CORS ヘッダが無く fetch 自体が失敗する）… 2回続いたら表示
// 表示中は60秒ごとに疎通を確かめ、戻ったら再読み込みする（入力中なら「再読み込み」ボタンを出して待つ）。
// 同じ仕組みを Taskra / Flowra / Tavera に入れている。
const createMaintFetch = (supabaseUrl, anonKey) => {
  const FAIL_TO_SHOW = 2;
  // 請求サイクルの切り替え日。通知メール「quota refills during September 29, 2026」より毎月29日。
  // プランや請求日が変わったらここを直す。
  const CYCLE_DAY = 29;
  let fails = 0, timer = null, state = null; // null | 'quota' | 'down'
  let probe, wrapped;

  const refillText = () => {
    // 切り替えは UTC の CYCLE_DAY 日のうちに行われ、遅くとも翌日 0:00 UTC（日本時間 9:00）には戻る。
    // 日本時間の暦で判定すると、日本時間で翌日になった時点（まだ UTC では切り替え日）に
    // 「今月分は過ぎた」と誤って翌月を出す（2026-09-30 に「10月29日」と表示された）。境界は UTC で計算する。
    const now = Date.now();
    const dayOf = (yy, mm) => Math.min(CYCLE_DAY, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()); // 2月対策
    const edge = (yy, mm) => Date.UTC(yy, mm, dayOf(yy, mm) + 1); // 切り替え日の翌日 0:00 UTC
    const u = new Date(now);
    let y = u.getUTCFullYear(), m = u.getUTCMonth();
    let t = edge(y, m);
    if (now >= t) {
      // 境界を過ぎても止まっているのは切り替え処理の遅れ。翌月の日付を出すと誤案内になるので3日間は「まもなく」
      if (now - t < 3 * 86400000) return 'まもなく';
      m++; if (m > 11) { m = 0; y++; }
      t = edge(y, m);
    }
    const j = new Date(t + 9 * 3600000);
    const w = '日月火水木金土'[j.getUTCDay()];
    return (j.getUTCMonth() + 1) + '月' + j.getUTCDate() + '日（' + w + '）' + String(j.getUTCHours()).padStart(2, '0') + ':00';
  };

  const banner = () => {
    let el = document.getElementById('maintBanner');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'maintBanner';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:100000;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;background:#FFF4D6;color:#5A4300;border-bottom:1px solid #E8C766;font-size:13px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,.12)';
      document.body.appendChild(el);
    }
    return el;
  };

  const render = () => {
    const el = banner();
    // <head> で読み込むページは body ができる前に応答が返ることがあるので、できてから描き直す
    if (!el) { document.addEventListener('DOMContentLoaded', render, { once: true }); return; }
    if (!state) { el.hidden = true; return; }
    el.innerHTML = state === 'quota'
      ? '<b>メンテナンス中です</b><br>ご迷惑をおかけして大変申し訳ありません。一時的に接続が止まっており、復旧までデータの表示・保存ができません。<br><b>復旧見込み: ' + refillText() + '</b><br>この間に入力した内容は保存されない可能性があるので、復旧まで編集は控えてください。復旧すると自動で再読み込みします。'
      : '<b>サーバーに接続できません（メンテナンス中の可能性があります）</b><br>しばらくすると自動で再接続します。この間の変更は保存されない可能性があります。';
    el.hidden = false;
  };

  probe = () => {
    if (document.visibilityState !== 'visible') return;
    wrapped(supabaseUrl + '/auth/v1/health', { headers: { apikey: anonKey } }).catch(() => {});
  };

  const set = kind => {
    if (state === 'quota' && kind === 'down') return; // 402 の表示は 5xx で弱めない
    if (state === kind) return;
    state = kind;
    render();
    if (!timer) timer = setInterval(probe, 60000);
  };

  const recovered = () => {
    const el = banner();
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    if (!typing || !el) { location.reload(); return; }
    // 入力途中の内容を消さないよう、再読み込みは本人に押してもらう
    el.innerHTML = '<b>復旧しました</b>　<button type="button" style="margin-left:8px;padding:4px 12px;border:1px solid #B8962E;border-radius:6px;background:#fff;color:#5A4300;font-size:13px;cursor:pointer">再読み込み</button>';
    el.querySelector('button').onclick = () => location.reload();
    el.hidden = false;
  };

  const clear = () => {
    fails = 0;
    if (!state) return;
    state = null;
    if (timer) { clearInterval(timer); timer = null; }
    recovered();
  };

  wrapped = async (input, init) => {
    let res;
    try {
      res = await fetch(input, init);
    } catch (e) {
      // 端末がオフラインなのはサーバーのメンテナンスではないので数えない
      if (navigator.onLine !== false && ++fails >= FAIL_TO_SHOW) set('down');
      throw e;
    }
    if (res.status === 402) {
      set('quota');
      // supabase-js はトークン更新が 402 のような「再試行不能」エラーで失敗するとセッションを消し、
      // 利用者はログアウトされてログイン画面では通信が起きず帯も出ない（Taskra で 2026-09-29 に起きた）。
      // 停止は一時的なので、認証 API の 402 は 503（再試行可能）として渡し、セッションを保ったまま復旧を待たせる。
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/auth/v1/')) return new Response(await res.text(), { status: 503, statusText: 'Service Unavailable', headers: res.headers });
      return res;
    }
    if (res.status >= 500) { if (++fails >= FAIL_TO_SHOW) set('down'); }
    else clear();
    return res;
  };
  // ページ側から「いまメンテナンス中か」を見られるようにしておく
  wrapped.state = () => state;
  // 起動時に1回疎通を確かめる。ログイン画面やキャッシュ表示では Supabase への通信が起きず、
  // 止まっていても帯を出すきっかけが無い（2026-09-30 Flowra で帯が出なかった）。health は数十バイト
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', probe, { once: true });
  else setTimeout(probe, 0);
  return wrapped;
};

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'flowra-auth',
    },
    global: { fetch: createMaintFetch(SUPABASE_URL, SUPABASE_ANON_KEY) },
  }
);
