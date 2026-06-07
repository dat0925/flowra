# Flowra 引き継ぎドキュメント

最終更新: 2026-06-04（昼）

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
- 記録追加画面の全面再設計（完了）
- AIアドバイスの他ページ→ホーム戻り時にキャッシュ復元されない問題を修正（2026-06-04）
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

### 🟢 次フェーズ候補

1. **タグへの「固定費フラグ」追加** → **✅ 自動推定で解決済みのため不要と判断（2026-06-04）**
   - 過去3ヶ月のブレ幅（±40%以内）で固定費を自動推定する方式が実用上十分に機能
   - ユーザーが設定しなくてよい摩擦ゼロの設計のまま維持する

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

## 🔴 セキュリティ必須チェックリスト

### 「どのユーザーのデータを見るか」が変わる処理は必ずこのチェックを実施すること

**対象となる処理の例：**
- 招待の受け入れ・拒否
- チームの切り替え
- ログイン・ログアウト
- アカウント削除・脱退

**チェック項目（実装後に必ず確認）：**

1. `active_team_id`（localStorage）は正しいチームIDに更新されているか
2. `_teamId`（メモリキャッシュ）はリセットされているか
3. IndexedDBキャッシュは古いチームのデータが残っていないか
4. 処理前後で別ユーザー・別チームのデータが混入する経路がないか

**実装時のプロンプト（必ずコピーして使うこと）：**

> 「この処理の前後で active_team_id やセッション状態が正しくリセット・更新されているか、別ユーザーや別チームのデータが混入する可能性がないか、セキュリティの観点でレビューして」

### 過去のインシデント事例（2026-06-06）

**内容：** 招待リンクを受け入れた後、招待元とは無関係な別ユーザーのデータが表示された

**原因：** `acceptInvite()` がチームへの参加処理は正しく行ったが、`active_team_id`（localStorage）を招待元チームのIDに更新していなかった。リロード後に古い `active_team_id` が残り続け、意図しないチームのデータが表示された。

**修正：** `acceptInvite()` の末尾に `this.setActiveTeamId(invite.team_id)` を追加（`db.js`）

**教訓：** チームへの参加・離脱処理は「DBへの書き込み」だけでなく「ローカルステートの更新」がセットで必要。片方だけ実装すると他人のデータが見えるインシデントになる。

- **Claude Codeより会話型Claudeで開発** - スマホ・iPadのみで開発しているためCLIなし
- PATは都度発行・失効はオーナーが手動で行う（fine-grained PAT推奨）
- Supabaseのスキーマ変更は必ずSQL Editorで実施後にコードを変更する順番で
- `team_members`テーブルは`id`カラムがないので注意（`(team_id, user_id)`で識別）

---

## 変更履歴

### 2026-06-05（深夜・AIフリー入力実装）

- **feat**: AIアドバイスにフリー入力対応（`dashboard.js` / `flowra-ai/index.ts`）
  - チップボタンの下に自由入力欄＋「聞く」ボタンを追加
  - 「今日いくら使った？」「5/1の支出は？」など日次・日付指定クエリに対応
  - 今月の全取引データをAIに渡してプロンプトに組み込む
  - 回答後にタイムスタンプ（例: `6/5 23:59 の回答`）を表示
  - 直前3件の会話履歴をプロンプトに含めて文脈を引き継ぐ
  - Enterキーでも送信可能

- **既知の制限・次の課題**:
  - 現在は表示中の月のデータしか渡していないため、過去月の質問（「7月は？」等）や月をまたいだ追加質問（「その中で飲食に絞ると？」）が見当違いな回答になる
  - **解決策候補**: 直近3ヶ月分の全取引を渡す（トークン増加とのトレードオフ）
  - Edge Functionは手動デプロイ済み（`supabase/functions/flowra-ai/index.ts`）

- **feat**: 口座選択行に現在残高表示、保存後トーストに登録後残高を表示（`add-record.js`）

- **fix**: 記録追加後にホームで収入が隠れない問題を修正（`app.js`）
  - `patchAfterSave` でサマリーカードが再描画されずhiddenフラグが反映されなかった

- **fix**: セキュリティ確認済み → 全テーブルRLS有効・問題なし

### 2026-06-05（午前〜午後・バグ修正・UI改善）

- **fix**: 編集保存後にsave-barが残る問題を修正（`edit-record.js`）
  - 原因: 削除時には `saveBar.hidden = true` があったが保存時に抜けていた
  - 再現条件: 登録済みレコードを編集して保存したとき

- **fix**: 最近の記録を4件→20件に増加、日付ベース重複排除に変更（`add-record.js`）

- **fix**: ホームの口座並び順を `sort_order` に統一（`cache.js`）

- **feat**: アコーディオン（予算・口座残高・記録一覧）を実装（`dashboard.js`）
  - 開閉状態を `localStorage` に保存（`ac-budget` / `ac-acct` / `ac-tx`）
  - chevronが緑色で視認性あり

- **feat**: 記録一覧パネルに「記録 ›」リンクを追加（記録ページへ遷移）

- **既知の軽微な問題**: 起動直後に収入が隠れない場合があるが操作すると直る・再現しなくなったため保留

### 2026-06-04（深夜・バグ修正）

- **fix**: `team_members` RLS無限ループを修正
  - `my_all_team_ids()` / `my_team_ids()` を `SECURITY DEFINER` に変更
  - `team members can manage invites` ポリシーを `team_members` 直接参照から `my_all_team_ids()` 経由に変更
  - Supabase SQL Editorで手動実行済み・`supabase_admin.sql` に記録済み

- **fix**: 招待リンクを未ログイン状態で開いた時のクラッシュを修正（`app.js` / `db.js`）
  - 未ログイン時は「Googleでログイン」ボタンを表示、ログイン後に同じURLへリダイレクト
  - `acceptInvite` にログインチェックを追加

- **fix**: ヘッダーの年月表示を画面中央に絶対配置（`css/style.css`）
  - `position: absolute; left: 50%; transform: translateX(-50%)` で常に真中央

- **月切替UIの設計判断**（試行錯誤の記録）
  - サマリーカード内に `< >` を置く案を試みたが「このページだけ動く」誤解を生むため却下
  - **グローバルな操作はグローバルな場所（ヘッダー）に置く**が正解
  - ヘッダーの `< >` ボタンを維持、月ラベルは中央配置

### 2026-06-04（夜・UI修正）

- **fix**: 記録ページの縦スクロール中に横スワイプが誤検知される問題を根本解決
  - スワイプによる月切替を**完全廃止**（タッチイベント・ゴーストパネル210行削除）
  - 月切替は `< >` ボタンのみに統一
  - 副次効果：長年解決しなかった「ヘッダー直下の透け・縦スクロール時の透け」も同時解決
  - 原因：スワイプ処理の `e.preventDefault()` と transform 残留が縦スクロールに干渉していた
  - `page-content` に `overflow-x: hidden` を追加して横揺れも完全封鎖
  - コミット: `b1de322`（スワイプ廃止）/ `684306f`（横揺れ封鎖）

### 2026-06-04（朝・Stripe決済実装 着手中）

- **feat**: Stripe決済Edge Function 2本を追加（コミット: `9045bab`）
  - `supabase/functions/stripe-webhook/index.ts`
  - `supabase/functions/stripe-portal/index.ts`
  - TaskraのStripe実装をベースに流用・Flowra用に調整済み

- **GitHub Actionsワークフロー無効化**（コミット: `f4faeb3`）
  - 自動デプロイが毎回失敗してメールが届く問題を解消
  - `workflow_dispatch`（手動実行のみ）に変更

#### 🚧 Stripe決済：次のClaudeが続きをやること

**残り作業一覧（この順番で進める）：**

**① Supabase Secrets登録**（ダッシュボード → Edge Functions → Secrets）

| キー名 | 値 |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_**************************（Stripeダッシュボード → 開発者 → APIキー で確認）` |
| `STRIPE_PREMIUM_PRICE_ID` | `price_1TeObDB5e5DORDCypOnurrsf` |
| `STRIPE_WEBHOOK_SECRET` | 後述（Webhook登録後に発行） |
| `SB_SERVICE_ROLE_KEY` | 要確認（登録済みかもしれない） |
| `SB_ANON_KEY` | 要確認（stripe-portalで使用） |

**② Edge Function 2本をデプロイ**
- Supabase Dashboard → Edge Functions → 「New Function」
- `stripe-webhook` と `stripe-portal` をそれぞれ作成
- コードは `supabase/functions/` 以下のファイルをコピペ
- （GitHub Actionsでの自動デプロイは「Host not in allowlist」で不可。PCから `supabase functions deploy` するか、ダッシュボードから手動デプロイ）

**③ StripeダッシュボードでWebhookを登録**
- Stripe Dashboard（サンドボックス）→ 開発者 → Webhook → 「エンドポイントを追加」
- URL: `https://copyzpsyagscqrvkrwjo.supabase.co/functions/v1/stripe-webhook`
- イベント: `checkout.session.completed` / `customer.subscription.created` / `customer.subscription.deleted` / `customer.subscription.updated`
- 登録後に表示される `whsec_` で始まるシークレットを `STRIPE_WEBHOOK_SECRET` としてSupabaseに登録

**④ LPのPremiumボタンを有効化**
- `lp/index.html` の該当箇所を修正
- Payment Link: `https://buy.stripe.com/test_7sY6oG72Y43J0Yp72rds402`
- 「近日リリース予定」表示を本物のリンクに変更

**⑤ 設定画面にサブスク管理ボタンを追加**
- `settings.js` にStripeポータルへのリンクボタンを追加
- `stripe-portal` Edge Functionを呼び出してURLを取得 → リダイレクト

**Stripe関連の既知情報：**
- サンドボックス環境で作業中（本番切り替え時はキーを差し替えるだけ）
- 商品名: `Flowra プレミアム` / ¥398/月
- 商品ID: `prod_Udfx7VbHRvrd4a`
- Price ID: `price_1TeObDB5e5DORDCypOnurrsf`
- Payment Link（テスト）: `https://buy.stripe.com/test_7sY6oG72Y43J0Yp72rds402`
- `user_plans` テーブルはFlowraに既存（`email`, `plan`, `stripe_customer_id`, `updated_at`）

### 2026-06-04（昼・AIアドバイス改善）

- **fix**: AIアドバイスが固定費（家のローン等）を節約提案してしまう問題を改善（`dashboard.js` / `flowra-ai/index.ts`）
  - **短期対応（実装済み）**: 過去3ヶ月のタグ別支出を分析し、毎月±40%以内のブレで継続するタグを「固定費」と自動推定
  - Edge Functionに `fixedCostTags[]` を渡し、AIプロンプトに「固定費タグは提案対象外」の指示を動的追加
  - `estimateFixedCostTags(year, month)` を `dashboard.js` に追加（ボタン押下時のみ実行、自動一言には未適用）
  - コミット: `556fa56`
  - ⚠️ **Edge Functionの手動デプロイが必要**: Supabase Dashboard → Edge Functions → flowra-ai → `supabase/functions/flowra-ai/index.ts` の内容を貼り付けてデプロイ

- **中期開発計画**: タグへの「固定費フラグ」追加（後述）

### 2026-06-04（昼・バグ修正）

- **feat**: 記録追加画面の全面再設計（完了）
  - `js/add-record.js` / `css/style.css` を改修
  - +ボタン → 数字キーボードが即座に開く（金額入力が最初）→ タグ/メモ/口座（スキップ可）→ 保存
  - `renderAddRecord(onSave, onClose, opts)` シグネチャは変えず、`patchAddRecord(tx)` も維持

- **fix**: AIアドバイスが他ページ→ホーム戻り時に消える問題を根本修正（`dashboard.js`）
  - 原因: `_aiAdviceCache` にキャッシュを保存していたが、`setupAiSummary` 呼び出し時にキャッシュを確認・復元する処理がなかった
  - 修正: `setupAiSummary` 冒頭で `_aiAdviceCache` の年月を確認し、一致すれば即座にDOM復元
  - 副次効果: キャッシュ復元済みの場合はAI API自動呼び出しをスキップ（無駄なAPI消費も防止）
  - コミット: `2cdeef6`

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

### 2026-06-06（セッション・RLS対応）
- **fix**: `team_members` への読み書きが全てRLSでブロックされていた
  - `get_my_role(p_team_id)` RPC追加 → viewer判定が正しく動作
  - `update_member_role(p_team_id, p_user_id, p_role)` RPC追加 → 権限変更が保存されるように
  - `remove_member(p_team_id, p_user_id)` RPC追加 → メンバー削除が動作するように
  - **教訓**: `team_members` / `user_plans` / `auth.users` への直接アクセスは全てRLSでブロックされる。新たにこれらのテーブルを操作する処理を追加する場合は必ずRPC（security definer）経由にすること

### 2026-06-06（セッション・キャッシュ対応）
- **fix**: `getCachedAccounts` で `is_archived` フィルタを追加（`cache.js`）
  - 削除済み口座がIndexedDBキャッシュに残り続けてホーム画面に表示される問題
- **fix**: `putAccounts` で既存キャッシュを全クリアしてから書き直す（`cache.js`）
  - 口座を追記ではなく上書きにすることで削除済み口座の残留を防止
  - **教訓**: IndexedDBへの `put` は追記であり削除は行わない。口座など「全件が正」のデータは必ず `clear()` してから `put` すること
- **fix**: 非公開口座を公開に戻せないバグ修正（`accounts.js`）
  - `privatePayload` の条件式が「公開→非公開」のみ許可していた一方通行のロジックだった
  - トグルの値をそのまま保存するシンプルな形に修正

---

## 🟡 機能実装時の必須プロンプト

### マルチユーザー・共有機能を実装するときは必ずこのフレーズを添えること

> 「実装後に以下を必ず確認して：
> ①RLSでブロックされる操作がないか（team_members・user_plans・auth.usersは直接アクセス不可、必ずRPC経由）
> ②localStorageとIndexedDBの古いキャッシュが残留する経路がないか
> ③複数ユーザーが同時に操作した場合に別人のデータが混入しないか」

### なぜこれが必要か

招待・チーム切替・権限管理は「複数ユーザーの状態が絡み合う」処理で、1人で使うアプリより本質的に複雑。以下のバグは実際に2人で動かさないと見えないことが多い。

- RLSの静かな失敗（エラーが出ずに空を返す・更新されない）
- IndexedDBキャッシュへの古いデータ残留（削除済み口座・別チームのタグ）
- localStorageに残った古いteam_idによる別人データの表示

### Flowra固有のRLSルール（必読）

| テーブル | 直接アクセス | 対応RPC |
|---|---|---|
| `auth.users` | ❌ 不可 | `get_all_users()` |
| `user_plans` | ❌ 不可 | `get_all_user_plans()` / `set_user_plan()` |
| `team_members` | ❌ 不可 | `get_my_role()` / `update_member_role()` / `remove_member()` |

### IndexedDBキャッシュのルール

- 口座など「全件が正」のデータは `put`（追記）ではなく `clear()` → `put` で上書きする
- `getCachedAccounts` は `is_archived: false` でフィルタする
- チーム切替時は必ず `clearAll()` でキャッシュを全クリアする

### 2026-06-06（セッション・ホーム画面・UX改善）
- **fix**: ホーム画面で月切り替え時に再描画されない問題（`router.js`）
  - 矢印ボタンでの月切り替え時に `renderDashboard` が呼ばれていなかった
  - records以外のページ（dashboard）でも月変更後にhandlerを呼ぶよう修正
- **fix**: 当月キャッシュが空の場合はSupabaseから再取得して再描画（`dashboard.js`）
  - 過去データがIndexedDBにない月を開いても0件表示になっていた
- **feat**: 設定画面に「データを再同期」ボタン追加（`settings.js`）
  - IndexedDBを全クリア→リロードするキャッシュバスター
  - 「直したのに直ってない」時にユーザーが自分で解決できる手段
- **feat**: プルトゥリフレッシュ実装（`app.js`）
  - ページ最上部で80px以上下スワイプして離すと現在ページを再読み込み
- **feat**: 最後に見ていたページを記憶・復元（`router.js` / `app.js`）
  - localStorageに保存、リロード後も同じページに戻る
- **feat**: チーム切替ボタンを絵文字→イニシャルアバターに変更（`app.js`）
  - 「個人」表示をチーム名に変更
- **ci**: Service Workerキャッシュバージョン自動インクリメント（`.github/workflows/bump-sw-version.yml`）
  - mainへのpush時にGitHub Actionsが `flowra-vN` を自動でインクリメント
  - 手動でバージョンを上げ忘れて古いJSが使われ続ける問題を防止

## 🔴 次のTODO（未着手）

### Stripe決済実装
- Premiumプランの決済フローが未実装
- LPの料金表示・CTAはあるがStripeのcheckoutに繋がっていない
- 実装方針はHANDOFF.mdの既存セクション参照
- **注意**: Stripe webhookでuser_plansを更新する際も `set_user_plan` RPC経由を使うこと（直接updateはRLSでブロックされる）

### 2026-06-06（セッション・AI課金設計）
- **feat**: チームオーナーがpremiumならメンバーもAI無制限（`db.js`）
  - `getUserPlan` でオーナーのプランをフォールバックとして確認
  - 夫がpremium登録 → 妻が夫のチームでAIを使っても無制限
  - 妻が自分のチームを見ているときはfree（月5回）のまま
  - 「¥398で2人使い放題」というLPの訴求と一致する設計
  - 必要なRPC: `get_team_owner(p_team_id)` → オーナーのuser_idを返す

### 2026-06-07（セッション・検索・集計・UX）
- **feat**: タグ×月クロス集計シート実装（`js/summary-sheet.js`新規作成）
  - 記録一覧の右上「集計」ボタンから開く
  - 縦タグ・横直近6ヶ月・右端に今月予算
  - 予算超過は赤、80%超は黄、全月に適用
- **feat**: 記録一覧フィルターバーを2行レイアウトに変更（`records.js`）
  - 1行目：フィルタータブ、2行目：検索窓（全幅）＋集計アイコンボタン
- **fix**: タグ名・口座名検索がタイムアウトする問題（`db.js`）
  - `transaction_tags` へのRLSブロックが原因
  - `search_transactions(p_team_id, p_keyword, p_type)` RPCを作成して対応
  - **注意**: RPCの戻り値型はtransactionsテーブルの実際のカラム型と完全一致が必要（amountはbigint等）
  - 既存関数の型変更は `DROP FUNCTION` してから再作成すること
- **fix**: タグ追加ボタンが反応しないバグ（`settings.js`）
  - `btn-add-tag-open` というIDが存在しない要素を参照していた
  - `openSubPage` に `onAdd` コールバックを追加して直接 `openTagAddSheet` を呼ぶ形に修正
- **feat**: ホーム画面から口座残高・記録一覧パネルを削除（`dashboard.js`）
  - ホームは「総残高・収支・AI・予算」に絞り、各画面の役割を明確化
- **feat**: チームオーナーがpremiumならメンバーもAI無制限（`db.js`）
  - `get_team_owner(p_team_id)` RPC追加
