-- 管理画面（admin.html）の「今月AI利用」「今月OCR回数」が
-- 管理者自身の利用回数しか反映されない不具合の修正用RPC
--
-- 原因: ai_usage / receipt_usage は RLS で「自分の行のみ読み取り可」になっているため
--       admin.html から .from('ai_usage') / .from('receipt_usage') を直接クエリすると
--       管理者自身の行しか返らず、他ユーザーの利用回数が0扱い（"—"表示）になっていた。
--
-- 対応: get_all_user_plans() と同様に、SECURITY DEFINER + 管理者チェック付きのRPCを
--       経由して全ユーザーの当月利用回数を取得するようにする。

CREATE OR REPLACE FUNCTION get_all_ai_usage(p_month_key TEXT)
RETURNS TABLE (user_id UUID, count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_plans WHERE user_id = auth.uid() AND plan = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT ai_usage.user_id, ai_usage.count
  FROM ai_usage
  WHERE ai_usage.month_key = p_month_key;
END;
$$;

CREATE OR REPLACE FUNCTION get_all_receipt_usage(p_month_key TEXT)
RETURNS TABLE (user_id UUID, count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_plans WHERE user_id = auth.uid() AND plan = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT receipt_usage.user_id, receipt_usage.count
  FROM receipt_usage
  WHERE receipt_usage.month_key = p_month_key;
END;
$$;
