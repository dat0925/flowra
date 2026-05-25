// ─────────────────────────────────────
//  sw.js  Service Worker
//  JS/CSS/フォントをキャッシュ → 2回目以降の起動を高速化
// ─────────────────────────────────────

const CACHE_NAME = 'flowra-v1';

// キャッシュするアセット（アプリシェル）
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/config.js',
  '/js/db.js',
  '/js/router.js',
  '/js/dashboard.js',
  '/js/add-record.js',
  '/js/accounts.js',
  '/js/records.js',
  '/js/settings.js',
  '/js/sound.js',
  '/js/utils.js',
  '/manifest.json',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600&family=Noto+Serif+JP:wght@400;600&display=swap',
  // Supabase SDK
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// インストール時：シェルアセットをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 失敗しても続行（フォントなど外部リソースが落ちても問題なし）
      return Promise.allSettled(
        SHELL_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// アクティベート時：古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// フェッチ戦略
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API → ネットワーク優先（キャッシュしない）
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Fonts → キャッシュ優先
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // アプリシェル（JS/CSS/HTML）→ キャッシュ優先、なければネットワーク
  // ネットワーク成功時にキャッシュ更新（Stale-While-Revalidate）
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);

        const fetchPromise = fetch(event.request)
          .then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => null);

        // キャッシュがあれば即返す（バックグラウンドで更新）
        return cached || fetchPromise;
      })
    );
  }
});
