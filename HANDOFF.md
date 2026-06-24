# Flowra 引き継ぎドキュメント

最終更新: 2026-06-24

---

## 🐛 バグ修正: PWA起動時にナビ下部に空白が生じる問題（2026-06-24）

**事象**: iOS PWA（ホーム画面から起動）で、アプリ起動直後にボトムナビゲーションの
下に黒い空白が現れる。画面を軽くスワイプすると正常な表示に戻る。

**根本原因（`100dvh` の初期値ズレ）**:
iOS SafariのPWAモードでは、`100dvh`（Dynamic Viewport Height）が
起動後の最初の1フレームで「実際の表示領域より少し大きい値」を返すことがある。
この差分が画面下に積み重なり黒い空白として見えていた。
「スワイプで直る」のは、スクロールイベントで `window.innerHeight` が
再計算されて正しい値に更新されるため。

**副原因（旧SW残存）**:
以前の改修でSWが書き換えられた際、`activate` に `clients.claim()` がなく
旧SWがキャッシュを握り続けていた。これ単体では空白の直接原因ではないが
古いファイルを配信し続けるリスクがあった。

**修正**（`sw.js` / `css/style.css` / `js/app.js`）:
1. `sw.js` の `activate` に `e.waitUntil(clients.claim())` を追加
   → 新しいno-op SWが即座に全クライアントを掌握し旧SWを追い出す
2. `js/app.js` に `_setAppH()` 関数を追加
   ```javascript
   function _setAppH() {
     document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
   }
   _setAppH(); // 起動時に即セット
   window.addEventListener('resize', _setAppH);
   // visualViewport.resize でも更新（キーボード開閉対応）
   ```
3. `css/style.css` の `#app` / `#sidebar` / `#main` の height に
   `var(--app-h, 100dvh)` を追加（`100dvh` の次行に記述）

**なぜ他の修正では直らなかったか**:
`position:fixed` への変更・`padding-bottom` 調整・キャッシュバスター追加は
すべて症状への対処。`100dvh` という根本の数字がズレていたため、
何をしても起動時の最初のフレームだけ空白が残り続けていた。

**今後の注意**:
- `sw.js` に `fetch` ハンドラ（キャッシュロジック）を追加する場合は
  必ず `activate` に `clients.claim()` を含めること
- viewport高さは `100dvh` だけに頼らず `--app-h` 変数経由で管理する設計を維持

---

## ⏪ リバート: 残高「現在時点」補正機能を取り消し（2026-06-23）

**経緯**: 2026-06-22 に「残高を今日時点に正す／月末予定を表示する」機能を実装したが、
翌日リバートした。理由は以下のとおり。

**なぜ合わなかったか（根本的なユーザーモデルの不一致）**:
Flowraは手動入力アプリであり、ユーザーは「日付」を「お金が動いた日」ではなく
**「この支出をどの月の予算に計上するか（予算月）」** として使っている。
例: 6月末に買った翌月分の食料ストックを、意図的に7月の日付で登録する。
この運用では「未来日 = まだ動いていないお金」ではなく「来月の予算に属するお金」を意味する。
MF・Zaimが未来取引を反映しない設計を取れるのは**銀行自動連携**が前提だからで、
完全手動入力のFlowraでは前提が異なる。

**発生していた副作用**:
- 「予算月として未来日を使う」ワークフローが壊れた
- キャッシュ表示→projection補正への切り替えで数字が一瞬ちらつく
- 未来振替が当月外の場合（例：7/10の振替は6月末予定に出ない）にユーザーが混乱
- コードの複雑度が増した（projection.js新規・db.jsクエリ追加・両画面に非同期パッチ）

**正しい長期解**:
「取引日」と「計上月（予算月）」を分離したフィールドを設ける。
ただし大きな設計変更のため今回は見送り、シンプルな即時反映に戻した。

**リバートで消えたもの**:
- js/projection.js（削除）
- js/db.js の getTransactionsAfter() 追加分
- js/accounts.js の残高補正・月末予定表示ロジック
- js/dashboard.js の patchTotalProjection() と import
- なお renderAccountsContent が並び替え後に proj なしで再描画する潜在バグ（旧297行目）は
  リバートで自動解消（projection 機能に依存したバグだったため）

---

## 🐛 バグ修正: 口座選択ピッカーで最下部の口座が選択できない（2026-06-22）

**事象**: 記録追加（振替）の「移動先の口座」ピッカーで、リスト一番下の口座が下部の
「キャンセル / 保存する」バーに隠れてタップできない。スクロールしても戻り（バウンド）で再び隠れる。

**原因**: 口座選択ピッカー（`#acct-picker-sheet` / `#acct-picker-for-edit`）が`z-index:700`で、
記録フォームのフッター`#save-bar`（`position:fixed; z-index:1000`）より**下のレイヤー**だった。
そのためsave-barがピッカー最下部に覆いかぶさっていた。加えてadd側はリスト下paddingが`32px`しかなく、
save-barの高さ＋セーフエリアを逃がせずスクロールしても隠れていた。

**対応**:
- ピッカーの`z-index`を`700`→`1100`に変更（save-bar(1000)より前面へ）。`js/add-record.js`・`js/edit-record.js`両方。
- リスト下部paddingに`env(safe-area-inset-bottom)`を加味（add: `32px`→`calc(40px + safe-area)`、edit: `120px`→`calc(120px + safe-area)`）。
- z-index序列の確認: トースト`9000` / スプラッシュ`9999`はピッカー`1100`より上に残るため競合なし。

### ♻️ リファクタ: 口座選択ピッカーを共通モジュールに集約（2026-06-22）

上記バグは「同じ口座ピッカーのコードが`add-record.js`と`edit-record.js`に重複しており、
片方だけ直すと不整合になる」構造が遠因だったため、続けて共通化した。

- 新規 `js/account-picker.js` を作成し、`showAccountPicker({ accounts, currentId, title, onSelect })`
  をexport。両画面はこれをimportして呼ぶだけにした。
- 重複していた`TYPE_PATH`/`TYPE_COLOR`/`TYPE_BG`と`fmt`は共通モジュール側に集約し、各ファイルから削除。
  色定義は両者の**完全版（`savings`の色・背景を含む方）**に統一したため、add画面でも貯蓄系口座が
  グレーではなく緑系で表示されるようになった（軽微なUI改善）。
- 呼び出しは引数オブジェクト方式に変更。タイトルは単一/出元=「口座を選択」、移動先=「移動先の口座」。
  edit画面の移動先も従来「口座を選択」だったのを「移動先の口座」に統一。
- 差分: 2ファイルで +14 / −156行。今後ピッカーを直すときは`js/account-picker.js`の1箇所だけでよい。
- 注意: `account-picker.js`は`type="module"`のimportで自動取得される（index.htmlへの`<script>`追加は不要）。


## ✅ Stripe 本番移行（2026-06-18 完了）

2026-06-18にユーザー確認のもと本番移行完了。当初このチェックリストは「LPのPayment Linkがまだサンドボックス」という前提で書かれていたが、確認した時点で`lp/index.html`のリンク（`https://buy.stripe.com/00w00i1Rx4Lwbmy2c3fQI02`）に`test_`プレフィックスが付いていない（本番形式）ことに気づき、本人に確認したところ「ストライプは本番決済移行完了」と回答を得た。下記は完了済みの手順として記録として残す。

Stripe サンドボックス → 本番切り替え手順（実施済み）：

1. **Stripe ダッシュボード（本番モード）**
   - 商品・料金プランを新規作成（サンドボックスの商品は本番に引き継がれない）
   - Webhook エンドポイントを登録（URL同じ・イベント同じ）
   - カスタマーポータルを有効化（設定 → Billing → Customer portal → 有効化）

2. **Supabase Secrets を本番用に差し替え**（4つ）
   | キー | 変更内容 |
   |------|---------|
   | `STRIPE_SECRET_KEY` | `sk_test_...` → `sk_live_...` |
   | `STRIPE_PREMIUM_PRICE_ID` | 本番で作った Price ID に |
   | `STRIPE_WEBHOOK_SECRET` | 本番 Webhook 登録後の `whsec_...` に |
   | `SB_ANON_KEY` | そのまま（変更不要） |
   | `SB_SERVICE_ROLE_KEY` | そのまま（変更不要） |

3. **LP の Payment Link を差し替え**
   - `lp/index.html` の `buy.stripe.com/test_...` を本番 Payment Link（`buy.stripe.com/00w00i1Rx4Lwbmy2c3fQI02`）に変更済み

4. **Edge Functions を再デプロイ**（Secrets 変更後は必須）
   - `stripe-webhook`
   - `stripe-portal`

5. **テストデータのクリーンアップ**
   - `user_plans` テーブルのテスト決済で作られた Stripe Customer ID を削除 or 本番 ID に差し替え（要確認: 完了済みか未確認）

### ⚠️ インシデント: 本番Webhookエンドポイントが未登録だった → 実は4層のバグが重なっていた（2026-06-18）

Stripeから「Taskraアカウントに関連付けられたWebhookエンドポイントへの送信に失敗し続けている」という
メールが届いた。メール本文の「Taskraアカウント」はStripeアカウント名（複数アプリで共通の
Stripeアカウントを使っているため）であり、記載されたURL（`copyzpsyagscqrvkrwjo.supabase.co/...`）から
Flowraの話だと判断した。

調査・対応する過程で、根本原因が1つではなく**4層重なっていた**ことが分かった。1つ直しても次の層で
別のエラーが出る、という形で発覚していった。

1. **本番（Live）モードの送信先（Webhookエンドポイント）がそもそも1件も登録されていなかった**
   - 本番移行チェックリストの「Webhookエンドポイントを登録」が実施されていなかったと見られる
   - 対応: 新規にWebhookエンドポイントを作成
     - URL: `https://copyzpsyagscqrvkrwjo.supabase.co/functions/v1/stripe-webhook`
     - イベント: `checkout.session.completed` / `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`

2. **`user_plans`テーブルに`stripe_customer_id`列が存在しなかった**
   - `stripe-webhook`のコードは決済完了時に`stripe_customer_id`を書き込み、解約・プラン変更時はその列で
     検索する前提だが、列自体が無いため更新が失敗していた。コードが`if (error) console.error(...)`で
     処理を止めない作りだったため、**Stripeには200 OKが返るのに実際の更新は静かに失敗する**状態だった
   - Taskra側の実装を流用した際、Flowra側のテーブル作成でこの列を作り忘れたのが原因と見られる
   - 対応: `ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS stripe_customer_id text;`

3. **SupabaseのJWT検証（Verify JWT）がデフォルトで有効になっていた**
   - StripeはSupabase独自の認証トークンを知らないため、`stripe-webhook`のコードが実行される前に
     Supabaseのゲートウェイ自体に401（`UNAUTHORIZED_NO_AUTH_HEADER`）で弾かれていた
   - 対応: Edge Functions → `stripe-webhook` → Settings → 「Verify JWT with legacy secret」をOFFに変更

4. **`STRIPE_WEBHOOK_SECRET`が新しいエンドポイントの署名シークレットと一致していなかった**
   - 上記1〜3を直した後も400エラー（`No signatures found matching the expected signature`）が発生
   - 対応: Webhookエンドポイントの「署名シークレット」（`whsec_...`）を再コピーし、Supabase Secretsの
     `STRIPE_WEBHOOK_SECRET`を上書き→`stripe-webhook`を再デプロイ

最終的に「再送する」で`customer.subscription.deleted`イベントが「送信済み（回復済み）」となり、
`kyoka.endo1006@gmail.com`の`user_plans`が`plan=free`・`stripe_customer_id`に実際のIDが入った状態に
正しく更新されたことを確認して解決。残っていた約25件の失敗イベントはStripeが自動で再送するため、
追加対応は不要と判断。

### ⚠️ インシデント: 決済済みなのに設定画面がFree表示 → データ復旧＋Webhook強化（2026-06-19）

**事象**: `kyoka.endo1006@gmail.com`（梗華さん・パートナー兼テスター）がPremiumを決済済みなのに、
アプリの設定画面がFreeのままだった。

**調査の流れ（再現性のため記録）**:
1. `user_plans`を`auth.users`とJOINして梗華さんの行を確認 → **No rows**（彼女のプラン行が存在しない）
2. `auth.users`単体では`kyoka.endo1006@gmail.com`（id: `cbae1645-afd5-4a7b-82fa-f96e48653857`）は実在・メール完全一致
3. `user_plans`全行を確認 → 彼女のuser_idの行は無く、`cus_UjHLQd14dBkMQZ`は**管理者**（`mstd0520@gmail.com` / `6fa4c2af…`）の行に紐付いていた
4. `auth.users`は全4人 → emailフォールバックの「listUsers先頭50件問題」は否定
5. Stripe本番モードを確認:
   - `cus_UjHLQd14dBkMQZ` は**管理者本人**の顧客（6/19にテスト決済したもの）。梗華さんのではない
   - Stripe顧客検索で`kyoka.endo1006@gmail.com`が**複数ヒット**（同一メールで顧客が乱立）
   - 「アクティブ」フィルタのサブスク一覧で有効サブスクは**2件のみ**: 管理者（`cus_UjHLQd14dBkMQZ`・6/19）と
     梗華さん（`cus_UgiTBsh99FQVm7`・6/12開始・MRR¥398）
   - 梗華さんの有効サブスクは`cus_UgiTBsh99FQVm7`の**1件だけ**（二重課金なし）

**根本原因**: 梗華さんのサブスクは**6/12作成**だが、本番Webhookエンドポイントは**6/18まで未登録**だった
（上記「本番Webhookエンドポイントが未登録だった」インシデント参照）。つまり彼女の
`checkout.session.completed`は配信先が無く取りこぼされ、`user_plans`に行が作られなかった。
コードのバグではなく**Webhook登録前の欠落**。

**データ復旧手順（実施済み）**:
```sql
-- 梗華さんの行を作成（正しい有効サブスクの cus_ を使用）
insert into user_plans (user_id, plan, stripe_customer_id, expires_at, updated_at)
values ('cbae1645-afd5-4a7b-82fa-f96e48653857', 'premium', 'cus_UgiTBsh99FQVm7', null, now())
on conflict (user_id) do update
set plan='premium', stripe_customer_id=excluded.stripe_customer_id, expires_at=null, updated_at=now();
```
- 管理者はテスト決済を**解約**。解約Webhookで管理者行が`plan=free`に落ちたため、`admin`へ是正:
```sql
update user_plans set plan='admin', stripe_customer_id=null, expires_at=null, updated_at=now()
where user_id='6fa4c2af-ea85-4207-aacc-538f6b481d66';
```

**この件で得た構造的な注意点**:
- **Payment Linkは決済のたびに新規Stripe顧客を作る** → 同一メールで顧客が乱立する。テストを繰り返すと顕著。
  「どれが本物か」の判断は**有効（active）サブスクの数・有無**だけで行えばよい（空の顧客は無視）。
- 顧客の表示名とメールがちぐはぐになることがある（例: カード名義「MASAMUNE ENDO」＋メール`kyoka…`）。
  名前ではなく**メール＋有効サブスク**で判断する。
- `cus_` を `user_plans` に手動で入れる際は、**同じ`stripe_customer_id`が他の行に重複していないか**必ず確認。
  重複すると`subscription.deleted`/`updated`の`.eq('stripe_customer_id', …)`が複数行に当たって事故る。

**Webhook強化（`stripe-webhook/index.ts`・2026-06-19デプロイ済み）**:
- `premium`化の両upsert（checkout / subscription.created）に **`expires_at: null` を明示追加**。
  過去の手動付与で`expires_at`が過去日で残っていると、`getUserPlan`が「期限切れ→free」と誤判定する
  潜在バグを根絶（有料サブスクは無期限・解約は`subscription.deleted`が担当）。
- `user_id`解決失敗時に**静かにbreakせず、session/email/customerを含む詳細をconsole.errorに記録**。
  「決済成功なのに`user_plans`未更新」を後から追えるようにした。
- `client_reference_id`（ログイン中ユーザー）と決済者emailが**食い違う場合にconsole.warn**で可視化
  （挙動はref優先のまま変更なし）。
- emailフォールバックの`listUsers`を**ページ送り対応**（perPage:200で全件走査・将来50人超でも照合可能）。
- `subscription.deleted`を`.select()`付きにし、**どの行にも当たらなかった空振りをconsole.warnで検知**。

**教訓**: `user_plans`は`plan`だけでなく`expires_at`も効く。`expires_at`が過去だと
premiumでもアプリ上freeになる。Webhookで有料化するときは`expires_at`を必ずnullにする。

---

## ⚠️ インシデント: 電卓の小数点ボタンが「記録編集」画面だけ無かった（2026-06-20）

**事象**: 「電卓に小数点があったはずなのに消えている」との報告。改修が上書きされたのではという疑い。

**調査の流れ（再現性のため記録）**:
1. `add-record.js`（記録追加）には小数点ボタン（`calc-dot-btn`）が**存在**していた。一方
   `edit-record.js`（記録編集）には**最初から無かった**。
2. `git log -S "calc-dot-btn"` で追跡したところ、小数点ボタンを追加したコミットは
   **`dd2e8da`（2026-06-10「feat: 電卓に小数点ボタンを追加」）の1件のみ**で、
   変更ファイルは**`js/add-record.js`だけ**だった。`edit-record.js`には一度も入っていない。
3. つまり「上書きで消えた」のではなく、**追加時点から記録編集画面には適用されていなかった**。

**真因**: 電卓キーパッドが`add-record.js`と`edit-record.js`に**ほぼ同一の二重実装**で存在する。
小数点ボタン追加（`dd2e8da`）が片側（追加画面）にしか入らず、もう片側（編集画面）に同期されなかった。
ユーザーは「新規追加では小数点が使えたのに、編集では使えない」のを「消えた」と認識した。
コードの劣化・上書きではなく**重複コードの片側だけ改修したことによる機能差**が原因。

**改修（`edit-record.js`・add-record.js側に合わせて移植）**:
1. キーパッドHTMLに`calc-dot-btn`（`．`）をACの右に追加。
2. `displayAmount()`を小数点対応に（小数があれば`parseInt`せずそのまま表示・計算途中の値を保持）。
3. `input`ハンドラの許可文字を`[^0-9]`→`[^0-9.]`に変更し、小数点の重複入力を1つに正規化。
4. 小数点ボタンのクリックハンドラを追加（既に`.`があれば無視）。
   - 保存処理（`doSave`の`parseInt(state.amount, 10)`）は元から追加画面と同一のため変更不要。
     小数を入力して`＝`を押さず保存した場合は`parseInt`で整数化される（追加画面と同じ挙動）。

**再発防止策**:
- 両ファイルの電卓キーパッド冒頭に**同期必須の警告コメント**を入れた
  （「電卓キーパッドはadd-record.js / edit-record.js の両方に同じ実装がある。片方を変更したら
  必ず両方を同期すること」）。
- **推奨（未実施・要判断）**: 二重実装そのものを解消するため、電卓キーパッドのHTML生成＋
  イベントバインドを共有モジュール（例: `js/calc-keypad.js`）に切り出し、追加・編集の両画面から
  importする構成にするのが根本対策。今回は本番影響を抑えるため最小差分（編集画面への移植＋警告コメント）に留めた。
  共有モジュール化を行う場合は、新規ファイル追加＋2ファイル修正の手動デプロイになる点に注意。

**教訓**: 「金額入力まわり」は追加画面と編集画面で**コードが二重化**している。
電卓・金額入力・タグUIなど両画面に関わる改修をしたときは、**必ずもう一方の画面も開いて同じ修正が
入っているか確認**すること。`git log -S "キーワード"` で「どのファイルに入ったか」を見れば差分に気づける。

> 補足: `sw.js` は現在**無効化済み**（installでskipWaiting・activate空）。
> 過去の「SWバージョンを上げる」手順は現状不要。JS差し替え後はブラウザの通常リロードで反映される。

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
| 決済 | Stripe（サブスクリプション・カスタマーポータル） |

---

## ファイル構成

```
flowra/
├── index.html          # メインHTML（単一ページ）
├── admin.html          # 管理画面（管理者のみアクセス可）
├── manifest.json       # PWA設定（theme-color: #1C2B22）
├── sw.js               # Service Worker
├── lp/
│   └── index.html      # LP（Premiumプランの申し込みボタンあり）
├── css/
│   └── style.css       # 全スタイル（CSS変数でテーマ管理）
├── js/
│   ├── app.js          # エントリポイント・ルーティング・共有UI
│   ├── db.js           # Supabase全操作（唯一のDB層）
│   ├── auth.js         # 認証処理
│   ├── cache.js        # IndexedDB キャッシュ層
│   ├── router.js       # ページルーター・月カルーセル・月ピッカー
│   ├── dashboard.js    # ホーム画面
│   ├── records.js      # 記録一覧
│   ├── add-record.js   # 記録追加モーダル
│   ├── edit-record.js  # 記録編集
│   ├── accounts.js     # 口座管理
│   ├── settings.js     # 設定画面
│   ├── import-notion.js # Notionインポート
│   ├── tag-icons.js    # タグアイコン定義（ICON_REGISTRY 20種・resolveTagIcon）
│   ├── onboarding.js   # 初回オンボーディング
│   ├── sound.js        # 操作音
│   ├── utils.js        # 共通ユーティリティ（openModal/closeModal等）
│   └── config.js       # Supabaseクライアント初期化
└── supabase/
    └── functions/
        ├── stripe-webhook/index.ts  # 決済完了・解約Webhookハンドラ
        ├── stripe-portal/index.ts   # Stripeカスタマーポータル URL生成
        ├── flowra-ai/index.ts       # AIサマリー（Anthropic API）
        └── notion-proxy/index.ts    # NotionインポートCORSプロキシ
```

---

## Stripe 決済設計

### 概要
- 月額 ¥398 の Premium プラン（サブスクリプション）
- Payment Link 経由で決済（LP から遷移）
- 決済完了 → Webhook → `user_plans` テーブル更新の流れ

### Supabase Secrets（必須・全て登録済み）
| キー名 | 用途 |
|--------|------|
| `STRIPE_SECRET_KEY` | Stripe API キー（`sk_test_...` or `sk_live_...`） |
| `STRIPE_PREMIUM_PRICE_ID` | PremiumプランのPrice ID |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名検証シークレット（`whsec_...`） |
| `SB_SERVICE_ROLE_KEY` | Supabase service_role key（RLSバイパス用） |
| `SB_ANON_KEY` | Supabase anon key（JWT検証用） |

### Edge Functions
| 関数名 | 用途 |
|--------|------|
| `stripe-webhook` | `checkout.session.completed` / `customer.subscription.*` を受け取り `user_plans` を更新 |
| `stripe-portal` | ログインユーザーの Stripe カスタマーポータル URL を生成 |

### ⚠️ 重要な設計ルール
- `user_plans` テーブルは **`user_id`** カラムで管理（`email` カラムは存在しない）
- `stripe-webhook` は `client_reference_id`（= Supabase user_id）を優先取得。なければ email → `auth.admin.listUsers()` でフォールバック
- `stripe-portal` は `user_id` で `stripe_customer_id` を検索。なければ Stripe で新規作成して upsert
- LP の Payment Link は `?client_reference_id=USER_ID` を JS で動的付加（ログイン済みの場合のみ）
- **Edge Function の Secrets を変更したら必ず再デプロイすること**（変更しても再デプロイしないと反映されない）

### Stripe サンドボックス情報
- 商品名: `Flowra プレミアム` / ¥398/月
- 商品ID: `prod_Udfx7VbHRvrd4a`
- Price ID（テスト）: `price_1TeObDB5e5DORDCypOnurrsf`
- Payment Link（テスト）: `https://buy.stripe.com/test_7sY6oG72Y43J0Yp72rds402`
- Webhook ID: `we_1TgDDrBNAV5e5rhczkYylZ22`
- Webhook URL: `https://copyzpsyagscqrvkrwjo.supabase.co/functions/v1/stripe-webhook`

### カスタマーポータル
- Stripe ダッシュボード → 設定 → Billing → Customer portal で有効化が必要
- サンドボックスは「テスト環境のリンクを有効化」ボタンで有効化済み
- 本番切り替え時は本番モードで同様に有効化すること

### プラン管理の仕組み
- `user_plans` テーブルのカラム: `user_id`, `plan`（free/premium/admin）, `stripe_customer_id`, `expires_at`, `updated_at`
- 解約時: Webhook が `customer.subscription.deleted` を受け取り `plan = 'free'` に自動更新
- 設定画面: プランバッジ（Free / ✦ Premium）を表示。「管理」ボタンでカスタマーポータルへ遷移

---

## admin.html（管理画面）

- URL: `https://flowra.taskra.jp/admin.html`
- アクセス: `ADMIN_USER_IDS` 配列に一致したユーザーのみ（現在: `6fa4c2af-ea85-4207-aacc-538f6b481d66`）
- **セッション復元**: admin.html は index.html と別クライアントのため、localStorage からトークンを取得して `setSession()` で明示的に復元している
- **`get_all_user_plans` RPC**: `SECURITY DEFINER` が必須。ないと `auth.uid()` が NULL になり全員 free に見える
- 機能: ユーザー一覧・プラン表示・プラン手動変更・AI使用量統計
- Premiumカウント: `plan === 'premium'` のみカウント（admin は除外）
- プルトゥリフレッシュ: 上部から下スワイプで更新

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
- **重要**: `amount` に `CHECK (amount >= 0)` 制約あり。マイナスレコードは挿入不可（0円はOK）

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
- 受け取るデータ: `{ question, data: { year, month, income, expense, tagBreakdown, budgets, prev..., avgIncome } }`
- 質問タイプ: `monthly`（今月評価）/ `compare`（先月比）/ `saving`（節約ヒント）/ `free`（チャット形式の自由質問・直近3ヶ月の全取引データをそのままプロンプトに含むため最も重い）
- 自動一言（monthly）は既存データ＋過去3ヶ月の平均収入（`avgIncome`、`estimateAvgIncome()`で算出）を使用（budgets:[]、prev:0）
- ボタン押下時は先月データ・予算データも取得して詳細プロンプトを構築

### ⚠️ AIアドバイスの精度改善：給料未入金による誤判定（2026-06-18）

**経緯**: 6/18（給料が20日入金の家庭で、まだ収入¥24,284しかない状態）に、自動一言アドバイスが
「収入に対して大きな赤字」と断定するコメントを出していた。実際は給料がまだ入金されていないだけで、
赤字ではない。

**原因**: AIに渡していた情報が「今月ここまでの収入・支出」と「月の何%が経過したか」だけで、
「この家庭は通常どれくらいの収入があるか」という基準値が無かった。この情報量では、月の途中で
収入が少ないことを「異常（赤字）」と「正常（まだ入金前）」のどちらとも判断できない。
プロンプトの文言を直すだけでは本質的な解決にならない（曖昧な回答になるだけ）ため、
AIに渡すデータ自体を拡充する方針で修正した。

**修正内容**:
- `js/dashboard.js`: `estimateAvgIncome(year, month)` を追加。過去3ヶ月の確定済み月収入
  （0円の月は記録漏れの可能性として除外）の平均を計算し、自動一言（`monthly`）呼び出し時に
  `avgIncome` として渡すように変更。
- `supabase/functions/flowra-ai/index.ts`: `avgIncome` を受け取り、
  (1) `monthly`プロンプトに「過去の月平均収入は¥◯◯◯程度です」を追記、
  (2) 今月収入が平均の半分未満かつ月末でない場合は「赤字と断定せず入金タイミングの可能性を踏まえて
  コメントする」よう明示的に指示するルールをシステムプロンプトに追加。
  ⚠️ **Edge Functionの変更はSupabaseダッシュボードから手動デプロイが必要**（CLI不可の制約）。

### ⚠️ AIアドバイスの精度改善：月末の黒字を楽観的に過大予測（2026-06-20）

**経緯**: 6/20（給料20日入金済み・収入¥456,787／支出¥293,370・黒字¥163,417）の自動一言が
「現在のペースなら月末までに約26万円の黒字が見込める」と、**黒字が今より増える方向**に予測していた。
実際は給料が入りきっており、ここから増えるのは支出だけなので、月末の黒字はむしろ縮む。
上記2026-06-18の「給料未入金→誤って赤字判定」と**同じ根本原因（まとまった入金と、月を通して発生する
支出のタイミング非対称）が、逆方向（過度な楽観）に出た**ケース。

**原因（プロンプト側の2点）**:
1. **指示の矛盾**: システムプロンプトは「月途中なら予測しない」と言う一方、月中盤の`monthContext`が
   「現時点のペースをもとにコメントすること」と指示しており、モデルが後者を採用して黒字を引き延ばし予測した。
2. **タイミング非対称の未明示**: 「収入はまとまって入る／支出は月を通して発生する」という前提が
   プロンプトに無く、モデルが収支を一律に日割り外挿して月末を楽観視した。

**修正内容（`supabase/functions/flowra-ai/index.ts`・プロンプトのみ）**:
- `monthContext`の月中盤・月末の文言から「現時点のペースをもとに」「月全体の傾向をコメントしてよい」を削除し、
  「月末の黒字額を金額で予測・断定しない」に統一。
- システムプロンプトに常時ルールを追加:
  (1) 月途中は月末の収支・黒字額を金額で予測・断定しない（「このペースなら月末に約◯◯円の黒字」と言わない）。
  (2) 収入はまとまった入金で特定日に集中する一方、支出は月を通して発生するため、今の黒字を残り日数で
  引き伸ばして月末予測してはいけない。収入が入った後は支出だけが増え、黒字はむしろ縮むのが普通。
- `incomeInNote`を追加: 今月収入が過去平均の0.8倍以上（＝給料がほぼ入りきっている）かつ月末前のとき、
  「現在の黒字を引き伸ばして『月末はもっと黒字』と予測するな・むしろ縮む」を具体数値付きで明示。
  既存の`incomeTimingNote`（収入が平均の半分未満→赤字と断定するな）と対になるガード。
- `dashboard.js`は変更不要（必要な`avgIncome`/`todayDate`/`daysInMonth`は既に渡している）。

⚠️ **Edge Function変更のため、Supabaseダッシュボードから`flowra-ai`を手動再デプロイしないと反映されない。**
⚠️ **既存の自動一言はキャッシュ（`_aiAdviceCache`＋localStorage、年月キー）に残る。** 再デプロイ後に
新挙動を確認するには、ホームの「今月どう？」など**チップボタンを押して再生成**するか、翌月まで待つ。

**教訓**: 収入と支出のタイミング非対称（給料=まとまった入金 / 支出=継続発生）は、月途中の評価で
両方向に誤りを生む（入金前→誤って赤字 / 入金後→誤って楽観）。月末の収支を**金額で予測しない**のが安全。

### ⚠️ AI利用上限の見直し（2026-06-17）

**経緯**: 管理画面でPremiumユーザーが今月409回もAIアドバイスを使っているのを発見。
調査の結果、自動一言アドバイス（ホーム画面読み込み時）が**取得成功後にキャッシュへ保存する処理を欠いていた**ため、
「同じ月ならキャッシュがあれば再呼び出しをスキップする」仕組みが常に空振りし、
ホーム画面に来るたび（タブ切り替えだけでも）AI APIが再実行される不具合があった（`js/dashboard.js`で修正済み）。
Freeプランは月5回上限のため、この不具合だけでホームを5回見ただけで上限に達してしまう実害もあった。

**この調査をきっかけに、Premium上限6,000回の妥当性も再計算した**:
- 旧6,000回は過去の見積り「AI全体の原価は6,000回で¥60〜90/月程度」を前提にしていたが、これは
  システムプロンプト分のトークンなどを見落とした粗い概算だった。
- `@anthropic-ai/tokenizer`（Anthropic公式パッケージ）で実際のプロンプト本文を計測し直した結果：

  | 質問タイプ | 入力トークン | 単価（目安） |
  |---|---|---|
  | monthly（自動一言） | 約538 | 約¥0.14/回 |
  | compare | 約668 | 約¥0.16/回 |
  | saving | 約587 | 約¥0.15/回 |
  | free（取引180件/3ヶ月想定） | 約4,694 | 約¥0.81/回 |

  （Haiku 4.5: 入力$1・出力$5 per Mトークン、$1=¥160換算、出力は実際の回答例から平均65トークン程度で算出）

- `free`タイプはチャット欄に何度でも打ち込める最もコストの高い経路のため、これを基準単価（¥0.81/回）として
  Premium原価率70%を目標に算出: `¥398 × 0.7 ÷ ¥0.81 ≈ 344回` → 300回に設定（実際の原価率は約61%）。
- **300回から200回へ再調整（同日中）**: レシートOCR（月200回上限、最悪ケース約¥0.55/回 ≈ ¥110）も
  同じユーザーが同月に上限まで使い切る可能性を考慮すると、AI300回の最悪ケース（約¥243）と合わせて
  Stripe決済手数料込みの実質収益（¥398-¥14≈¥384）に対して残り¥31しかなく余裕が薄かったため。
  OCRの200回上限と揃え、AI最悪¥162＋OCR最悪¥110＝¥272（残り¥112）に変更。
- **`PREMIUM_AI_LIMIT`を6,000 → 300 → 200に変更**（`js/db.js`）。Freeの5回は変更なし。
- Freeプランの上限見直しは未着手（今後検討）。

**修正範囲**（300回への変更時に、ハードコードされていた古い数値も含めて修正済み。200回への再調整は`js/db.js`・LP各種・本ドキュメントのみ。`js/settings.js`は既にDB定数参照になっているため再修正不要）:
- `js/db.js`: `PREMIUM_AI_LIMIT` 定数本体
- `js/settings.js`: 設定画面の使用量バー（`6000`/`5`をハードコードしていたのをDB定数参照に変更。
  同箇所のレシート上限`100`/`3`も実際の現行値（200/10）とズレていたためDB定数参照に統一）
- `lp/index.html`: AIセクションのバッジ表示・料金プラン比較表・カップル訴求チェックリスト・吹き出しコピー（計4箇所）
- `lp/terms/index.html`: Premiumプラン説明文（AIアドバイス回数。併せてレシート読み取りの記載も古い`100回`→現行`200回`に修正）

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

## お知らせ機能（2026-06-17追加）

Backlogのお知らせ風に、ヘッダーのベルアイコン＋未読バッジ＋ログ一覧を実装。
利用規約第3条で「プラン内容の変更時は本サービス上で事前に告知する」と約束しているため、
今回のAI上限変更のような告知を実際に出せるようにする目的で追加した。

**構成**
- DB: `announcements`テーブル（id, title, body, created_at）。RLSは認証済みユーザーなら誰でもSELECT可。
- 投稿・削除: `create_announcement(p_title, p_body)` / `delete_announcement(p_id)`（admin専用のSECURITY DEFINER RPC、`get_all_user_plans`等と同じ管理者チェックパターン）
- 管理: `admin.html`に「📢 お知らせ管理」セクションを追加（投稿フォーム＋ログ一覧＋削除ボタン）
- アプリ側: `js/announcements.js`が一覧取得・未読バッジ更新・ログパネル表示を担当
  - 既読管理は**端末ごとのlocalStorage**（`flowra_announce_last_seen`）で行う簡易設計。複数端末間で既読状態は同期しない（このアプリの規模なら十分という判断）
  - `index.html`のモバイルヘッダー（`#btn-announce`）・デスクトップトップバー（`#btn-announce-d`）にベルアイコン＋バッジ（`.announce-badge`）を設置
  - `js/app.js`の`showApp()`内で`Announcements.refreshBadge()`を呼び、クリックで`Announcements.openPanel()`（一覧パネルを開く＝既読化）
  - 一覧は1ページ20件（`.range()`によるoffsetページネーション）＋「もっと見る」ボタンで追加読み込み。admin.html側のログも同様にページネーション対応（投稿数が増えても全件を一度に表示し続けない）

**要Supabase側SQL実行**: `supabase_announcements.sql`

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

- `transactions.amount` に `CHECK (amount >= 0)` 制約あり。**インポート時は0円レコードをスキップ必須**（0円データが混入しやすいため）
  - `scanAndCollect` 内: `if (!日付 || 金額 == null || 金額 === 0) continue;`
  - ※アプリ上の新規登録・編集では0円を許可（ポイント値引き等の記録用）
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

### 2026-06-21（口座表示の不整合修正・レシート店名の編集対応）

- **バグ修正: 一覧と編集画面で口座表示が食い違う**（`js/edit-record.js`）。
  記録一覧では口座名が「Suica」と出るのに、その記録を開くと口座が「選択してください」になる事象。
  原因は表示元の違い: 一覧は取引にJOINされた`tx.account.name`（`getTransactions`の
  `account:accounts!account_id(...)`）を使い、**アーカイブ済み口座でも名前が出る**。一方
  編集画面は`DB.getAccounts()`（`is_archived=false`でフィルタ）のリストから`accountId`を
  探すため、アーカイブ済み口座は見つからず placeholder になっていた。取引には口座が
  割り当たっているのに未選択に見え、保存時に「口座を選択してください」で弾かれる恐れもあった。
  - 修正: 編集画面ロード時、取引にJOIN済みの`tx.account`/`tx.to_account`が`accounts`リストに
    無ければ`is_archived:true`として補完する`ensureAccount()`を追加。これで名前が正しく解決され、
    既存の（アーカイブ済み）口座割り当ても保持される。
  - 補足: 「Suica」が表示できている＝RLSでは見えている＝非公開口座の問題ではなく、アーカイブが原因。

- **機能: レシート一括読み取りで店名を編集可能に**（`js/add-record.js`）。
  レシート確認画面（`showReceiptConfirm`）で店名が静的テキスト表示だったため、OCRが店名を
  誤読・未取得でも直せなかった。店名を入力欄（`#receipt-store`）にし、`receiptStore`変数で保持。
  保存時に各品目のメモ `${item.name}（${receiptStore}）` に反映（日付`receiptDate`と同じ設計）。
  店名を空にすれば`（店名）`は付かない。

### 2026-06-21（記録編集画面：メモ内URLをタップ可能に）

- `js/edit-record.js`: 記録編集画面のメモ（`transactions.memo`）にURLが含まれる場合、メモ欄
  （textarea）の直下に、検出したURLを**タップ可能なリンクチップ**として表示するようにした。
  textareaは編集領域のため文字を直接リンク化できない（タップでカーソルが入る）ので、
  `renderMemoLinks()`でURLを正規表現抽出し、`#memo-links`にアンカー（`target="_blank"
  rel="noopener noreferrer"`）をDOM生成して並べる方式。メモ入力時にも再描画。
  - 想定ユースケース: メモにTaskra等のタスクURL（例 `https://app.taskra.jp/#task/...`）を
    貼っておき、記録から元タスクへ飛ぶ。
  - 注意: 追加画面（`add-record.js`）のメモは`<input>`（新規入力用）のため未対応。必要なら同様に移植可能。
  - 既存の`accounts.notes`（口座メモ）のリンク表示とは別実装（対象テーブルが異なる）。

### 2026-06-17〜18（プラン上限の再設計・お知らせ機能・AI精度改善・複数バグ修正）

#### プラン上限の再設計（経緯は本ドキュメント内「AI利用上限の見直し」「精度改善」の各セクション参照）
- 設定画面のプランバッジが多重表示される不具合を修正（`renderSettings()`の多重呼び出しに対するレースコンディションガードを追加）
- 管理画面でAI/OCRの今月利用回数が管理者自身の分しか表示されない不具合を修正（RLSの「静かな失敗」→ 管理者専用RPC `get_all_ai_usage`/`get_all_receipt_usage` を追加。初回実装時に「RETURNS TABLE(user_id ...)による列名あいまいエラー」のバグを踏んだため、`user_plans.user_id`のように必ずテーブル名を明示する教訓を得た）
- 自動一言アドバイスがキャッシュ未保存のためホーム再訪問のたびに再実行される不具合を修正（実害: Premiumユーザーが月409回も消費）
- これを機にPremium AI上限の妥当性を再計算：`@anthropic-ai/tokenizer`で実プロンプトを実測し、旧6,000回 → 300回 → レシートOCRとの同時上限到達リスクを考慮して200回に再調整。`js/db.js`・LP各種・利用規約を修正
- 設定画面のプランバッジでadmin/premiumを区別表示（`✦ Admin` / `✦ Premium`）

#### お知らせ機能を新規実装
- ヘッダーのベルアイコン＋未読バッジ＋ログ一覧（Backlog風）。利用規約第3条の「プラン変更時は事前告知する」を実運用するための機能
- `announcements`テーブル＋管理者専用RPC（`create_announcement`/`delete_announcement`）、admin.htmlに投稿UI、`js/announcements.js`がアプリ側の表示を担当
- 初期実装は直近30件取得のみだったため、`.range()`によるoffsetページネーション（「もっと見る」）を追加

#### リンク切れの修正
- 利用規約・プライバシーポリシーに記載の`support@taskra.jp`が存在しないメールアドレスだったため、お問い合わせフォームへのリンクに変更
- アプリ内のAI上限到達時「Premiumプランに申し込む」ボタンも同じ壊れたmailtoリンクを使っており、Premium申込導線が実質機能していなかった。LPと同じStripe Payment Linkに変更し修正

#### AIアドバイスの精度改善（給料未入金による誤判定防止）
- 月の途中で収入がまだ少ない場合、AIが「収入に対して大きな赤字」と断定してしまう問題を発見・修正
- `estimateAvgIncome()`で過去3ヶ月の平均収入を計算し、`avgIncome`としてAIに渡す。今月収入が平均の半分未満かつ月末でない場合は赤字と断定せず入金タイミングの可能性を踏まえるようプロンプトを調整
- 詳細は「flowra-ai の詳細」セクション内「AIアドバイスの精度改善」を参照

#### ⚠️ AIアドバイスの予算比較が全タグで誤った予算と比較される重大バグを修正（2026-06-18）
- 「今月どう？」ボタン押下時、AIが「娯楽・趣味が予算の約4倍超過」「電車バスが2倍以上超過」と
  発言したが、実際は両方とも予算内（77%・92%）だった
- 原因: `supabase/functions/flowra-ai/index.ts`の`tagLines`生成部分で
  `budgets.find((b) => b.tagId === t.tagId)`としていたが、`tagBreakdown`・`budgets`どちらの
  オブジェクトにも`tagId`プロパティが存在せず、両辺とも`undefined`。`undefined === undefined`は
  `true`になるため、**全てのタグが配列内の最初の予算（このケースでは「嗜好品」¥8,000）と
  紐付いてしまっていた**（¥30,725÷¥8,000≈3.8倍、¥18,420÷¥8,000≈2.3倍で、AIの発言と一致）。
  AI自身は渡された誤ったデータをそのまま正直に読んでコメントしていただけで、推論自体は誤っていない。
- 自動一言（`monthly`）は`budgets:[]`を渡すため影響を受けないが、`今月どう？`/`先月と比べて`/
  `節約ヒント`の3ボタンは実際の予算データを渡すため、予算を1つでも設定しているチームは
  全員この影響を受けていた可能性が高い
- 修正: `b.tagId === t.tagId` → `b.name === t.name`（タグ名で照合）。Edge Functionの手動再デプロイが必要

#### AIアドバイス：ローディング表示が分かりづらく多重タップされる問題を改善（2026-06-18）
- 「考え中…」の表示が小さく目立たないため、反応しているか不安になって複数回タップしてしまうという
  フィードバックがあった。単に見た目を目立たせるだけでなく、**多重タップで実際にAI呼び出しが
  複数回飛んでしまう（=200回上限を無駄に消費する）リスク自体を防ぐ**ことを優先して対応。
- `_aiBusy`フラグを追加し、チップボタン・フリー入力のどちらかでリクエスト中は、もう一方も含めて
  全ての操作を無効化（タップしても無視）するように変更
- タップされたチップボタン自身の表示を一時的にスピナー+「考え中…」に変更し、タップした場所で
  即座に反応が分かるようにした（他のチップ・フリー入力欄は薄く表示してタップ不可を示す）
- フリー入力の「聞く」ボタンも同様に、ボタン自体がスピナーに変わるようにした

#### マーケティング活動（実行ログ）

**Stripe本番移行完了**
- 2026-06-18にユーザー確認のもと完了。詳細は本ドキュメント先頭「Stripe 本番移行」セクション参照

**動画企画②パートナー共有：動画は断念し画像2枚で展開**
- 当初動画を撮影する予定だったが、画面に個人情報（パートナーの名前等）が映り込むため断念
- 代わりに注釈入りスクリーンショット2枚（① プラン・パートナー共有設定画面 ② 招待リンク発行画面）を用意
- 展開先はXのみに絞った（note: 画像2枚だけでは記事として薄く、ストーリー性のあるネタ向きと判断して見送り。Instagram: アカウントをまだ育てていない段階のため見送り）
- X投稿文（1枚目）：パートナー共有機能の紹介＋「お互いの使い方が見える」という価値訴求
- リプライ（2枚目）：招待後の一覧表示・権限（編集・削除可）・チーム名のカスタマイズ性を紹介
- 投稿16時間後でインプレッション5件と伸び悩み。次の③予算管理のネタ準備、または同じ投稿への追加リプライでの巻き込みを検討中

---

### 2026-06-16（Gemini精度改善・本番採用・無料枠拡大・UX改善・マーケティング実行）

#### Geminiモデル不具合修正

**モデルID修正**
- `gemini-2.0-flash-001` / `gemini-1.5-flash-002` は2026年6月にサービス終了済みのため使用不可と判明
- 利用可能な `gemini-2.5-flash` / `gemini-2.5-flash-lite` に変更（admin.html）

**Thinkingモード無効化**
- Gemini 2.5系はデフォルトでThinkingモードが有効なため、JSON前にthoughtテキストが混入してパースエラーになる事象を発見
- `receipt-ocr/index.ts` の `callGoogle()` に `thinkingConfig: { thinkingBudget: 0 }` を追加
- レスポンスの `parts` 配列から `thought: true` のパーツを除外し、`text` パーツのみ抽出するよう修正

**Google Cloud課金設定**
- Flowraプロジェクト（flowra-497313）が請求先アカウント「CloudTranslationAPI」に既にリンク済みであることを確認
- Google AI StudioのAPIキー設定で「前払いを設定」を実行 → レート制限エラー解消

**タグ分類プロンプト改善**
- Gemini 2.5 Flashは初期プロンプトでは大半の品目を「食費」に分類してしまう問題があった
- プロンプトに具体的な分類基準を追加：
  - お菓子・スナック・アイス・ジュース・コーヒー・酒類 →「嗜好品」
  - 食材・調味料・米・乾物・冷凍食品 →「食費」
  - シャンプー・洗剤・ティッシュ等 →「日用品」
  - 「食費はデフォルトで選ばず性質をよく考えて分類する」という指示を追加
- 改善後、同一レシートでSonnet 4.6とほぼ同等のタグ分類精度を達成（コショウ等の一部例外あり）

**[DECISION] 本番採用モデル: `google/gemini-2.5-flash`**
- テキスト精度: Sonnet同等
- タグ分類精度: プロンプト改善後はSonnet同等
- コスト: ¥0.40/回（Sonnetの1/7）

---

#### OCR無料枠・上限拡大（DB側の取り忘れを修正）

前回（6/15）Edge Functionとlp/index.htmlの定数は変更済みだったが、フロントエンド側の定数が古い値のまま残っていたため実際の動作に反映されていなかった。

**修正箇所**
- `js/db.js`: `FREE_RECEIPT_LIMIT` 3→10、`PREMIUM_RECEIPT_LIMIT` 100→200（設定画面の表示に直結）

これにより、設定画面の「レシート読み取り 0/3」表示が正しく「0/10」になるよう修正。

---

#### 管理画面（admin.html）改善

**OCR利用回数の表示追加**
- 統計カードに「今月OCR回数」を追加（4列グリッド化）
- `loadStats()` に `receipt_usage` テーブルから当月合計を集計するロジックを追加

**バグ修正**
- HTML文字列内の改行コードがエスケープミスで `\n` という literal な文字列として画面に表示される事象を修正
- モバイル表示でレシート読み取り列（4列目）が `display:none` で隠れていた問題を修正（横スクロール対応のテーブルへ）

---

#### UX改善

**メモ欄の自動リサイズ（edit-record.js）**
- レシートOCRで読み取った長い品目名・店名がメモ欄の `<input>` 1行に収まらず見切れる問題を解決
- `<input type="text">` を `<textarea>` に変更し、入力内容に応じて自動で高さが伸びるようにした（`scrollHeight` ベース）

**招待リンクのUX改善（settings.js）**
- 従来は「招待リンクを発行」ボタン押下でクリップボードにコピーするだけだったが、何をコピーしたか分かりにくく、共有手段もコピペのみだった
- 改善後：
  - 発行後にURL全体をテキストで表示するエリアを追加（＋専用コピーボタン）
  - Web Share API を使った「LINEやメールでシェア」ボタンを追加（iOSではAirDrop/メッセージ等のネイティブ共有シートが起動）
  - トースト表示を「コピーしました: …末尾12文字」に変更し、何をコピーしたか視認できるように改善

**予算未設定時の空状態UI（dashboard.js）**
- 予算を1つも設定していないチームでは予算セクションが完全に非表示になっていた
- 空状態UI（📊アイコン＋説明文＋「予算を設定する」ボタン）を追加し、設定画面への導線を作った

**AI上限到達時のフィードバック改善（dashboard.js）**
- チップボタン（「今月どう？」等）経由でAI上限に達した際、エラーメッセージもアップグレード案内も出ず無反応になっていたバグを修正
- 上限到達時は「今月のAI回数上限に達しました」のメッセージ＋アップグレードシートを表示するよう修正

**AI上限ポップアップの重複表示修正**
- `_limitShownThisSession` フラグが `setupAiSummary()` 関数のローカル変数だったため、画面遷移ごとにリセットされ毎回ポップアップが出る不具合があった
- モジュールレベルの変数に移動し、1セッションで1回だけ表示されるように修正

---

#### マーケティング活動（実行ログ）

**X投稿（1本目）**
- 動画付き「家計管理アプリ作りました」を投稿（その後、個人エピソードを含む一文を削除して再投稿）
- Xプロフィール名を「Flowra（フローラ）家計管理アプリ」に変更
- bio文を整備（レシートを撮るだけで家計が動く📷の文言）

**note記事執筆**
- タイトル「レシートを撮るだけで家計が動くアプリを作った話」相当の記事を新規執筆・投稿
- ホーム画面・タグ別集計・レシート確認画面の3枚のスクリーンショットを使用
- 署名：Masamune Endo / X: @dat0925

**SEO・カタカナ対策**
- 「Flowra」とアルファベット表記のみでは検索されにくいという課題認識から、カタカナ「フローラ」を以下に追加：
  - `lp/index.html`: title, description, og:title, og:site_name, twitter:title, keywords meta タグ
  - `index.html`（アプリ本体）: title, description, keywords meta タグを新規追加
- Google検索で「家計管理 Flowra」が実際にインデックスされ表示されることを確認（AIによる概要には未だ反映されず、認知度向上が今後の課題）

**今後のコンテンツ計画**
- 動画撮影の頻度は週1〜2本が現実的という方針を確認
- 機能ごとの紹介動画を順番に投稿する計画：①レシートOCR（完了）②パートナー共有 ③予算管理 ④AIアドバイス ⑤実際の使用レビュー
- Xヘッダー画像をGPTで生成するためのプロンプトを作成（1500×500px、ダークグリーン背景、Masamune Endo名＋3アプリロゴ配置）

**多言語対応の検討（実施は見送り）**
- 英語・中国語・韓国語対応について、LPは言語別ページが必要、アプリは通貨・日付・税率・OCRプロンプトをロケールごとに作り直す必要があると認識
- 現フェーズ（国内ユーザー数が少ない段階）では時期尚早と判断し、実装は見送り

---

#### 調査・確認事項（対応不要と判断）

**Stripe Webhook失敗の調査**
- TaskraのStripeログを確認 → 全て200 OKで正常
- FlowraのStripe Webhookで `customer.subscription.updated` の送信が失敗しているメール通知があったが、調査の結果、手動でPremium付与した粧子さんのアカウント（Stripe Customer未登録）がカスタマーポータルにアクセスしたことが原因と判明
- 実害がないため対応不要と結論（口頭で本人に周知する方針）

**口座残高の一時的な不整合（誤報）**
- レシート一括登録後に口座残高が更新されていないように見える事象が報告されたが、調査の結果ユーザー側の確認不足（表示タイミングのズレ）であり、実際にはシステムは正常に動作していたことが判明

---

### 2026-06-15（マーケティング準備・OCRマルチプロバイダー対応・無料枠拡大）

#### マーケティング基盤整備

**Google Analytics 4（GA4）設置**
- 測定ID: `G-M40916RMNH`
- `lp/index.html` と `index.html` の両方に設置
- LPのCTAクリックイベント計測を実装（5箇所）：
  - `signup_click` イベント: `button` パラメータで `nav` / `hero` / `mid_cta` / `pricing_free` / `bottom_cta` を識別
  - `premium_click` イベント: Premiumボタン専用

**OGP・SEOタグ整備（lp/index.html）**
- `<meta name="description">` 追加
- `<link rel="canonical">` 追加
- OGP（og:title / og:description / og:image / og:url / og:type / og:site_name / og:locale）追加
- Twitter Card（summary_large_image）追加
- OGP画像: `images/ogp.jpg`（1200×630px・73KB・GPTで生成したオリジナル画像）

**Google Search Console登録**
- プロパティ: `https://flowra.taskra.jp/lp/`
- GAと同じGoogleアカウントで自動認証済み
- サイトマップ: `lp/sitemap.xml` 作成・送信済み

**LP動線改善（lp/index.html）**
- セクション順を変更：`HERO → OCRデモ → Features → **共有** → 中間CTA → 予算 → AI → HOW → 料金 → 最終CTA`
  - 「パートナー共有」セクションをFeaturesの直後に移動（差別化軸を早く見せるため）
- 中間CTAバナーを新設（`mid-cta-section`）：「まずは無料で試せます。クレジットカード不要。」

---

#### OCRマルチプロバイダー対応

**app_settingsテーブル追加**（Supabase SQL Editorで実行済み）
```sql
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS: クライアント直接アクセス不可（Edge FunctionはService Roleで読む）
-- get_app_setting(p_key) / update_app_setting(p_key, p_value) RPC追加（admin only）
-- デフォルト値: receipt_ocr_model = 'anthropic/claude-sonnet-4-6'
```
ファイル: `supabase_app_settings.sql`

**receipt-ocr Edge Function 大幅改修**
- プロバイダー形式: `provider/model`（例: `google/gemini-2.5-flash`）
- 対応プロバイダー:
  - `anthropic`: Claude Sonnet 4.6 / Claude Haiku 4.5（Anthropic SDK・遅延import）
  - `google`: Gemini 2.5 Flash / Gemini 2.5 Flash Lite（REST API）
  - `openai`: GPT-4o / GPT-4o mini（REST API）
- 実行時にDBから `app_settings.receipt_ocr_model` を読み込み動的ルーティング
- APIキー未設定・無効・レート制限それぞれに適切なエラーメッセージを実装
- Gemini対応の重要ポイント:
  - `thinkingConfig: { thinkingBudget: 0 }` でThinkingモードを無効化（JSONパースエラー防止）
  - レスポンスの `thought: true` パーツを除外して `text` パーツのみ返す
  - Gemini 1.5/2.0は2026年6月に廃止済み → 2.5系のみ使用
- タグ分類プロンプトを改善（嗜好品・食費・日用品の明示的なルール追加）
- 新規環境変数: `GOOGLE_API_KEY` / `OPENAI_API_KEY`（Supabase Secrets登録済み）

**管理画面にOCRモデル選択UI追加（admin.html）**
- 「🤖 OCRモデル設定」セクションを追加
- 現在のモデルを表示・ドロップダウンで変更・即時反映
- 対応モデル一覧（価格情報付き）:
  - Anthropic: Claude Sonnet 4.6（$3/$15）/ Claude Haiku 4.5（$1/$5）
  - Google: Gemini 2.5 Flash / Gemini 2.5 Flash Lite
  - OpenAI: GPT-4o mini / GPT-4o
- Gemini/OpenAI使用時の環境変数追加案内ノートを表示

---

#### OCR精度比較結果（2026-06-15検証）

同一レシート（コスモス）での比較：

| モデル | テキスト精度 | タグ分類精度 | コスト/回 |
|---|---|---|---|
| Claude Sonnet 4.6 | ◎ | ◎ 嗜好品/食費/調味料を正確に区別 | ¥2.9 |
| Claude Haiku 4.5 | △ 2割程度誤認識 | △ ほぼ食費に偏る | ¥1.0 |
| Gemini 2.5 Flash Lite | ◎ | △ 食費に偏る（プロンプト改善前） | ¥0.07 |
| Gemini 2.5 Flash | ◎ | ◎ プロンプト改善後はSonnet同等 | ¥0.40 |

**採用モデル: `google/gemini-2.5-flash`**（コスト1/7・精度Sonnet同等）

---

#### OCR無料枠・上限拡大

- Free: 月3回 → **月10回**
- Premium: 月100回 → **月200回**

変更ファイル:
- `supabase/functions/receipt-ocr/index.ts`（定数変更）
- `lp/index.html`（4箇所の表記更新）
- `js/add-record.js`（エラーメッセージの100回→200回）

コスト試算（Gemini 2.5 Flash・¥0.40/回・160円/ドル換算）:
- Free月10回: 約¥4
- Premium月200回: 約¥80（原価率20%）

---

#### Gemini APIセットアップ（Google AI Studio）
- プロジェクト: `Flowra`（flowra-497313）
- APIキー名: `Flowra OCR`
- 請求先アカウント: `CloudTranslationAPI`にリンク済み（課金有効）
- Supabase Secretsに `GOOGLE_API_KEY` 登録済み

---

### 2026-06-14（レシートOCR大幅改善・LP全面改修・法的ページ整備）

#### 税率UI改善（add-record.js）
- **税率バッジのデザイン変更**：背景色のみ→ボーダー付きピル型に変更（タグバッジと区別・操作可能と伝わるデザイン）
  - 軽減8%：緑ボーダー（`#4A7C59`）、標準10%：紫ボーダー（`#9A90B8`）
- **詳細シートに税率トグルを追加**：品目タップ→詳細シートに「消費税率」セクション追加
  - `[ 軽減8%（食品） ]` / `[ 標準10% ]` の2択ボタン
  - 選択中：色付き太ボーダー、未選択：グレー
  - タップで `item.taxRate` を 8 or 10 に変更 → 完了ボタンで確定
  - 税込み変換ボタンはこの `taxRate` を参照するため、変更後に押すと正しい税率で変換される

#### レシートOCR改善

**① モデル更新**
- `claude-sonnet-4-20250514` → `claude-sonnet-4-6` に変更（精度向上）

**② タグ自動推定をAI判定に切り替え（根本改善）**
- 旧：フロント側のキーワードリストで品目名を判定（漏れが多い）
- 新：Edge FunctionがユーザーのタグをDBから取得してClaudeに渡し、OCR時に同時判定
- `db.js` の `scanReceipt()` に `teamId` を追加してEdge Functionに送信
- Edge Function（`receipt-ocr`）の変更点：
  - `tags` テーブルと `budgets` テーブルを並列取得
  - 予算ありタグ = 主タグ、予算なしタグ = サブタグとして分類
  - AIには主タグのみを渡す（全タグを渡すと混乱するため）
  - サブタグは「物品・食材の種類を示すものを複数選んでよい」と指示
  - 「無駄遣い」「節約可能」など感情・評価系タグは絶対に選ばない旨をプロンプトに明記
  - レスポンスに `tagId`（主タグID）・`subTagIds`（サブタグID配列）を追加

**③ サブタグ自動設定**
- `add-record.js` の `showReceiptConfirm` でAIの `tagId`・`subTagIds` を優先使用
- AIがタグを返せなかった場合のみキーワード推定にフォールバック
- フォールバック用キーワードリストも大幅拡充（食材商品名・スパイス・きのこ・飲料ブランドなど）

**④ 消費税率AI判定＋確認画面バッジ表示**
- Edge Functionで各品目の `taxRate`（8 or 10）をClaudeが判定して返す
- 判定基準：飲食料品→8%、酒類・日用品・化粧品など→10%、レシートの税区分記号も参照
- `add-record.js` の `getTaxRate()` を改修：AI判定 → タグ名フォールバックの順で判定
- 確認画面に税率バッジを表示（軽減8%：緑、10%：薄紫）
- タグ未設定の品目にも表示される（タグと独立してAIが判断）
- ⚠️ **税込み変換ボタンの税率はこのtaxRateを使用する**

#### LP全面改修（lp/index.html）
- ヒーローコピー変更：「あなたのお金を、もっと自然に。」→「レシートを撮るだけ。家計が動く。」
- レシートOCRデモセクションを追加（ダーク背景・品目がスクロールインで出現するアニメーション）
- Featuresを9枚→6枚に整理（AI・レシートを先頭に）
- HOWの3ステップ目を「パートナーを招待」→「レシートを撮ってみる」に変更
- フッターにプライバシーポリシー・利用規約・お問い合わせリンク追加

#### 法的ページ整備
- `lp/privacy/index.html`：プライバシーポリシー（Supabase・Anthropic・Stripe・Googleへのデータ提供を明記）
- `lp/terms/index.html`：利用規約（AI免責・Premium返金なし・招待リンク管理責任など）
- `lp/contact/index.html`：お問い合わせフォーム（Formspree `xpqbkdea` 使用・taskra-webと同じエンドポイント）
  - 隠しフィールドで `service: Flowra` / `_subject: 【Flowra】お問い合わせ` を送信
  - 種別に「データの削除について」を追加（プライバシーポリシーで削除はお問い合わせから、と記載したため）
  - 非同期送信（フォームが消えて完了メッセージ表示）

#### 設定画面
- バージョン表示の下に利用規約・プライバシーポリシー・お問い合わせのリンクを追加（`settings.js`）

---

### 2026-06-14（レシート確認画面ブラッシュアップ・0円対応・Stripe整理）

#### レシート確認画面（改善）
- **fix**: 確認画面表示直後にスクロール不可になるバグ修正（`add-record.js`）
  - `body.style.overflow = ''` をoverlay生成前にリセット
  - `-webkit-overflow-scrolling: touch` を追加してiOSスクロールを確実に有効化
- **fix**: チェックボックスデザイン刷新
  - 28px大円 → 22px角丸ボックスに変更（44×44pxのタップ領域を維持）
  - 未チェック：白背景＋グレーborder、チェック済み：濃い緑（`#2d5a3d`）＋白チェック
  - `stopPropagation()` でチェックタップが詳細画面遷移に漏れないよう修正
- **feat**: 品目名からタグを自動推定（`autoAssignTags()` 関数追加）
  - タグ名との直接マッチを優先、次にキーワードマッピング（食費・外食・飲み物・菓子・日用品・子育て・医療・美容・交通・衣類等）
  - 主タグ（予算あり）は1件まで、サブタグは複数可
- **feat**: 保存時のメモに店名を付加（例: `ドデカクリエーターグードピザ（オーケー 幕張店）`）
- **feat**: 税抜き→税込み一括変換ボタン追加
  - 食費・外食・飲み物・菓子タグ → ×1.08（8%）、その他・タグ未設定 → ×1.10（10%）
  - 値引き（マイナス金額）は変換対象外
  - 変換前に確認ダイアログを表示（誤タップ防止）
  - 再タップで元の金額に戻せる（`baseAmount` で元金額を保持）

#### 0円登録対応
- **fix**: 新規登録・編集ともに0円を許可（`add-record.js` / `edit-record.js`）
  - バリデーション: `amount <= 0` → `amount < 0` に変更
  - Supabase側の `CHECK (amount > 0)` 制約も変更済み：
    ```sql
    ALTER TABLE transactions DROP CONSTRAINT transactions_amount_check;
    ALTER TABLE transactions ADD CONSTRAINT transactions_amount_check CHECK (amount >= 0);
    ```
  - ⚠️ `import-notion.js` の0円スキップ処理（`金額 === 0` チェック）は**そのまま維持**（インポート時は0円が混入しやすいため）

#### Stripe Webhook整理
- **削除**: Taskra のサンドボックス用Webhook `taskra-webhook`（`sfhtvtcmgueystyuhzvd.supabase.co`）
  - Taskra・Flowraは本番リリース済みのためテスト用Webhookは不要
- **残存**: `vibrant-oasis`（= Tavera の `tavera-webhook`）はサンドボックス開発中のため残存
- **現在のサンドボックスWebhook**: Taveraのみ（`sfhtvtcmgueystyuhzvd.supabase.co/functions/v1/tavera-webhook`）

---

### ⚠️ テスト時の一括登録事故・再発防止策

**インシデント（2026-06-14）**: レシートOCRのテスト中に27件が本番DBに登録されてしまった。

**削除に使ったSQL:**
```sql
DELETE FROM transactions
WHERE created_at >= '2026-06-12 22:58:57'
  AND created_at <= '2026-06-12 22:59:07';
```

**再発防止策:**

1. **テスト前に確認クエリを手元に用意しておく**
   ```sql
   -- テスト後すぐに実行して対象を確認
   SELECT id, date, amount, memo, created_at
   FROM transactions
   WHERE created_at >= NOW() - INTERVAL '10 minutes'
   ORDER BY created_at DESC;
   ```

2. **削除は created_at の時刻範囲で絞る**（dateだと既存データと混在するリスクあり）
   ```sql
   DELETE FROM transactions
   WHERE created_at >= '[開始時刻]'
     AND created_at <= '[終了時刻]';
   ```

3. **レシートOCRのテストは古い日付のレシート画像を使う**（date列で区別しやすい）

4. **テスト用ダミーメモを付ける運用**（例: メモ末尾に「（テスト）」を付けて識別できるようにする機能改善を検討）

---

### 2026-06-13（レシート読み取り機能・UI改善・本番移行完了）

#### レシート読み取り機能（新規）
- **feat**: `receipt-ocr` Edge Function 追加（Claude Vision で品目を自動抽出）
  - Free: 月3回 / Premium: 月100回の制限
  - `receipt_usage` テーブルと `increment_receipt_usage` RPC で使用量管理
  - Supabase SQL で以下を実行済み：
    ```sql
    CREATE TABLE receipt_usage (user_id uuid, month_key text, count integer DEFAULT 0, PRIMARY KEY (user_id, month_key));
    ALTER TABLE receipt_usage ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "own receipt_usage" ON receipt_usage FOR ALL USING (auth.uid() = user_id);
    CREATE OR REPLACE FUNCTION increment_receipt_usage(p_user_id uuid, p_month_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO receipt_usage (user_id, month_key, count) VALUES (p_user_id, p_month_key, 1) ON CONFLICT (user_id, month_key) DO UPDATE SET count = receipt_usage.count + 1; END; $$;
    ```
- **feat**: `add-record.js` にレシート読み取りボタンを追加（サジェスト画面 = +ボタン直後）
- **feat**: レシート確認画面（1行表示 + タップで詳細シート）
  - 左の円タップ → チェックON/OFF
  - 行タップ → 詳細シート（品目名・金額編集・主タグ・サブタグ選択）
  - `capture="environment"` は削除済み（ライブラリからも選択可）
- **feat**: 読み取り中の全画面オーバーレイ（スピナー + 操作ブロック）
- **feat**: `db.js` に `scanReceipt()` / `getReceiptUsageThisMonth()` を追加

#### 設定画面
- **feat**: プラン行にAI・レシート月次使用量バーを追加（プログレスバー + 使用済み/上限）
  - 80%超えでオレンジ色に変化
  - `FREE_AI_LIMIT=5` / `PREMIUM_AI_LIMIT=6000` / `FREE_RECEIPT_LIMIT=3` / `PREMIUM_RECEIPT_LIMIT=100`
- **feat**: Freeユーザーの「管理」ボタン → 「✦ アップグレード」ボタンに変更（LP の #pricing セクションへ）
- **feat**: LP の料金セクションに `id="pricing"` を追加

#### 記録一覧
- **feat**: 日付ヘッダーに日次支出合計を表示（`支出 ¥XXX` 形式、収入・振替のみの日は非表示）

#### オンボーディング
- **feat**: Step1 右上に×ボタン（全スキップ）を追加
- **feat**: 「スキップして使い始める」テキストリンクを追加
- **fix**: `ob-sheet` 上部の1px隙間を修正（`margin-bottom: -1px`）

#### 管理画面（admin.html）
- **feat**: ユーザー一覧に今月のAI・レシート利用回数列を追加
- **feat**: アカウント登録日列を追加
- **fix**: 「利用開始日」「有効期限」列を削除してレイアウト崩れを解消
- **fix**: プルトゥリフレッシュを追加（上部から下スワイプ80px以上でreload）

#### LP
- **feat**: レシート読み取り機能の訴求を追加（Freeプラン月3回・Premiumプラン月100回）
- **feat**: Features グリッドに「📷 レシート読み取り」カードを追加

#### Stripe 本番移行完了
- 本番 Payment Link: `https://buy.stripe.com/00w00i1Rx4Lwbmy2c3fQI02`
- 本番 Price ID: `price_1Th0aqBNAV5e5rhcL7gXKM7d`
- 本番 Webhook 登録済み・Customer portal 有効化済み
- Supabase Secrets 全て本番用に更新済み

#### 重要な注意事項
- **上書き問題**: 会話が長くなると `/tmp/add-record.js` 等のローカルキャッシュが古くなり上書きが発生する。必ず修正前にGitHubから最新版を取得すること
- `capture="environment"` はiOSでカメラ直起動になりライブラリ選択不可になるので使用禁止

### 2026-06-11（Stripe決済・管理画面・本番移行準備）

- **fix**: `stripe-webhook` を `user_id` ベースに修正（根本原因の解消）
  - 旧: `email` で `user_plans` を upsert → レコードが見つからず plan が更新されなかった
  - 新: `client_reference_id`（= Supabase user_id）を優先取得。なければ email フォールバック
  - `checkout.session.completed` / `customer.subscription.*` の全イベントを `user_id` ベースに統一

- **fix**: `stripe-portal` を `user_id` ベースに修正
  - 旧: `email` で `stripe_customer_id` を検索 → レコットが見つからず 500 エラー
  - 新: `user_id` で検索。なければ Stripe で新規作成して upsert

- **feat**: 設定画面にプランバッジ表示を追加（`settings.js`）
  - プラン行に Free / ✦ Premium バッジを表示
  - 「管理」ボタンで Stripe カスタマーポータルへ遷移
  - `renderSettings()` 内で `DB.getUserPlan()` を取得して `renderSettingsContent` に渡す設計

- **feat**: LP Payment Link に user_id を動的埋め込み（`lp/index.html`）
  - ログイン済みの場合、Payment Link URL に `?client_reference_id=USER_ID` を自動付加

- **fix**: admin.html のセッション復元処理を追加
  - admin.html は index.html と別の Supabase クライアントを持つため localStorage からトークンを取得して `setSession()` で明示的に復元

- **fix**: `get_all_user_plans` RPC に `SECURITY DEFINER` を付加（SQL Editor で再作成）
  - 旧: `SECURITY DEFINER` なし → `auth.uid()` が NULL → unauthorized で全員 free 表示
  - 新: `SECURITY DEFINER` あり → 正しく admin ユーザーの uid で評価される

- **fix**: admin.html の Premiumカウントを `plan === 'premium'` のみに修正（admin を除外）

- **feat**: admin.html にプルトゥリフレッシュを追加（上部から下スワイプ 80px 以上で reload）

- **feat**: Stripe カスタマーポータルを有効化（Stripe → 設定 → Billing → Customer portal）

- **Supabase Secrets 追加登録済み**: `SB_ANON_KEY` / `STRIPE_SECRET_KEY`

### 2026-06-09（Stripe決済実装完了）

- **feat**: Stripe決済を全て実装・テスト環境で動作確認済み

**完了した作業：**
1. Supabase Secrets登録（`STRIPE_SECRET_KEY` / `STRIPE_PREMIUM_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` / `SB_SERVICE_ROLE_KEY` / `SB_ANON_KEY`）
2. Edge Function 2本をデプロイ（`stripe-webhook` / `stripe-portal`）
   - `stripe-webhook`: 決済完了・解約イベントで `user_plans` テーブルを更新
   - `stripe-portal`: Stripeカスタマーポータル用URLを生成
3. StripeダッシュボードでWebhook登録（`flowra-webhook`）
4. LPのPremiumボタンを有効化（テスト用Payment Link接続）
5. 設定画面に「プランを管理する」ボタンを追加（`settings.js`）

**本番リリース時の作業：**
- Stripeをテストモード→本番モードに切り替え
- Supabase SecretsのStripeキーを本番用に差し替え
- LPのPayment Linkを本番用に差し替え
- StripeのWebhookを本番用URLで再登録

**Stripe関連の既知情報：**
- サンドボックスの商品: `Flowra プレミアム` ¥398/月
- Price ID（テスト）: `price_1TeObDB5e5DORDCypOnurrsf`
- Payment Link（テスト）: `https://buy.stripe.com/test_7sY6oG72Y43J0Yp72rds402`
- Webhook ID: `we_1TgDDrBNAV5e5rhczkYylZ22`
- `user_plans` は `user_id` カラムで管理（`email` カラムは存在しない）

### 2026-06-08〜09（バグ修正・UI改善）

- **fix**: adminユーザーのAI制限ポップアップ問題
  - `user_plans` に `user_id` カラムで管理（`email` カラムは存在しない）
  - `mstd0520@gmail.com`（user_id: `6fa4c2af`）と `flow1021@gmail.com`（user_id: `c54fb7d3`）のレコードをINSERT済み
  - `get_all_user_plans()` RPCがadminユーザーしか呼べない設計だったため、premiumユーザーが `getUserPlan()` を呼ぶと `unauthorized` でfreeにフォールバックしていた
  - `getUserPlan()` を `user_plans` テーブルへの直接クエリに変更（`get_all_user_plans` 不要に）
  - チームオーナーのプランを `get_user_plan_by_id` RPC（SECURITY DEFINER）で取得
  - `get_user_plan_by_id` RPCをSupabase SQL Editorで作成済み

- **fix**: 口座ページのプログレスバーでクレカ（マイナス残高）がバー表示されていた
  - マイナス残高の場合は `pct = 0` にしてバー非表示（空の高さだけ確保）
  - バー色は `a.color` 設定値を使用、未設定は緑（`#4A7C59`）

- **fix**: 口座選択シートがsave-barに隠れてスクロール不可・5件目が見えない問題（`add-record.js`）
  - 原因: `save-bar` の `z-index: 1000` に対して口座選択シートが `z-index: 700` だったため被さっていた
  - 口座が多いユーザーはシートが画面85%を超えてスクロール可能だったが、少ないユーザーはボタンの後ろに完全に隠れていた
  - 修正: シートの `z-index` を `1100` に変更



- **既知の制限**: AIフリー入力は表示中の月の前後3ヶ月データを渡すため、それ以前の月は回答できない

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

### 2026-06-07（セッション・集計・UX・インポート）
- **feat**: 集計シートに年月ピッカー・今月ボタン追加（`summary-sheet.js`）
  - 月ラベルタップで年・月セレクター表示
  - 今月以外を表示中は「今月」ボタンが出現
- **fix**: 集計シートの月切替をフェードで更新（上下アニメーションなし）
- **fix**: 集計シートの過去月データが0になる問題（`get_transaction_tags` RPCで解決）
  - `transaction_tags`のRLSブロックが原因
  - RPC: `get_transaction_tags(p_transaction_ids uuid[])` を追加
- **feat**: 記録の共有リンク機能（`?tx=ID`ディープリンク）
  - 編集画面に「共有リンクをコピー」ボタン追加
  - 起動時に`?tx=`を検出して該当記録を開く
  - 注意: エラーが起動に影響しないよう二重try/catchで保護
- **fix**: タグの「主」バッジを削除（全タグ同列・混乱を招くため）
- **feat**: 集計ボタンをsage色で目立たせる（`records.js`）
- **feat**: 予算アコーディオン閉時に合計バーのみ表示（`dashboard.js`）
- **feat**: 予算管理画面に合計予算比率バー追加・保存ボタン重複削除・¥マーク結合
- **feat**: 設定画面をタグ・予算をログアウト下に移動・メンバー読み込みを非同期化
- **feat**: 口座バーを予算バー準拠スタイルに統一（5px高・右端%・コンパクトハンドル）
- **feat**: インポートツールがNOTE列の[tag:xxx]を読んでタグ登録に対応（`import-tool.html`）
  - 複数タグも対応、CategoryタグとNOTEタグを重複なく登録

### flow1021@gmail.comのデータ
- 収入レコード: 家計手渡し（10万×10ヶ月、12万×5ヶ月）
- タグ: 食費・外食・日用品・嗜好品・調味料 米 乾物・子育て・交際費 + 肉・魚・果物・ヨーグルト・米・調味料・乾物・菓子・飲み物・無駄遣い・節約可能・おもちゃ・絵本・手芸用品

### 2026-06-07（セッション・タグ設計・集計改善）
- **feat**: 集計シートに主タグ/サブタグ切り替えタブ追加（`summary-sheet.js`）
  - 主タグ集計：二重カウントなし、予算管理用
  - サブタグ集計：品目推移確認用、実績があるタグのみ表示
- **feat**: 主タグバッジ復活（`edit-record.js`）
  - 選択した最初のタグに「主」バッジ表示
- **fix**: `get_transaction_tags` RPCにORDER BY ctid追加（タグ順序保証）
- **fix**: `get_transaction_tags` RPCに `sort_order` カラム追加
- **feat**: タグ管理画面に予算金額表示（並び替え参考用）
- **データ修正**: 主タグが予算なし・サブタグに予算ありの8件を修正（削除）
- **設計**: 主タグ=予算設定あり（大カテゴリ）、サブタグ=品目レベル（分析用）
  - インポート時はCategoryが主タグ、NOTE列[tag:xxx]がサブタグ
  - 予算ありタグが2つある場合は先にINSERTされた方が主タグになる点に注意

### 2026-06-07（セッション終盤・タグ設計・集計・UX大量改修）

#### タグ設計の確立
- **主タグ**（予算あり）= 1枚のみ、集計・予算管理用
- **サブタグ**（予算なし）= 複数可、品目推移確認用
- 主タグ選択は排他処理（2枚目選択で自動的に1枚目が外れる）
- `get_transaction_tags` RPCにORDER BY ctid追加（タグ順序保証）
- **重要**: `transaction_tags`のctid順が主タグ判定の根拠。ctidは物理順なので注意

#### 追加・編集画面のタグUI
- 主タグセクション（予算あり・1つまで）とサブタグセクション（複数選択可）に分離
- `budgetMap`を`add-record.js`と`edit-record.js`で取得して判定
- 「主」バッジは予算ありタグを選択した時のみ表示

#### 集計シート（summary-sheet.js）
- 主タグ/サブタグ切り替えタブ
- 月ナビゲーション（ヘッダーと同デザイン統一）
- 月ラベルタップでピッカー、今月ボタン
- 開いた瞬間に当月列（最右端）に自動スクロール
- 90vh固定高さで一回でせり上がる（2段階アニメーション解消）
- タブに丸いアイコン「?」ツールチップ（×で手動クローズ）
- サブタグ集計は実績あるタグのみ表示・今月予算列なし

#### バグ修正
- **fix**: `syncInBackground`の`cachedTxs`スコープ外参照（ホーム過去月0件表示）→ `cachedTxCount`引数で渡す形に修正
- **fix**: recordsスクロールリスナー重複登録（月切り替えでヘッダー透け）→ `_recordsScrollHandler`でリスナー管理
- **fix**: 月切り替え時`scrollTop`リセット漏れ
- **revert**: 左右スワイプ月切り替えを廃止（ヘッダー透け問題の根本解決できず）

#### その他UI改善
- 予算パネルタイトルに年月表示（「予算 2026年6月」）
- 口座画面の残高バーを予算バー準拠スタイルに統一
- 予算管理画面に合計予算比率バー・保存ボタン重複削除
- 設定画面：タグ・予算をログアウト下に移動・メンバー読み込みを非同期化
- インポートツール：Category→主タグ（先頭）、NOTE[tag:xxx]→サブタグの順序を保証

#### SWキャッシュ問題
- GitHub Actionsの自動バンプが効かないことがある
- 手動でsw.jsのバージョンを大きく上げてpushすると解決
- 今日のセッションでv99→v201まで上げた

### 2026-06-08（セッション・タグ予算統合・UI改善）

- **feat**: タグ管理と予算管理を統合（`settings.js`）
  - 設定画面の「タグ管理」「予算管理」2行を「タグ・予算管理」1行に統合
  - タグ管理画面の各行に予算金額（表示のみ）と「編集」「月別」ボタンを配置
  - タグ行タップでの編集シート起動を廃止（スクロール干渉のため）→ 「編集」ボタンで起動
  - タグ編集シートに予算入力欄・「月で調整」ボタンを追加
  - 下部ボタンを「＋ タグを追加」のみに（保存ボタン廃止、編集シート内で個別保存）

- **feat**: タグのアイコン廃止・カラードットに統一（`settings.js` / `add-record.js` / `edit-record.js`）
  - タグ編集シートのアイコン選択グリッド（20種類）を削除
  - 記録追加・編集画面のタグボタン内SVGアイコンをカラードットに置換
  - `tag-icons.js` のimportを `add-record.js` から削除

- **fix**: 予算保存バグ修正（`settings.js` / `db.js`）
  - `getBudgets(null)` → `getBudgets(currentMonth)` に変更（月別予算も正しく読み込む）
  - `upsertBudget` に `.select()` を追加してRLS静かな失敗を検知
  - 保存関数をDOMプロパティ → モジュール変数 `_currentSaveBudgetsFn` で管理

- **fix**: 記録編集画面のサブタグ表示バグ（`edit-record.js` / `add-record.js` / `db.js`）
  - `getBudgets(null)` が月別予算を拾えず全タグがサブタグ扱いになっていた
  - `db.js` に `getBudgetTagIds()` を追加（月問わず予算ありタグIDのSetを返す）
  - `edit-record.js` / `add-record.js` で `getBudgetTagIds()` を使うよう変更

- **⚠️ SWキャッシュ問題（教訓）**
  - index.htmlのSW登録コードに `controllerchange` → `location.reload()` を追加したところ無限ループが発生
  - SW削除→再登録→controllerchange→reload→SW削除… のループ
  - **絶対にやってはいけない**: index.htmlの `controllerchange` イベントで `location.reload()` を呼ぶこと
  - **正しいSWキャッシュ対策**: sw.jsのバージョン番号（`CACHE_NAME`）を上げるだけでよい
  - 現在のSWバージョン: `flowra-v315`



