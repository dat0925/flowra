# Flowra 引き継ぎドキュメント

最終更新: 2026-05-30

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
    ├── router.js       # ページルーター・月カルーセル
    ├── dashboard.js    # ホーム画面
    ├── records.js      # 記録一覧
    ├── add-record.js   # 記録追加モーダル
    ├── edit-record.js  # 記録編集
    ├── accounts.js     # 口座管理
    ├── settings.js     # 設定画面
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
- `id`, `team_id`, `name`, `type`, `icon`, `color`, `balance`, `sort_order`, `is_archived`
- `sort_order` で並び順を管理（口座管理画面の↑↓ボタンで変更可能）

### `transactions`
収支記録
- `id`, `team_id`, `type`（income/expense/transfer）, `amount`, `account_id`, `to_account_id`, `date`, `memo`, `created_by`, `updated_by`, `created_at`

### `transaction_tags`
記録とタグの中間テーブル
- `transaction_id`, `tag_id`
- **注意**: `tag_id` が NULL になるケースがある（タグ削除後の残骸）。コード側で `filter(t => t)` してnullを除外すること

### `tags`
カテゴリタグ
- `id`, `team_id`, `name`, `color`, `icon`, `sort_order`

### `comments`
記録へのコメント
- `id`, `transaction_id`, `body`, `created_by`, `created_at`

---

## Supabase関数（SECURITY DEFINER）

| 関数名 | 用途 |
|--------|------|
| `my_team_ids()` | `my_team_id()`（単数・LIMIT 1）でRLS再帰を回避 |
| `my_all_team_ids()` | 複数チーム所属に対応したteam_ids取得 |
| `get_team_member_profiles(p_team_id)` | auth.usersのJOINを回避してメンバー情報を返す |

---

## RLSポリシー概要

全テーブルでRLS有効。主なポリシー：

- `accounts`, `tags`, `transactions`, `recurrings`: `my_team_ids()`でチームフィルタ
- `team_members`: `my_all_team_ids()`で全所属チームのメンバーが見える
- `team_invites`: 未使用・期限内のtoken保持者、またはチームメンバーが閲覧可
- `comments`: 自チームのtransactionにのみ書き込み可

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

### メンバー管理UI
- メンバー行タップ → ボトムシートで権限変更・削除
- 削除は2段階確認（誤タップ防止）
- 権限変更はテキストのみのカード選択式（SVGアイコン不要、中央揃えで見やすい）

### 脱退フロー
- 「このチームから脱退する」→ 確認モーダル → 「脱退する」と入力 → 脱退
- 脱退後は自動的に自分のチームに戻る

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
| `transactions` | 月次トランザクション |

- ログアウト時に`clearAll()`で全消去（別アカウント漏れを防止）
- `localStorage: flowra_active_team_id` もログアウト時にクリア
- 保存時は `tags` を含めてキャッシュに保存すること（`tags: []` で上書きするとタグが消える）

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

- `_loadGhostPanels()` が innerHTML を更新した後も `opacity:0` を明示すること
- `touchend` で縦スクロール判定（`axis !== 'h'`）で早期returnする場合もghostをリセットすること

### ghost の位置計算（px固定）
- `ghostNext`: `translateX(tx + w)` — contentの右隣
- `ghostPrev`: `translateX(tx - w)` — contentの左隣
- **%指定は使わない**（要素幅基準になりズレる）
- 静止時リセット: `translateX(-w)` / `translateX(w)`

### スワイプ判定
- 判定開始: 12px移動後
- 横スワイプ確定条件: `|dx| > |dy| × 2`（斜め移動をタップとみなして除外）
- これによりレコードタップ時の微ブレでスライドが誤発動しない

### 動作フロー
1. `touchstart`: startX/Y記録
2. `touchmove`: 12px超えたら軸判定 → 横確定で `trackDrag(tx, rawDx, w)`
3. `touchend`: 28%閾値超えで `commitSlide(dir)` / 未満で `cancelDrag()`
4. `commitSlide`: content退場 + ghost中央へ → 290ms後に月更新 + content即配置
5. `_updateMonthLabels`: ラベル更新 + `renderRecords()` + `_loadGhostPanels()`

### スワイプ有効画面
記録一覧のみ有効。`< >` ボタンは全画面で有効。

---

## PWA対応メモ

### レイアウト構造（重要）
```css
html, body { height: 100%; overflow: hidden; background: var(--ink); }
body { background: var(--ink); overflow: hidden; }
#app { display: flex; height: 100dvh; overflow: hidden; }
#main { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: var(--stone); }
/* モバイル */
#app { flex-direction: column; }
#main { height: 100dvh; }
```

- `body` と `html` の背景を `var(--ink)` にすることでボトムナビ下の隙間を視覚的に解消
- `#main` に `background: var(--stone)` を明示することでコンテンツエリアの色を保護
- **`body` の背景を変えるとき `#main` の背景も必ず明示すること**（過去に総残高カードが壊れた教訓）

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
- `box-shadow` や `::after` でホームバー下を塗る方法は不安定なため使わない
- ホームバー下の余白が残る場合は `body/html` の背景色で対処する

### その他
- `viewport-fit=cover, maximum-scale=1.0, user-scalable=no` でダブルタップズーム無効
- `theme-color: #1C2B22`（manifest.json と index.html 両方に設定）
- PWAをホームから削除→再追加でキャッシュ起因の表示崩れが解消することがある
- `user-select: none` を全体に適用済み（長押しメニュー抑制）
- クリップボードAPIが失敗する場合はWeb Share APIにフォールバック

---

## 口座並び替え

- `accounts.js` の↑↓ボタンで `sort_order` を更新
- **重要**: 既存の `sort_order` がバラバラな場合があるため、swap時は全口座を `0,1,2...` に正規化してからswapする
- 更新後は `DB.getAccounts()` → `putAccounts()` → `renderAccounts()` の順で再描画

---

## 保存後の楽観的UI（patchAddRecord）

記録保存後、再描画なしでリストの先頭に行を差し込む。

- `tx.tags`（タグオブジェクト配列）を含めて渡すこと
- 保存時に `tags: []` でキャッシュを上書きしない（`add-record.js` の `upsertTransactions` に注意）
- 差し込んだ行にクリックイベントを付与すること（付け忘れるとタップで編集画面に行けない）

---

## バグ修正の鉄則

**ある機能を直そうとして別の機能が壊れたとき：**

1. `git log --oneline` で壊れる前のコミットを特定する
2. `git show <hash>:path/to/file.css` でそのファイルの内容を確認する
3. 動いていた状態を理解してから修正する

新しいコードを書く前に必ず動いていた状態を確認すること。今日のボトムナビ問題で5回以上この手順を怠って遠回りした。

---

## 既知の未完了タスク

### 🟢 次フェーズ候補

1. **タグの並び替え**
   - 設定画面のタグ管理に↑↓ボタンを追加
   - 追加画面のカテゴリ選択にも反映

2. **Excelインポート**
   - オーナーが過去データ（約3万件）をExcelから一括インポートしたい
   - 列構成は未確認。実装前に列構成の確認が必要

3. **MIRRAテーブルの削除**
   - Supabaseに別アプリ（MIRRA）のテーブルが混在
   - 対象: `appointments`, `conversations`, `customers`, `karte`, `salons`

4. **ボトムナビ下の余白（未解決）**
   - iOSのPWAでホームバー下にわずかな余白が残る
   - `body/html { background: var(--ink) }` で視覚的には目立たなくなっている
   - `env(safe-area-inset-bottom)` がPWAで正しく取れていない可能性あり
   - PWAをホームから削除→再追加で解消するか未確認

---

## 開発メモ

- **Claude Codeより会話型Claudeで開発** - スマホ・iPadのみで開発しているためCLIなし
- PATは都度発行・失効はオーナーが手動で行う（fine-grained PAT推奨）
- Supabaseのスキーマ変更は必ずSQL Editorで実施後にコードを変更する順番で
- `team_members`テーブルは`id`カラムがないので注意（`(team_id, user_id)`で識別）
- RLS変更時は再帰に注意。`SECURITY DEFINER`関数で回避するパターンを使うこと
- `db.js` の `_allTeams` キャッシュは `updateTeam()` / `leaveTeam()` 時にリセット済み
- CSS と JS で同じプロパティを管理すると競合する（ghost opacity の教訓）
- `body` の背景色を変えるときは必ず `#main` の背景色も明示すること

---

## 変更履歴

### 2026-05-30（セッション1）
- **fix**: `settings.js` role判定をアクティブチームベースに修正
- **fix**: モバイルヘッダーを1行に圧縮（ロゴ + 月ナビ + アバター）
- **feat**: viewerロールの編集制限を実装
- **feat**: チーム名カスタマイズ機能
- **feat**: 月切り替えをスライドカルーセルに変更

### 2026-05-30（セッション2）
- **feat**: ghostパネルに隣月の実データを表示（キャッシュから取得）
- **feat**: 月ラベルにスライドアニメーション（方向連動）、固定幅化で位置揺れ解消
- **feat**: ドラッグ中ヘッダーに方向ラベル表示（`5月 → 6月`）
- **refactor**: 設定画面を2セクション構造に刷新
- **feat**: メンバー管理をボトムシート化（削除2段階確認・権限変更カード選択式）
- **feat**: 口座並び替え↑↓ボタン（sort_order正規化方式）
- **fix**: ghost opacity をJS完全管理に統一
- **fix**: ghost DOM順序を `insertBefore` でcontentより背後に
- **fix**: スワイプ判定を厳格化（閾値12px・横が縦の2倍以上）
- **fix**: タグ保存後にキャッシュで消える問題
- **fix**: 保存直後のタグ表示・タップ編集（`patchAddRecord`刷新）
- **fix**: チーム名更新エラー（`ownTeamId`を明示的に渡す）
- **fix**: 保存後にsave-barが残る問題（二重closeModal削除）
- **fix**: 口座選択シートのヘッダー固定
- **fix**: iOS PWA ダブルタップズーム無効化
- **fix**: touchend縦スクロール判定時のghost残り問題
- **fix**: `body/html` 背景を `var(--ink)` に、`#main` 背景を `var(--stone)` に明示

### 2026-05-30（セッション3）
- **fix**: ボトムナビ下余白を `3cfd80d` のCSS/JSを復元して解消（css/style.css・js/app.js のみ差し替え、機能系ファイルは無変更）
- **fix**: `DB.updateTeam()` の `.single()` を削除（複数行返却時の `Cannot coerce the result to a single JSON object` エラー解消）
- **fix**: `settings.js` の `ownTeam` JOINが配列で返る場合に `[0]` を取るよう正規化
- **wip**: チーム名変更後の画面反映（保存は成功するがUI更新が効いていない・未解決）

### ボトムナビ鉄則（セッション3で学んだこと）
- `#main { height: 100dvh }` はモバイルメディアクエリ内に**必須**。削除すると起動直後フッターがずれる → **絶対に触らないこと**
- `overscroll-behavior: none` → フッターが下にずれた
- `window.innerHeight` で `--app-h` をセット → 同上
- `#main { flex: 1 }` → 同上
- 上記3つはすべて試して失敗。再実装しないこと
- 安定状態のコミット: `3cfd80d`（`css/style.css` / `js/app.js`）

### チーム名反映問題（未解決・次回調査ポイント）
- `DB.updateTeam()` 自体は成功（トーストは表示される）
- `_allTeams` キャッシュは `null` リセット済み
- `renderSettings()` 再呼び出し後も古い名前が表示される
- 調査ポイント: `getAllTeams()` の `teams:team_id(id,name)` JOINがSupabaseのスキーマキャッシュにより古い値を返している可能性。`?select=` クエリをブラウザのNetworkタブで確認すること

### 2026-05-30（セッション4）
- **fix**: チーム名変更後のUI反映（3層構造のバグを解消）
  - 第1層: `renderSettings`の再描画でcatchが握り潰していた → DOM直接更新に変更
  - 第2層: `getTeamById`がRLSエラーで失敗 → catchが`cachedTags.length > 0`条件で無視
  - 第3層: `teams`テーブルにUPDATE RLSポリシーがなくDB書き込みが静かに失敗していた
  - Supabase SQL Editorで`is_team_owner()`関数と`team_owners_can_update_teams`ポリシーを追加
- **fix**: `updateTeam()`で0件更新を検知してエラーにする（SupabaseのRLS静かな失敗対策）
- **feat**: チーム名をヘッダー切り替えボタン・参加中チームに反映（オーナー名はサブテキストへ）
- **fix**: コンテンツ少ない時のiOSバウンス問題（`overscroll-behavior-y: contain` + 境界`preventDefault`）
- **fix**: 月ラベル固定幅化で揺れ解消（`min-width`→`width: 96px`）+ 全画面フォントサイズ15pxに統一

---

## SupabaseのRLS「静かな失敗」パターン

**重要**: SupabaseはRLSで更新が弾かれても`error`を返さず、`data: []`を返す。トーストが出ても書き込めていない可能性がある。

**対処パターン（必ずこの形で書く）:**
```js
const { data, error } = await supabase
  .from('some_table')
  .update(payload)
  .eq('id', id)
  .select(); // ← 必須
if (error) throw error;
if (!data || data.length === 0) throw new Error('更新が拒否されました（RLS）');
```

**バグ切り分けの方法:**
- トーストが出た → 「例外は起きていない」だけがわかる（DB書き込み成功の証拠ではない）
- リロード後も変わらない → DBに書き込めていないと確定（フロント問題ではない）
- この2つが同時 → RLSか権限の問題をまず疑う

**RLSポリシー追加時の注意:**
- `IN (SELECT ...)` はポリシー式に使えない（`set-returning functions are not allowed`エラー）
- `SECURITY DEFINER`関数を作って`is_team_owner(id)`のような形で使うこと
- `my_all_team_ids()`もset-returning functionなのでSELECTポリシーに直接使えない場合がある

**現在追加済みのSupabase関数:**
- `is_team_owner(p_team_id uuid)` → 自分がそのチームのownerかbooleanで返す

**現在追加済みのRLSポリシー（teamsテーブル）:**
- `team_owners_can_update_teams`: `is_team_owner(id)` でownerのみUPDATE可
