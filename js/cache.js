// ─────────────────────────────────────
//  cache.js  IndexedDB ローカルキャッシュ
//
//  思想：
//  ・起動時は IndexedDB から即表示（ネットワーク待ちゼロ）
//  ・バックグラウンドで Supabase の差分（updated_at > 最終同期）を取得
//  ・差分だけ IndexedDB に反映 → 画面を静かに更新
// ─────────────────────────────────────

const DB_NAME    = 'flowra-cache';
const DB_VERSION = 1;
const STORES = {
  transactions: 'transactions',
  accounts:     'accounts',
  tags:         'tags',
  meta:         'meta',          // 最終同期時刻などを保存
};

let _db = null;

// IndexedDB を開く
async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      // transactions: id をキー、team_id + date でインデックス
      if (!db.objectStoreNames.contains(STORES.transactions)) {
        const ts = db.createObjectStore(STORES.transactions, { keyPath: 'id' });
        ts.createIndex('team_date', ['team_id', 'date'], { unique: false });
        ts.createIndex('updated_at', 'updated_at', { unique: false });
      }
      // accounts
      if (!db.objectStoreNames.contains(STORES.accounts)) {
        db.createObjectStore(STORES.accounts, { keyPath: 'id' });
      }
      // tags
      if (!db.objectStoreNames.contains(STORES.tags)) {
        db.createObjectStore(STORES.tags, { keyPath: 'id' });
      }
      // meta
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };

    req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
    req.onerror    = e => reject(e.target.error);
  });
}

// ── 汎用ヘルパー ──────────────────────

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function promisify(req) {
  return new Promise((res, rej) => {
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// ── メタ（最終同期時刻）────────────────

export async function getLastSync() {
  await openDB();
  try {
    const row = await promisify(tx(STORES.meta).get('lastSync'));
    return row?.value || null;
  } catch { return null; }
}

export async function setLastSync(isoString) {
  await openDB();
  const store = _db.transaction(STORES.meta, 'readwrite').objectStore(STORES.meta);
  await promisify(store.put({ key: 'lastSync', value: isoString }));
}

// ── accounts ────────────────────────

export async function getCachedAccounts() {
  await openDB();
  const accounts = await promisify(tx(STORES.accounts).getAll());
  return accounts
    .filter(a => !a.is_archived)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export async function putAccounts(accounts) {
  await openDB();
  const store = _db.transaction(STORES.accounts, 'readwrite').objectStore(STORES.accounts);
  // 既存を全クリアしてから書き直す（削除済み口座の残留防止）
  await promisify(store.clear());
  await Promise.all(accounts.map(a => promisify(store.put(a))));
}

// 削除済み口座をキャッシュから除去
export async function removeAccount(id) {
  await openDB();
  const store = _db.transaction(STORES.accounts, 'readwrite').objectStore(STORES.accounts);
  await promisify(store.delete(id));
}

// ── tags ────────────────────────────

export async function getCachedTags() {
  await openDB();
  return promisify(tx(STORES.tags).getAll());
}

export async function putTags(tags) {
  await openDB();
  const store = _db.transaction(STORES.tags, 'readwrite').objectStore(STORES.tags);
  await Promise.all(tags.map(t => promisify(store.put(t))));
}

// ── transactions ────────────────────

// 月フィルタ付きで取得
export async function getCachedTransactions({ year, month } = {}) {
  await openDB();
  const all = await promisify(tx(STORES.transactions).getAll());

  let rows = all.filter(t => !t._deleted);

  if (year && month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const to   = `${year}-${String(month).padStart(2,'0')}-${String(new Date(year, month, 0).getDate()).padStart(2,'0')}`;
    rows = rows.filter(t => t.date >= from && t.date <= to);
  }

  // 日付降順
  return rows.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return b.created_at?.localeCompare(a.created_at || '') || 0;
  });
}

// 差分をマージ（upsert）
// 注意: putのみ行うため、サーバー側で削除済みの行はこれだけでは
// キャッシュから消えずに残り続ける（「ゴースト」化）。特定月の
// 全件取得結果を保存する場合は replaceMonthTransactions を使うこと。
export async function upsertTransactions(rows) {
  if (!rows || rows.length === 0) return;
  await openDB();
  const store = _db.transaction(STORES.transactions, 'readwrite').objectStore(STORES.transactions);
  await Promise.all(rows.map(r => promisify(store.put(r))));
}

// 指定月の「正解データ」で丸ごと置き換える（ゴースト残留防止）
// サーバーから取得した当月の全件（rows）と、キャッシュ上の当月データを突き合わせ、
// サーバー側にもう存在しないID（削除済み等）をキャッシュから物理削除してから rows を書き込む。
// putAccounts が口座に対してやっている「clear→書き直し」と同じ思想を、月単位に絞って行う。
export async function replaceMonthTransactions(year, month, rows) {
  await openDB();
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const to   = `${year}-${String(month).padStart(2,'0')}-${String(new Date(year, month, 0).getDate()).padStart(2,'0')}`;

  const store = _db.transaction(STORES.transactions, 'readwrite').objectStore(STORES.transactions);
  const all = await promisify(store.getAll());
  const freshIds = new Set((rows || []).map(r => r.id));

  const staleIds = all
    .filter(t => t.date >= from && t.date <= to && !freshIds.has(t.id))
    .map(t => t.id);

  await Promise.all(staleIds.map(id => promisify(store.delete(id))));
  await Promise.all((rows || []).map(r => promisify(store.put(r))));
}

// 削除フラグ付きでマーク（実データは残す）
export async function markDeletedTransaction(id) {
  await openDB();
  const store = _db.transaction(STORES.transactions, 'readwrite').objectStore(STORES.transactions);
  const row = await promisify(store.get(id));
  if (row) await promisify(store.put({ ...row, _deleted: true }));
}

// キャッシュ全消去（ログアウト時など）
export async function clearAll() {
  await openDB();
  const names = Object.values(STORES);
  for (const name of names) {
    const store = _db.transaction(name, 'readwrite').objectStore(name);
    await promisify(store.clear());
  }
}
