# Flowra 引き継ぎドキュメント

最終更新: 2026-06-02

---

## プロジェクト概要

**Flowra** は夫婦・パートナー間での家計管理を想定したPWAアプリです。

- **URL**: https://flowra.taskra.jp
- **リポジトリ**: https://github.com/dat0925/flowra
- **Supabaseプロジェクト**: `copyzpsyagscqrvkrwjo`（他アプリ（MIRRA）のテーブルが混在しているが、RLSで分離済み。将来的には分離推奨）

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| フロントエンド | Vanilla JS（ESモジュール）+ HTML/CSS |
| バックエンド | Supabase（PostgreSQL + Auth + RLS） |
| 認証 | Google OAuth（Supabase Auth） |
| ホスティング | GitHub Pages（`dat0925.github.io/flowra` → カスタムドメイン） |
| PWA | manifest.json + Service Worker（sw.js） |

---

## ファイル構成

```
flowra/
├── index.html          # メインHTML（単一ページ）
├── manifest.json       # PWA設定（theme-color: #1C2B22）
├── sw.js               # Service Worker
├── css/
│   └── style.css       # 全スタイル（CSS変数でテーマ管理）
└── js/
    ├── app.js          # エントリポイント・ルーティング・共有UI
    ├── db.js           # Supabase全操作（唯一のDB層）
    ├── auth.js         # 認証処理
    ├── cache.js        # IndexedDB キャッシュ層
    ├── router.js       # ページルーター・月カルーセル・月ピッカー
    ├── dashboard.js    # ホーム画面
    ├── records.js      # 記録一覧
    ├── add-record.js   # 記録追加モーダル
    ├── edit-record.js  # 記録編集
    ├── accounts.js     # 口座管理
    ├── settings.js     # 設定画面
    ├── import-notion.js # Notionインポート
    ├── tag-icons.js    # タグアイコン定義（ICON_REGISTRY 20種・resolveTagIcon）
    ├── onboarding.js   # 初回オンボーディング
    ├── sound.js        # 操作音
    ├── utils.js        # 共通ユーティリティ（openModal/closeModal等）
    └── config.js       # Supabaseクライアント初期化
```

---

## Supabaseテーブル構成

### `teams`
チーム（ユーザーごとに自動作成）
- `id`, `name`, `created_at`

### `team_members`
チームのメンバーシップ
- `team_id`, `user_id`, `role`（owner/member/viewer）, `joined_at`
- **注意**: `id`カラムは存在しない。主キーは`(team_id, user_id)`

### `team_invites`
招待トークン管理
- `id`, `team_id`, `token`, `role`, `created_by`, `created_at`, `expires_at`, `used_at`, `used_by`
- トークンは7日間有効

### `accounts`
口座情報
- `id`, `team_id`, `name`, `type`, `icon`, `color`, `balance`, `sort_order`, `is_archived`, `notes`, `is_private`, `created_by`
- `sort_order` で並び順を管理（口座管理画面の↑↓ボタンで変更可能）
- `notes`: メモ欄（200文字制限）。URLを含む場合は編集画面でリンク表示
- `is_private`: trueの場合 `created_by` 本人のみ参照可能。記録ありの場合は公開→非公開への変更を禁止
- `created_by`: 作成者のuuid。RLSで `is_private=true AND created_by != auth.uid()` の口座を非表示

### `transactions`
収支記録
- `id`, `team_id`, `type`（income/expense/transfer）, `amount`, `account_id`, `to_account_id`, `date`, `memo`, `created_by`, `updated_by`, `created_at`
- **重要**: `amount` に `CHECK (amount > 0)` 制約あり。0円レコードは挿入不可

### `transaction_tags`
記録とタグの中間テーブル
- `transaction_id`, `tag_id`
- **注意**: `tag_id` が NULL になるケースがある（タグ削除後の残骸）。コード側で `filter(t => t)` してnullを除外すること

### `tags`
カテゴリタグ
- `id`, `team_id`, `name`, `color`, `icon`, `sort_order`
- `icon`: アイコンキー文字列（`food`, `car`, `medical` など `TAG_ICON_REGISTRY` のキー）。NULLの場合はキーワード自動推定にフォールバック
- ⚠️ SQL実行済み: `ALTER TABLE tags ADD COLUMN icon text;`

### `comments`
記録へのコメント
- `id`, `transaction_id`, `body`, `created_by`, `created_at`

### `budgets`
タグ別予算管理
- `id`, `team_id`, `tag_id`, `month`(text, NULL=毎月デフォルト, 'YYYY-MM'=月別上書き), `amount`, `created_at`
- UNIQUE制約: `(team_id, tag_id, month)`
- `month IS NULL` がデフォルト、`month = 'YYYY-MM'` が月別上書き
- `getBudgets(month)` は両方取得して月別を優先するマップを返す

---

## Supabase関数（SECURITY DEFINER）

| 関数名 | 用途 |
|--------|------|
| `my_team_ids()` | `my_team_id()`（単数・LIMIT 1）でRLS再帰を回避 |
| `my_all_team_ids()` | 複数チーム所属に対応したteam_ids取得 |
| `get_team_member_profiles(p_team_id)` | auth.usersのJOINを回避してメンバー情報を返す |
| `is_team_owner(p_team_id uuid)` | 自分がそのチームのownerかbooleanで返す |

---

## RLSポリシー概要

全テーブルでRLS有効。主なポリシー：

- `accounts`, `tags`, `transactions`, `recurrings`: `my_team_ids()`でチームフィルタ
- `team_members`: `my_all_team_ids()`で全所属チームのメンバーが見える
- `team_invites`: 未使用・期限内のtoken保持者、またはチームメンバーが閲覧可
- `comments`: 自チームのtransactionにのみ書き込み可
- `teams`: `team_owners_can_update_teams`ポリシーで `is_team_owner(id)` のみUPDATE可

---

## チーム・共有の設計

### 基本思想
- ユーザーは必ず自分のチーム（owner）を1つ持つ
- 他人のチームに招待されると2チーム所属になる
- **アクティブチーム**（`localStorage: flowra_active_team_id`）で表示中のデータを切り替える
- デフォルトは自分がownerのチーム

### チーム切り替えUI
- モバイルヘッダーの2行目に表示（複数チーム所属時のみ）
- 1行目: ロゴ + 月ナビ + アバター（常時表示）
- 2行目: `🏠 個人` / `👥 [オーナー名]` のボタン形式

### 設定画面の構成（2セクション構造）
- **パートナー共有**（常時表示）: 自分のチームへの招待リンク発行・メンバー管理・チーム名編集
- **参加中のチーム**（他チームに招待されている場合のみ表示）: オーナー名・権限・脱退ボタン
- この構造により、招待された側でも自分のチームへの招待リンクを発行できる

### チーム名編集
- `renderSettingsContent` に `ownTeamId` を明示的に引数で渡す必要がある
- `getAllTeams()` のJOIN結果 `teams:team_id(id, name)` は配列になることがある。`team.id` ではなく `ownTeamId`（`team_members.team_id`）を使うこと

### 招待リンク発行
- `DB.createInviteForOwnTeam()` を使う（`createInvite()` はアクティブチームに対して発行するため、他チームを閲覧中だと意図しないチームに招待される）

### viewerロール制限
- `+`ボタン（記録追加）を非表示
- 記録タップ時のシートを「閲覧のみ」モードで表示

---

## キャッシュ設計

IndexedDB（`cache.js`）でオフライン対応：

| ストア | 内容 |
|--------|------|
| `accounts` | 口座一覧 |
| `tags` | タグ一覧 |
| `transactions` | トランザクション（月次 + インポート後は全件） |
| `meta` | lastSync などのメタ情報 |

- ログアウト時に`clearAll()`で全消去（別アカウント漏れを防止）
- `localStorage: flowra_active_team_id` もログアウト時にクリア
- 保存時は `tags` を含めてキャッシュに保存すること（`tags: []` で上書きするとタグが消える）

### キャッシュと検索の関係（重要）
- 全期間検索はIndexedDBの全件を参照する（Supabaseを叩かない）
- `syncInBackground` は**当月分しか**Supabaseから取得してIndexedDBに投入しない
- インポート後など全件検索が必要な場合は `DB.fetchAllToCache()` で全件再構築する
- インポート完了後: `clearAll()` → 画面遷移 → バックグラウンドで `fetchAllToCache()` → `setLastSync()`

---

## 月ナビゲーション（router.js）

### 月操作API

| メソッド | 説明 |
|---------|------|
| `MonthState.prev()` | 1ヶ月前へ（emit付き） |
| `MonthState.next()` | 1ヶ月後へ（emit付き） |
| `MonthState.goTo(year, month)` | 指定年月へジャンプ（emit付き） |
| `MonthState.isCurrentMonth()` | 今月かどうかbooleanで返す |
| `Router._jumpToMonth(year, month)` | goTo + ラベル更新 + ページ再描画 |
| `Router._showMonthPicker()` | 年月ピッカーボトムシートを表示 |

### 今月ボタン
- `#btn-today-month`（モバイル）/ `#btn-today-month-d`（デスクトップ）
- 今月以外の月を表示しているときだけ表示（`hidden` 属性で制御）
- `_updateMonthLabels()` 内で `isCurrentMonth()` を見て自動表示/非表示

### 年月ピッカー
- 月ラベル（`#mobile-month-label` / `#desktop-month-label`）をタップすると表示
- 2010年〜翌年まで対応。ボトムシート形式
- 現在月: 緑ベタ塗り。今日の月（現在表示と異なる場合）: アウトライン

---

## 月カルーセル（router.js）

モバイルでの月切り替えをスライドカルーセルで実装。

### 構造
- `#content-carousel`（overflow:hidden ラッパー）の中に ghost パネル → `#page-content` の順でDOM配置
- ghost パネル（`#ghost-prev` / `#ghost-next`）はDOMで `#page-content` より前に挿入（z-index不要）
- ghost の opacity は**JSで完全管理**（CSS側には書かない）。初期値 `opacity:0`

### ghost の opacity 管理ルール
| 状態 | opacity |
|------|---------| 
| 静止時 | `0`（JSで明示） |
| ドラッグ中（アクティブ側） | `0.78` |
| ドラッグ中（非アクティブ側） | `0` |
| commitSlide完了後 | `0` |

### スワイプ判定
- 判定開始: 12px移動後
- 横スワイプ確定条件: `|dx| > |dy| × 2`
- スワイプ有効画面: 記録一覧のみ。`< >` ボタンは全画面で有効

---

## PWA対応メモ

### レイアウト構造（重要）
```css
html, body { height: 100%; overflow: hidden; background: var(--ink); }
#app { display: flex; height: 100dvh; overflow: hidden; }
#main { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: var(--stone); }
/* モバイル */
#app { flex-direction: column; }
#main { height: 100dvh; }
```

- `body` と `html` の背景を `var(--ink)` にすることでボトムナビ下の隙間を視覚的に解消
- **`#main { height: 100dvh }` はモバイルメディアクエリ内に必須。絶対に触らないこと**
- 安定状態のコミット: `3cfd80d`（`css/style.css` / `js/app.js`）

### ボトムナビ
```css
#bottom-nav {
  height: calc(var(--nav-h) + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  position: relative;
  z-index: 2;
}
```
- `position: fixed` にするとフレックス高さ計算が壊れるため使わない

### やってはいけないこと（過去に失敗）
- `overscroll-behavior: none` → フッターが下にずれた
- `window.innerHeight` で `--app-h` をセット → 同上
- `#main { flex: 1 }` → 同上
- ghost opacity をCSSで管理 → JSと競合してアニメーション崩れ

---

## 口座並び替え

- `accounts.js` の↑↓ボタンで `sort_order` を更新
- **重要**: 既存の `sort_order` がバラバラな場合があるため、swap時は全口座を `0,1,2...` に正規化してからswapする

---

## 保存後の楽観的UI（patchAddRecord）

記録保存後、再描画なしでリストの先頭に行を差し込む。

- `tx.tags`（タグオブジェクト配列）を含めて渡すこと
- 保存時に `tags: []` でキャッシュを上書きしない
- 差し込んだ行にクリックイベントを付与すること

---

## Notionインポート設計

### 全体フロー

```
Step1: トークン入力
Step2: Notionスキャン（scanAndCollect）
Step3: プレビュー（差分インポートチェック付き）
Step4: 挿入実行
Step5: 完了（スキップ件数・エラー件数・最古月ジャンプボタン）
```

### 差分インポート機能（2026-06-02追加）

- `DB.getAllTransactionKeys()` で既存レコードのキーセット（`date|amount|type|memo.slice(0,30)`）を取得
- 既存と一致するレコードをスキップして新規分のみ挿入
- 既存データがある場合はプレビュー画面で自動でONになる
- 完了画面にスキップ件数・エラー件数・最古挿入月ジャンプボタンを表示

### インポート後のキャッシュ再構築

```
完了ボタン押下
  → clearAll()（IndexedDB全消去）
  → setLastSync(null)
  → 画面遷移（ユーザーは待たない）
  → バックグラウンドで DB.fetchAllToCache()（全件500件ずつ取得してIndexedDBに投入）
  → setLastSync(now)
```

**この処理がないと全期間検索でインポート済みデータが表示されない。**

### 注意事項

- `transactions.amount` に `CHECK (amount > 0)` 制約あり。**0円レコードはスキップ必須**
  - `scanAndCollect` 内: `if (!日付 || 金額 == null || 金額 === 0) continue;`
- バッチ挿入は1件でも0円があるとバッチ全体（200件）が失敗する
- `importTransactions` は1秒待ってリトライ付き。それでも失敗したバッチは `importErrors` に蓄積され完了画面に表示される
- Notion API 10,000件上限: 年ごとフィルタ分割クエリで回避（2010〜翌年まで1年ずつ）

### アーキテクチャ

```
ブラウザ (import-notion.js)
    ↓ POST {cursor, filter} + x-notion-token ヘッダー
Supabase Edge Function (notion-proxy)   ← CORS プロキシ
    ↓ Bearer token
Notion API  (100件/リクエスト)
```

- Notion DB ID: `1dd85cf70c4c8055949bf3ad4ecf7ef0`
- プロキシURL: `https://copyzpsyagscqrvkrwjo.supabase.co/functions/v1/notion-proxy`
- Notionのプロパティ列: `日付`, `金額`, `分類`(select), `管理`(select), `アカウント`(select), `内容`(rich_text), `支払先`(rich_text), `メモ`(rich_text)
- `管理 === '除外'` または `分類 === '除外'` の行はスキップ

---

## db.js 主要メソッド一覧

| メソッド | 説明 |
|---------|------|
| `getTransactions({year, month, page, pageSize})` | 月次トランザクション取得（タグ・口座JOIN済み） |
| `getDelta(since)` | lastSync以降の差分取得 |
| `importTransactions(rows, progressCallback)` | バッチ挿入（200件/回・リトライ付き） |
| `bulkInsertTransactionTags(tagRows, progressCallback)` | タグ紐付けバッチ挿入（500件/回） |
| `getAllTransactionKeys()` | 差分インポート用キーセット取得（全件） |
| `fetchAllToCache(onProgress)` | 全件IndexedDB再構築（インポート後に使用） |
| `getBudgets(month)` | 予算取得（デフォルト＋月別マージ済み `{tag_id: budget}` マップ） |
| `upsertBudget(tagId, amount, month)` | 予算保存（amount=0で削除、month=nullでデフォルト） |
| `getTransactionCountForAccount(id)` | 口座の取引件数（非公開切り替え可否判定用） |
| `searchTransactions(keyword, type)` | Supabase直接キーワード検索（memo/タグ名/口座名OR・最大500件） |

---

## バグ修正の鉄則

**null参照でクラッシュするとき:**
- `tx.tags[0].name` → `tx.tags.find(t => t)?.name` に変える
- `(tx.tags || []).filter(t => t)` で必ずnull除外してから`.map()`

**スピナーが止まらないとき:**
- `syncInBackground` の catch でエラーが握り潰されていないか確認
- エラーを画面に表示する（`err-detail` パターン）

**記録タップが一部だけ無反応なとき:**
- キャッシュとSupabaseの件数比較だけでは差分検知漏れが起きる → IDセット比較で確実に
- イベントリスナーの重複登録を疑う → `data-*-bound` パターンで1回限り登録

**検索結果が不正確なとき:**
- IndexedDBのキャッシュ未完成が原因の場合はSupabase直接検索に切り替える
- 当月表示: IndexedDB（高速）、全期間検索: Supabase直接（正確）の役割分担を維持

**Supabase RLS「静かな失敗」:**
```js
const { data, error } = await supabase.from('table').update(x).eq('id', id).select();
if (error) throw error;
if (!data || data.length === 0) throw new Error('更新が拒否されました（RLS）');
```

**git bisectパターン:**
```
git log --oneline
git show <hash>:path/to/file.css
```

**テンプレートリテラルのネスト（絶対禁止）:**
```js
// NG: ブラウザによっては動作しない
html = `<div>${condition ? `<span>${val}</span>` : `<span>none</span>`}</div>`

// OK: 変数に切り出してから挿入
const inner = condition ? '<span>' + val + '</span>' : '<span>none</span>';
html = `<div>${inner}</div>`;
```
pushする前に必ず `node --input-type=module < file.js` で構文チェックすること。

---

## SupabaseのRLS「静かな失敗」パターン

**重要**: SupabaseはRLSで更新が弾かれても`error`を返さず、`data: []`を返す。

- `IN (SELECT ...)` はポリシー式に使えない → `SECURITY DEFINER`関数で回避
- `my_all_team_ids()` はSELECTポリシーに直接使えない場合がある

---

## 既知の未完了タスク

### ✅ 完了済み
- チーム名変更後のUI反映（2026-05-30）
- タグの並び替え（2026-06-02）
- Notionインポート（3万件・差分インポート対応）（2026-06-01〜02）
- 検索機能強化（全期間・タグ名対応・Supabase直接検索）
- ホーム画面スピナーが止まらないバグ（2026-06-02）
- 年月ピッカー・今月ボタン（2026-06-02）
- 口座メモ欄（200文字・URL自動リンク）（2026-06-02）
- 口座残高修正UI刷新（現在残高表示・差分フィードバック）（2026-06-02）
- 総残高の表示/非表示切り替え（タップ即切替・総残高カードのみ）（2026-06-02）
- 今月ボタンのレイアウトシフト解消（hidden→disabled+グレーアウト）（2026-06-02）
- 保存/キャンセルボタンの誤タップ防止（gap追加・キャンセル小・保存大）（2026-06-02）
- タグアイコン自動推定（キーワード部分一致）（2026-06-02）
- タグカラー変更機能（設定画面・16色スウォッチ）（2026-06-02）
- ホーム画面・記録一覧のタップ無反応バグ修正（2026-06-02）
- 口座の非公開フラグ（is_private）実装（2026-06-02）
- 予算管理機能（設定画面・ホーム進捗バー・月別上書き）（2026-06-02）
- 記録検索のクリアボタン・件数バッジ（2026-06-02）
- タグアイコン手動設定機能（設定画面・20種類ピッカー・タグ一覧にアイコン表示）（2026-06-02）
- 予算入力コンマ表示（フォーカスで除去・blur時に再フォーマット）（2026-06-02）
- 予算ホーム画面に%表示・2タグ以上で総合計行（2026-06-02）

### 🟢 次フェーズ候補

1. **AIサマリー**（最優先・予算管理完了済み）
   - 「今月どう？」「先月と比べて何が増えた？」「節約できそうなところある？」
   - 3つの問いに絞ったUI（チャット形式ではなくボタン選択式）
   - Flowraのデータ構造（金額・タグ・口座・日付・予算）で答えられる問いのみ対象

2. **月次レポートシェア**
   - html2canvas + Web Share APIで「今月の家計まとめ」を画像化してSNSシェア
   - Flowraロゴ入り → バイラル効果

3. **MIRRAテーブルの削除**
   - Supabaseに別アプリ（MIRRA）のテーブルが混在
   - 対象: `appointments`, `conversations`, `customers`, `karte`, `salons`

---

## 開発メモ

- **Claude Codeより会話型Claudeで開発** - スマホ・iPadのみで開発しているためCLIなし
- PATは都度発行・失効はオーナーが手動で行う（fine-grained PAT推奨）
- Supabaseのスキーマ変更は必ずSQL Editorで実施後にコードを変更する順番で
- `team_members`テーブルは`id`カラムがないので注意（`(team_id, user_id)`で識別）

---

## 変更履歴

### 2026-06-02（タグアイコン・予算UI改善）

- **feat**: タグアイコン手動設定機能（`settings.js` / `add-record.js` / `tag-icons.js`）
  - 新規ファイル `js/tag-icons.js`: `ICON_REGISTRY`（20種）と `resolveTagIcon(tag)` を定義
  - `settings.js`: タグ編集シートにアイコングリッド（5列×4行）を追加。選択中アイコンは緑ハイライト。「自動推定に戻す」ボタンでリセット
  - `settings.js`: タグ一覧にアイコン/色ドットを表示（`TAG_ICON_REGISTRY` をモジュール内に直接定義）
  - `add-record.js`: `tag.icon` キーが設定済みならそちらを優先、未設定はキーワード自動推定にフォールバック
  - 保存時に `DB.updateTag(id, { name, color, icon })` でアイコンキーも更新
  - ⚠️ SQL実行済み: `ALTER TABLE tags ADD COLUMN icon text;`
  - デフォルトアイコンの違和感5箇所を修正: 食費→フォーク＆ナイフ、通信費→電話ハンドセット、保険→十字、税金→ビル、交際費→人々

- **feat**: 予算入力のコンマ表示（`settings.js`）
  - `type="text"` に変更して `toLocaleString()` でコンマ付き表示
  - フォーカス時にコンマ除去、blur時に再フォーマット
  - 月別シートも同様に対応
  - 保存時は `replace(/,/g, '')` でコンマ除去してから `parseInt`

- **feat**: 予算ホーム画面の改善（`dashboard.js`）
  - 各バー右端に `%` テキストを追加（色分け: 80%以上→黄、超過→赤）
  - 2タグ以上のとき総合計バー（予算合計・実績合計・%）を下部に表示
  - `totalBudget` / `totalSpent` を集計して表示

- **fix**: 構文エラーによる起動不能バグを修正（`settings.js`）
  - 原因: テンプレートリテラル内でのネスト（`\`...\${...\`...\`}...\``）がブラウザで動作しない
  - 修正: テンプレートリテラルを文字列連結方式に変更
  - 教訓: **テンプレートリテラルのネストは禁止**。必ず変数に切り出してから挿入すること
  - 教訓: **pushする前に `node --input-type=module < file.js` で構文チェック必須**

### 2026-06-02（セッション最終）

- **feat**: 予算管理機能（`db.js` / `settings.js` / `dashboard.js`）
  - `budgets` テーブル（Supabase）: `team_id`, `tag_id`, `month`(NULL=デフォルト), `amount`
  - `DB.getBudgets(month)`: デフォルト＋月別上書きを解決して `{tag_id: budget}` マップで返す
  - `DB.upsertBudget(tagId, amount, month)`: amount=0で削除、UNIQUE制約でupsert
  - 設定画面: タグ管理の下に「予算管理」セクション。タグ別金額入力＋一括保存。「月別」ボタンで特定月の上書きシート（直近6ヶ月＋翌月）
  - ホーム画面: 予算設定があるタグの進捗バーを `renderContent` 内で描画。80%以上→黄、超過→赤。「設定→」から設定画面へジャンプ
  - ⚠️ SQL実行済み: `CREATE TABLE budgets` + RLSポリシー

- **feat**: 口座の非公開フラグ（`accounts.js` / `db.js`）
  - `accounts` テーブルに `is_private boolean DEFAULT false`, `created_by uuid` を追加
  - 口座作成時に `is_private` トグル＋ `created_by` を自動付与
  - 既存口座編集時: 記録が1件以上あれば公開→非公開の変更を禁止（件数表示）
  - 非公開→公開は常に許可
  - 口座一覧に「非公開」バッジ表示
  - `DB.getTransactionCountForAccount(id)`: 口座の取引件数を取得
  - ⚠️ SQL実行済み: `is_private`/`created_by`カラム追加、RLS更新、`is_accessible_account()` 関数追加

- **feat**: 記録検索のクリアボタン・件数バッジ（`records.js`）
  - 入力があるとき × ボタンが検索ボックス内右端に出現
  - 検索結果件数を緑バッジで検索ボックス右横に表示（`N件`）

- **fix**: 楽観的UI中に編集しようとしたUUIDエラーを防止（`edit-record.js`）
  - 原因: 保存直後（数百ms以内）に編集を開くと `optimistic-` IDがSupabaseに送られUUIDエラー
  - 修正: `openEditRecord` 冒頭でoptimistic-IDを検出し「保存中です」トーストで早期return

- **fix**: `getTransactions` のtagsマッピングに `filter(t => t)` 追加（`db.js`）
  - JOINが空振りしたnullタグが混入するケースの根本対策

- **fix**: `edit-record.js` の `txTags` に `filter(t => t)` 追加
  - タグ削除後の残骸nullで openEditRecord がクラッシュしていた問題を修正

- **fix**: 記録一覧タップをイベントデリゲーション方式に変更（`records.js`）
  - `_allTx` を都度参照することでクロージャの古いfilteredによる無反応バグを根絶

- **fix**: 記録一覧の差分検知をIDセット比較に変更（`records.js`）
  - 件数同一でも新規レコードがある場合に renderShell を再実行するよう修正

### 2026-06-02（セッション後半）

- **fix**: 全期間検索をIndexedDB→Supabase直接に変更（`records.js` / `db.js`）
  - 問題: fetchAllToCacheが完了するまで検索結果が不正確（インデックス中）
  - 根本解決: キーワード検索時はSupabaseを直接叩く。IndexedDBは当月表示専用に整理
  - `DB.searchTransactions(keyword, type)` を新規追加（memo/タグ名/口座名のOR検索・最大500件）

- **fix**: 記録一覧のタップ無反応バグ修正（`records.js`）
  - 原因: needsUpdate判定が件数比較のみ → 新規追加レコードが同件数の場合に検知漏れ
  - 修正: IDセット比較（`freshIds.some(id => !cachedIds.has(id))`）で確実に差分検知

- **fix**: ホーム画面の記録タップ無反応バグ修正（`dashboard.js`）
  - 原因: renderDashboard再描画のたびにclickイベントが重複登録 → 古いclosureのfilteredを参照
  - 修正: `data-click-bound` / `data-toggle-bound` で一度だけ登録する仕組みを追加
  - 別原因: `setupBalanceToggle()` の呼び出し行が抜けていた → 追加

- **feat**: 口座メモ欄追加（`accounts.js`）
  - 200文字制限（maxlength + DB CHECK制約）
  - リアルタイム文字数カウント（200文字到達で赤くなる）
  - URL自動検出 → 「🔗 リンクを開く」リンク表示
  - ⚠️ Supabase: `ALTER TABLE accounts ADD COLUMN notes text CHECK (char_length(notes) <= 200);` 実施済み

- **feat**: 口座残高修正UI刷新（`accounts.js`）
  - 現在残高をグレー背景で表示
  - 修正後残高の入力欄を大きく（font-size:20px）
  - リアルタイム差分表示（+¥XXX→緑 / −¥XXX→赤 / 変化なし→グレー）

- **feat**: 総残高の表示/非表示切り替え（`dashboard.js`）
  - 総残高カードをタップで `¥ ••••••` に切り替え
  - 状態を `localStorage: flowra_balance_hidden` に保存
  - 口座別残高・合計行は常時表示（総残高カードのみ非表示）

- **fix**: 今月ボタンのレイアウトシフト解消（`router.js` / `index.html`）
  - hidden → disabled + グレーアウト（opacity:0.35）に変更
  - ボタンは常時表示でレイアウト固定

- **fix**: 保存/キャンセルボタンの誤タップ防止（`css/style.css`）
  - `gap: 10px` でボタン間に余白
  - キャンセル: `min-width: 88px` の固定小サイズ
  - 保存する: `flex: 1` で残り全幅を占有

- **feat**: タグアイコン自動推定（`add-record.js`）
  - KEYWORD_ICON_MAP: キーワード部分一致でアイコンを自動割り当て
  - 「家事・住居費」→🏠、「水道光熱費」→🔥、「支払保険料」→🛡 など
  - マッチしないタグはカラーラベルアイコン（デフォルト）

- **feat**: タグカラー変更機能（`settings.js`）
  - タグ編集シートに16色スウォッチを追加
  - `renderTagColorPicker()` / `TAG_COLORS` を settings.js 内に定義
  - 保存時に `DB.updateTag(id, { name, color })` でカラーも更新

### 2026-06-02（セッション前半）

- **fix**: ホーム画面スピナーが永遠に止まらないバグを修正（`dashboard.js`）
  - 原因1: `syncInBackground` のcatchでエラーを握り潰していた → エラー表示＋再読み込みボタンを追加
  - 原因2: `hasCached` 判定が `accounts.length > 0` のみ → `accounts || transactions` に変更
  - 原因3: `tx.tags[0].name` のnull参照クラッシュ → `tx.tags.find(t => t)` に修正
  - デバッグ用にエラー内容を画面表示する仕組みを追加（`err-detail` ID）

- **feat**: 年月ピッカー・今月ボタン（`router.js` / `index.html`）
  - 月ラベルタップ → 年月ピッカーボトムシート（2010年〜翌年）
  - 今月以外の月を表示中に「今月」ボタンが出現
  - `MonthState.goTo(year, month)` / `MonthState.isCurrentMonth()` を追加
  - `Router._jumpToMonth(year, month)` / `Router._showMonthPicker()` を追加

- **feat**: 差分インポート機能（`import-notion.js` / `db.js`）
  - `DB.getAllTransactionKeys()`: 既存全件のキーセット取得
  - プレビュー画面に「差分インポート」チェックボックス（既存データありで自動ON）
  - 完了画面にスキップ件数・エラー件数・最古挿入月ジャンプボタン

- **fix**: インポート後にIndexedDBキャッシュを再構築（`import-notion.js` / `db.js`）
  - 問題: インポートはSupabaseに正しく書き込むが、IndexedDBには反映されず全期間検索に出なかった
  - `DB.fetchAllToCache()` を新規追加（500件ずつ全件取得してIndexedDBに投入）
  - インポート完了後: `clearAll()` → 遷移 → バックグラウンドで `fetchAllToCache()`

- **fix**: `transactions_amount_check` 制約違反（`import-notion.js`）
  - 原因: Notionの0円レコードがバッチに混入 → バッチ全体（200件）が失敗
  - 修正: `金額 === 0` のレコードをスキャン時点でスキップ

- **feat**: `importTransactions` にリトライ追加（`db.js`）
  - 失敗バッチを1秒後に再試行（最大1回）
  - エラー件数をプログレスコールバックに渡して画面表示

### 2026-06-01（セッション7）
- **feat**: 検索機能を全期間・タグ名対応に強化（`records.js`）
- **feat**: Notionインポート完走（3万件超・scanAndCollect方式・年フィルタ分割クエリ）

### 2026-05-31（セッション5〜6）
- **fix**: 追加ボタンが月スライド後に効かなくなる問題（null参照クラッシュ）
- **fix**: closeModal の animationend 問題
- **refactor**: カルーセルを状態機械で再実装

### 2026-05-30（セッション1〜4）
- **feat**: 月切り替えスライドカルーセル
- **feat**: チーム名変更・メンバー管理
- **feat**: viewerロール制限
- **fix**: ボトムナビ下余白
- **fix**: RLS静かな失敗パターン各種
