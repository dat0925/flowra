// ─────────────────────────────────────
//  sw.js  Service Worker
//  Network Only：常にネットワークから取得（開発中はキャッシュなし）
// ─────────────────────────────────────

const CACHE_NAME = 'flowra-v309';

// インストール時：即座にアクティベート
self.addEventListener('install', event => {
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを全削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ：Supabaseのみネットワーク、他はNetwork First（フォント含む）
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
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // アプリファイル（JS/CSS/HTML）→ Network Only（常に最新）
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});



