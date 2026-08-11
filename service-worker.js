// キャッシュを完全に無効化し、常に最新のネットワークデータを取得するサービスワーカー (デバッグ・同期不良解消用)
const CACHE_NAME = 'study-manager-cache-v3';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        console.log('[Service Worker] Forcing deletion of cache:', key);
        return caches.delete(key);
      }));
    }).then(() => self.clients.claim())
  );
});

// フェッチ時はキャッシュを完全にバイパスし、常にネットワークへ直接接続する
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
