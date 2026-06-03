# Flowra 引き継ぎドキュメント

最終更新: 2026-06-04（深夜）

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

## Supabase Edge Functions

| 関数名 | 用途 |
|--------|------|
| `notion-proxy` | NotionインポートのCORSプロキシ |
| `flowra-ai` | AIサマリー（Anthropic API呼び出し） |

### flowra-ai の詳細
- モデル: `claude-haiku-4-5-20251001`（軽量・高速・低コスト）
- max_tokens: 300
- 環境変数: `ANTHROPIC_API_KEY`（他アプリと共有済み）
- 受け取るデータ: `{ question, data: { year, month, income, expense, tagBreakdown, budgets, prev... } }`
- 質問タイプ: `monthly`（今月評価）/ `compare`（先月比）/ `saving`（節約ヒント）
- 自動一言（monthly）は既存データのみ使用（budgets:[]、prev:0）
- ボタン押下時は先月データ・予算データも取得して詳細プロンプトを構築

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
- AIサマリー機能（ホーム画面・自動一言表示＋3ボタン詳細）（2026-06-03）
- ホーム画面レイアウト刷新（総残高全幅・収入支出横並び・AI直後配置）（2026-06-03）
- タグ管理・予算管理を設定画面から別画面（サブページ）に分離（2026-06-03）
- 設定画面スリム化（件数表示＋右矢印行、スライドインサブページ）（2026-06-03）
- 検索結果タップで編集が開かないバグ修正（`_searchResults`ステート追加）（2026-06-03）
- オンボーディング5ステップに拡充（ウェルカム→口座→初回記録→招待→完了）（2026-06-03）
- LP予算管理セクション追加（動くUIモック・スクロールアニメーション）（2026-06-03）
- オンボーディング招待イラストをSVGに（絵文字廃止）（2026-06-03）
- ウェルカム画面フィーチャーカードをタップ展開式に（アコーディオン）（2026-06-03）
- オンボーディング口座保存エラー修正（Promise.all→直列・セッション切れ対応）（2026-06-03）
- 設定画面UX3箇所修正（タグ行全体タップ・削除2ステップ確認・月別シート刷新）（2026-06-03）
- 予算管理設定画面に合計行追加・月別シートUX改善（2026-06-03）
- AI使用制限・Premiumプラン月6,000回（原価ベース設計）実装（2026-06-04）
- 隠すボタンで総残高＋収入を同時マスク（支出は常に表示）（2026-06-04）
- 記録一覧stickyヘッダー透け根本解決（padding-top制御方式に変更）（2026-06-04）
- 今すぐ入力ボタンのID重複バグ修正（2026-06-04）
- 🚧 記録追加画面の全面再設計（進行中・後述）
- LP料金セクション刷新（Free vs Premium 2プラン比較）（2026-06-03）
- LP PremiumプランCTAを近日リリース表示に変更・クリック無効化（2026-06-03）
- 管理画面（admin.html）追加（2026-06-03）
- 設定画面に管理者のみ表示の管理画面リンクを追加（2026-06-03）
- AI日付コンテキスト修正（月途中の不適切な総括・収入無視を防ぐ）（2026-06-03）
- サブページUX改善（×ボタン右上・右スワイプで閉じる・予算下部固定保存）（2026-06-03）
- パートナー共有エリアにスケルトンUI追加（CLS防止）（2026-06-03）
- 設定画面の全体再描画を差分更新に変更してCLS根絶（2026-06-03）
- 記録一覧のサマリー・フィルタ・検索を上部固定（sticky）（2026-06-03）
- 管理画面ヘッダーをsticky固定・スマホレイアウト修正（2026-06-03）
- 記録追加モーダルのUX改善（×削除・直接入力セルをグリッド末尾・下部固定キャンセル）（2026-06-03）
- 記録追加に⚡今すぐ入力CTAボタンを追加（急いでいる時のショートカット）（2026-06-03）
- AIアドバイスを自動発動→能動的利用に変更・残り回数バッジ表示（2026-06-03）
- AIアドバイスにsessionStorageキャッシュ・日時表示・チップ2つ追加（2026-06-03）
- AIアドバイスキャッシュをsessionStorage→モジュール変数に変更（2026-06-03）

### 🚧 進行中：記録追加画面の全面再設計

**背景・問題意識：**
- ユーザーが記録するのは「支払い直後（レジ前・改札出た直後）」が最多
- その時の心理：急いでいる、早く終わらせたい、金額は覚えている
- 今の画面はタグ選択・CTAボタン・履歴リストが並列に並び「どれを使えばいい？」と毎回判断させる
- 3つの導線が同一画面に存在することで、急いでいる人が一瞬止まる

**設計方針（次のClaudeへ）：**
1本の動線に統一する
```
+ボタンタップ
  → 数字キーボードが即座に開く（金額入力が最初）
  → 金額入力後「次へ」or「保存」
  → タグ・メモ・口座を選ぶ（スキップ可）
  → 保存
```

**実装の考え方：**
- 「急いでいる人」は金額だけ入れてすぐ保存できる
- 「丁寧にやる人」はタグ・メモまで入れる
- 履歴コピーは金額入力画面の上部に小さく「最近の記録」を出す
  （今の位置は正しい、サイズ・存在感が問題）
- タグ選択は金額入力の後（今は前）
- 順序：金額 → タグ（任意）→ メモ（任意）→ 口座（任意）→ 保存

**触るファイル：**
- `js/add-record.js`（メイン）
- `css/style.css`（スタイル調整）

**注意事項：**
- `renderAddRecord(onSave, onClose, opts)` のシグネチャは変えない
- `patchAddRecord(tx)` は記録一覧のリアルタイム更新に使うので残す
- iOS Safariのキーボード対応に注意（`ios-focus-trick`要素が既存）
- `_skipSuggest: true` オプションで提案画面をスキップできる

### 🟢 次フェーズ候補

1. **月次レポートシェア**
   - html2canvas + Web Share APIで「今月の家計まとめ」を画像化してSNSシェア
   - Flowraロゴ入り → バイラル効果

2. **Premium決済自動化＋LP公開**
   - LP上のPremiumボタンは現在「近日リリース予定」でクリック無効化済み
   - 決済準備ができたらボタンを復活させる（1行変更のみ）
   - 将来: Stripe連携で自動化（今は不要）

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

### 2026-06-04（バグ修正・UI改善）

- **fix**: AI制限の管理者バグ修正（admin/premiumプラン判定）
- **feat**: PremiumのAI上限を月6,000回に設定（原価ベース、1日200回）
- **feat**: LP Premium訴求を「月6,000回・1日200回。使い切れません。」に変更
- **fix**: 隠すボタンで総残高＋収入を同時マスク（支出は常に表示）
- **fix**: 記録一覧stickyヘッダー透けを根本解決
  - 原因: page-contentのpadding-topがstickyの貼り付き位置よりコンテンツを上に押し込んでいた
  - 解決: records表示時にpadding-topを0にし、stickyヘッダー自身がpadding-topを持つ方式に
  - 他ページ遷移時にpadding-topをリセット（app.js）
- **fix**: 今すぐ入力ボタンのID重複バグ（suggest-new-btn → suggest-quick-btn）

### 2026-06-03 深夜（別Claude：UX改善・AI改善）

- **feat**: サブページUX改善（`settings.js`）
  - ×ボタンを右上に配置
  - 右スワイプで閉じる
  - 予算の保存ボタンを下部固定

- **fix**: 設定画面CLS根絶（`settings.js`）
  - 全体再描画→差分更新方式に変更
  - パートナー共有エリアにスケルトンUI追加
  - 一度だけ描画する方式に変更

- **feat**: 記録一覧のstickyヘッダー（`records.js`）
  - サマリー・フィルタ・検索バーを上部固定

- **fix**: 管理画面スマホ対応（`admin.html`）
  - ヘッダーをsticky固定
  - スマホレイアウト修正
  - 有効期限の縦書き修正
  - stickyヘッダーのスクロール影CSS追加

- **feat**: 記録追加UX改善（`add-record.js`）
  - ×ボタン削除・直接入力セルをグリッド末尾に
  - 下部固定キャンセルボタン
  - ⚡今すぐ入力CTAボタン追加（急いでいる時のショートカット）

- **feat**: AIアドバイス改善（`dashboard.js`）
  - 自動発動→能動的利用に変更（ユーザーが押したときだけ実行）
  - 残り回数バッジ表示
  - sessionStorageキャッシュ・日時表示・チップ2つ追加
  - キャッシュをsessionStorage→モジュール変数に変更（ナビゲーション間で確実に保持）

### 2026-06-03 夜（マネタイズ・管理画面）

- **feat**: AI使用制限＋プランUI実装（`db.js` / `dashboard.js` / `lp/index.html`）
  - **プラン設計**:
    - Free: AIアドバイス月5回・記録/共有/予算はすべて無制限
    - Premium ¥398/月: AI無制限・「2人で割れば¥199/人」コピー
    - 「Couple」→「Premium」にリネーム（将来の機能変更で名前と矛盾しないよう）
  - `DB.FREE_AI_LIMIT = 5`
  - `DB.getAiUsageThisMonth()` / `DB.incrementAiUsage()` / `DB.getUserPlan()` / `DB.isPremiumPlan()`
  - callAI呼び出し前にプランチェック → 5回超過でアップグレードシート表示
  - LIMIT_REACHED時はエラー表示なしで静かに処理
  - LP Pricingセクションを「Free vs Premium」2カラム比較に刷新

- **feat**: 管理画面（`admin.html`）
  - URL: `https://flowra.taskra.jp/admin.html`
  - **セキュリティ**: `ADMIN_USER_IDS`配列に一致したユーザーのみアクセス可
  - **機能**:
    - 統計（Premiumユーザー数・今月AI利用ユーザー数）
    - プラン設定: メール入力→user_id検索→Free/Premium/Admin切り替え・有効期限設定
    - プラン保有ユーザー一覧（メールアドレス表示・解除ボタン）
    - 今月のAI使用量上位10件（進捗バー・メールアドレス表示）
    - ヘッダーにアプリ・サービスサイトへのリンク
  - **Supabase側で必要なSQL**（実行済み）:
    - `ai_usage`テーブル・`user_plans`テーブル
    - `increment_ai_usage()` RPC
    - `get_user_id_by_email()` RPC
    - `get_email_by_user_id()` RPC

- **feat**: 設定画面に管理者リンク追加（`settings.js`）
  - バージョン表示の下に「⚙ 管理画面」リンク
  - 管理者user_idと一致した場合のみ表示（一般ユーザーには不可視）

- **運用フロー**（現在）:
  1. ユーザーがメールで申し込み（`support@taskra.jp`）
  2. 管理者が `admin.html` でメール検索→Premiumに設定
  3. 将来: Stripe連携で自動化

### 2026-06-03（オンボーディング・設定UX・LP改善）

- **fix**: 検索結果タップで編集が開かないバグ修正（`records.js`）
  - 原因: 全期間検索結果が `_allTx` に入らず、イベントデリゲーションがIDを見つけられなかった
  - 修正: `_searchResults` ステートを追加。検索中は `_searchResults`、当月は `_allTx` を参照

- **feat**: オンボーディングを5ステップに拡充（`onboarding.js` / `css/style.css`）
  - 旧: ウェルカム→口座選択→完了（3ステップ）
  - 新: ウェルカム→口座選択→初回記録→パートナー招待→完了（5ステップ）
  - ウェルカム: 「2人のお金」コンセプト訴求。フィーチャーカードをタップ展開式（アコーディオン）に
  - 初回記録: 金額・メモ・口座入力フォーム。バリデーション＋シェイクアニメーション
  - パートナー招待: `createInviteForOwnTeam` でリンク発行。SVGイラスト（人物2体）
  - プログレスバー（上部の緑細線）でステップ進捗を可視化
  - **⚠️ 重要**: 口座保存を `Promise.all`（並列）→ `for...of`（直列）に変更
    - 並列でRLS競合が起きてエラーになるケースがあった
  - **⚠️ 重要**: `ensureTeam` にセッション確認を追加（動画再生後など復帰時のJWTエラー対策）

- **feat**: LP予算管理セクション追加（`lp/index.html`）
  - Features グリッドに「予算管理」カード追加
  - 専用セクション「記録して、終わらない。」をHOWの直前に挿入
  - スクロールインで食費/交通費/娯楽/日用品の進捗バーが順番に伸びるアニメーション
  - safe(緑)・warn(黄)・over(赤)の3色で視覚的に差別化
  - Freeセクションのチェックリストに「タグ別予算管理・進捗バー」を追加

- **fix**: 設定画面UX3箇所修正（`settings.js`）
  - **タグ一覧**: 行全体タップで編集シートが開くように変更（シェブロンのみ→行全体）
  - **タグ編集シート**:
    - キャンセル＋保存を横並びに変更（記録画面と統一）
    - 削除ボタンをボーダー区切り下に分離・スタイルを控えめなグレーに
    - 削除を2ステップ確認に変更（1回目→赤くハイライト、2回目→実行、3秒でリセット）
    - confirmダイアログ廃止
    - 「自動推定に戻す」ボタンに余白追加
  - **月別予算シート**:
    - `<label>` 要素化→行全体タップで入力フォーカス
    - 左余白を16pxに統一
    - キャンセル＋保存を横並びに変更
    - 説明文・使用例ヒント・デフォルト値プレースホルダー・当月バッジを追加

- **feat**: 予算管理設定画面に合計行追加（`settings.js`）
  - タグ一覧の下にボーダー区切り＋「合計 ¥XXX」行
  - 金額入力のたびにリアルタイムで合計が更新される

### 2026-06-03（AIサマリー・ホームレイアウト・設定画面）

- **feat**: AIサマリー機能（`dashboard.js` / Supabase Edge Function `flowra-ai`）
  - ホーム画面に「AI アドバイス」パネルを追加（薄緑背景＋細い枠線の控えめデザイン）
  - ページを開くと自動で `monthly` 質問を送り一言表示（既存データのみ使用・追加DB呼び出しなし）
  - ボタン3つ（今月どう？/先月と比べて/節約ヒント）で詳細回答を展開
  - Edge Function `flowra-ai`: Deno + Anthropic API (claude-haiku-4-5-20251001, max_tokens:300)
  - **重要**: `supabase` は dynamic import ではなく top-level で import すること（二重初期化ハングを防ぐ）
  - `callAI` は `setupAiSummary` の内部関数として定義（外部からは参照不可）
  - 自動一言にはタイムアウト12秒を設定

- **feat**: ホーム画面レイアウト刷新（`dashboard.js`）
  - 総残高: 全幅（変更なし）
  - 収入・支出: 3カラム→2カラム横並びに変更。フォント30px固定、`white-space:nowrap`で桁数崩れ防止
  - 配置順: 総残高 → 収入/支出 → AIアドバイス → 予算 → 口座

- **feat**: 設定画面スリム化（`settings.js`）
  - タグ管理・予算管理をインライン表示から「N個 ›」行に変更
  - タップでスライドインサブページ（`openSubPage`関数）が開く
  - iOSの設定アプリと同じナビゲーションパターン
  - 戻るボタンで設定画面に戻り、`renderSettings()` を再実行

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
