-- お知らせ機能（ヘッダーのベルアイコン＋バッジ＋ログ一覧）
-- admin.htmlから投稿、アプリ側は全ユーザーが閲覧可能。
-- 既読管理はlocalStorageで端末ごとに行うシンプルな設計（このアプリの規模なら十分）。

CREATE TABLE IF NOT EXISTS announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- ログイン済みユーザーなら誰でも閲覧可（投稿内容に機密性はないため）
DROP POLICY IF EXISTS "announcements: authenticated read" ON announcements;
CREATE POLICY "announcements: authenticated read"
  ON announcements FOR SELECT
  USING (auth.role() = 'authenticated');

-- 投稿・削除はadmin.html経由のみ。直接INSERT/UPDATE/DELETEのRLSポリシーは作らず、
-- 必ず下記のSECURITY DEFINER RPC（管理者チェック付き）を通す。
--
-- ⚠️ 過去の get_all_ai_usage / get_all_receipt_usage と同じ理由で、
-- RETURNS TABLE(...)で列名と同名のOUTパラメータを作らないよう注意（user_id列は使わないため今回は無関係）。

CREATE OR REPLACE FUNCTION create_announcement(p_title TEXT, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_plans WHERE user_plans.user_id = auth.uid() AND user_plans.plan = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  INSERT INTO announcements (title, body) VALUES (p_title, p_body)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_announcement(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_plans WHERE user_plans.user_id = auth.uid() AND user_plans.plan = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  DELETE FROM announcements WHERE id = p_id;
END;
$$;
