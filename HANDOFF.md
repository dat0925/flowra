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
├── css/
│   └── style.css       # 全スタイル（CSS変数でテーマ管理）
├── js/
│   ├── app.js          # エントリポイント・ルーティング・共有UI
│   ├── db.js           # Supabase全操作（唯一のDB層）
│   ├── auth.js         # 認証処理
│   ├── cache.js        # IndexedDB キャッシュ層
│   ├── router.js       # ページルーター・月カルーセル
│   ├── dashboard.js    # ホーム画面
│   ├── records.js      # 記録一覧
│   ├── add-record.js   # 記録追加モーダル
│   ├── edit-record.js  # 記録編集
│   ├── accounts.js     # 口座管理
│   ├── settings.js     # 設定画面
│   ├── onboarding.js   # 初回オンボーディング
│   ├── sound.js        # 操作音
│   ├── utils.js        # 共通ユーティリティ（openModal等）
│   └── config.js       # Supabaseクライアント初期化
└── sw.js               # Service Worker
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

### `transactions`
収支記録
- `id`, `team_id`, `type`（income/expense/transfer）, `amount`, `account_id`, `to_account_id`, `date`, `memo`, `created_by`, `updated_by`, `created_at`

### `transaction_tags`
記録とタグの中間テーブル
- `transaction_id`, `tag_id`

### `tags`
カテゴリタグ
- `id`, `team_id`, `name`, `color`, `icon`

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
- 2行目: `🏠 個人` / `👥 [オーナー名]` のボタン形式（名前が長い場合は省略表示）

### 設定画面の分岐
- **ownerの場合**: パートナー一覧 + 招待リンク発行 + チーム名編集
- **memberの場合**: 参加中チーム表示（オーナー名・権限） + 脱退リンク
- role判定は**アクティブチームのrole**で行う（`getAllTeams()`からactiveTeamIdで絞り込み）

### 脱退フロー
- 「このチームから脱退する」テキストリンク → 確認モーダル → 「脱退する」と入力 → 脱退
- 脱退後は自動的に自分のチームに戻る

### viewerロール制限
- `+`ボタン（記録追加）を非表示
- 記録タップ時のシートを「閲覧のみ」モードで表示（タイトル変更・保存/削除/複製ボタン非表示）
- チーム切り替え時に `applyViewerMode()` を再実行して状態を同期

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

---

## 月カルーセル（router.js）

モバイルでの月切り替えをスライドカルーセルで実装。

### 構造
- `#content-carousel`（overflow:hidden ラッパー）の中に `#page-content` を配置
- ghost パネル（`#ghost-prev` / `#ghost-next`）を動的生成してドラッグ時に隣月をのぞかせる

### 動作
- **ドラッグ中**: コンテンツが指に追随。反対側からghostパネルがのぞく
- **離したとき**: しきい値（28%）超えでスライド完了 → `MonthState.next()/prev()` → 新コンテンツが逆側からスライドイン
- **軸ロック**: 横スワイプ確定後は `e.preventDefault()` で縦スクロールを完全封鎖（`passive:false`）
- **< > ボタン**: `_slideMonth()` を呼び出し、ボタン操作でも同じアニメーション
- 未来月への制限なし（将来日付の記録も閲覧可能）

---

## iOS PWA 対応メモ

- `user-select: none` を全体に適用済み（長押しメニュー抑制）
- キーボード表示はダミーinput（`#ios-focus-trick`）を同期的にfocusしてから非同期処理
- クリップボードAPIが失敗する場合はWeb Share APIにフォールバック
- `navigator.clipboard.writeText`はHTTPSかつユーザー操作直後のみ動作

---

## 既知の未完了タスク

### 🟢 次フェーズ候補

1. **Excelインポート**
   - オーナーが過去データ（約3万件）をExcelから一括インポートしたい
   - 列構成は未確認。実装前に列構成の確認が必要

2. **MIRRAテーブルの削除**
   - Supabaseに別アプリ（MIRRA）のテーブルが混在
   - パートナー招待前に削除推奨
   - 対象: `appointments`, `conversations`, `customers`, `karte`, `salons`

---

## 開発メモ

- **Claude Codeより会話型Claudeで開発** - iPadのみで開発しているためCLIなし
- PATは都度発行・失効はオーナーが手動で行う（fine-grained PAT推奨）
- Supabaseのスキーマ変更は必ずSQL Editorで実施後にコードを変更する順番で
- `team_members`テーブルは`id`カラムがないので注意（`(team_id, user_id)`で識別）
- RLS変更時は再帰に注意。`SECURITY DEFINER`関数で回避するパターンを使うこと
- `db.js` の `_allTeams` キャッシュは `updateTeam()` / `leaveTeam()` 時にリセット済み

---

## 変更履歴

### 2026-05-30
- **fix**: `settings.js` role判定をアクティブチームベースに修正（`allTeams.find` → `activeTeamId`で絞り込み）
- **fix**: モバイルヘッダーを1行に圧縮（ロゴ + 月ナビ + アバター）、チーム切り替えは2行目
- **feat**: viewerロールの編集制限を実装（`+`ボタン非表示・編集シートを閲覧のみモードに）
- **feat**: チーム名カスタマイズ機能（設定画面 → チーム名行タップ → ボトムシートで編集）
- **fix**: 未来月への月ナビ制限を撤廃
- **feat**: 月切り替えをスライドカルーセルに変更（ドラッグ・ghostパネル・軸ロック実装）
- **fix**: 横スワイプ確定後の縦スクロールロック（`passive:false` + `e.preventDefault()`）
