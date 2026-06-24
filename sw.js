// sw.js - 無効化済み（ループ問題対応）
// activate で clients.claim() を呼び、旧キャッシュSWがあれば即座に置き換える
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
