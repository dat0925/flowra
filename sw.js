// ─────────────────────────────────────
//  sw.js  Service Worker
//  Network First戦略：常に最新を取得、失敗時のみキャッシュで返す
// ─────────────────────────────────────

const CACHE_NAME = 'flowra-v301';

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
];

// インストール時：シェルアセットをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

// アクティベート時：古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ戦略
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API → ネットワークのみ
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Fonts → キャッシュ優先（フォントは変わらない）
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          const clone = res.clone(); // 先にクローン（非同期then内で clone すると body 消費後になる）
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // アプリシェル（JS/CSS/HTML）→ Network First
  // ネットワーク成功 → キャッシュ更新して返す
  // ネットワーク失敗 → キャッシュで返す（オフライン対応）
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
  }
});

