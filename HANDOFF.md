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
│   ├── router.js       # ページルーター
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
- ヘッダーの月ナビ下に表示（複数チーム所属時のみ）
- `🏠 個人` / `👥 [オーナー名]` のボタン形式

### 設定画面の分岐
- **ownerの場合**: パートナー一覧 + 招待リンク発行
- **memberの場合**: 参加中チーム表示（オーナー名・権限） + 脱退リンク

### 脱退フロー
- 「このチームから脱退する」テキストリンク → 確認モーダル → 「脱退する」と入力 → 脱退
- 脱退後は自動的に自分のチームに戻る

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

## 既知の未完了タスク

### 🔴 バグ・未完成

1. **settings.jsのrole判定が壊れている**
   - `renderSettings()`で`getMyRole()`を`getAllTeams()`ベースに変更中だが途中
   - `getTeamMemberProfilesForTeam()`をdb.jsに追加済みだが、settings.jsへの組み込みが未push
   - 症状：遠藤政宗（招待側）が「個人」チームを見ているとき、設定画面がオーナー用表示になる

2. **ヘッダーレイアウト未変更**
   - 要望：月ナビをロゴと同じ行（右側）に配置してヘッダーを1行に圧縮
   - 現状：ロゴ行 + 月ナビ行 + チーム切り替え行の3行構成
   - チーム切り替えは月ナビと同じ行でよい

### 🟡 設計済み・未実装

3. **viewerロールの記録制限**
   - DBのroleに`viewer`を追加済みだが、実際の編集制限ロジック未実装
   - 閲覧のみユーザーが記録追加・編集・削除できてしまう状態

4. **チーム名のカスタマイズ**
   - 現状チーム名はGoogleアカウントの表示名が入っている
   - ユーザーが「遠藤家」などに変更できるべき

### 🟢 次フェーズ候補

5. **Excelインポート**
   - オーナーが過去データ（約3万件）をExcelから一括インポートしたい
   - 列構成は未確認

6. **MIRRAテーブルの削除**
   - Supabaseに別アプリ（MIRRA）のテーブルが混在
   - パートナー招待前に削除推奨
   - 対象: `appointments`, `conversations`, `customers`, `karte`, `salons`

---

## iOS PWA 対応メモ

- `user-select: none` を全体に適用済み（長押しメニュー抑制）
- キーボード表示はダミーinput（`#ios-focus-trick`）を同期的にfocusしてから非同期処理
- クリップボードAPIが失敗する場合はWeb Share APIにフォールバック
- `navigator.clipboard.writeText`はHTTPSかつユーザー操作直後のみ動作

---

## 開発メモ

- **Claude Codeより会話型Claudeで開発** - iPadのみで開発しているためCLIなし
- PATは都度発行・使用後は失効（fine-grained PAT推奨）
- Supabaseのスキーマ変更は必ずSQL Editorで実施後にコードを変更する順番で
- `team_members`テーブルは`id`カラムがないので注意（`(team_id, user_id)`で識別）
- RLS変更時は再帰に注意。`SECURITY DEFINER`関数で回避するパターンを使うこと
