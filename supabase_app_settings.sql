-- ── app_settings テーブル ──
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- クライアントから直接アクセス不可（Edge Functionはservice roleで読む）
CREATE POLICY "no_public_access" ON public.app_settings USING (false);

-- ── 管理者向けRPC: 設定を取得 ──
CREATE OR REPLACE FUNCTION get_app_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_value TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_plans WHERE user_id = auth.uid() AND plan = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  SELECT value INTO v_value FROM app_settings WHERE key = p_key;
  RETURN v_value;
END;
$$;

-- ── 管理者向けRPC: 設定を更新 ──
CREATE OR REPLACE FUNCTION update_app_setting(p_key TEXT, p_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_plans WHERE user_id = auth.uid() AND plan = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();
END;
$$;

-- ── デフォルト値を投入 ──
INSERT INTO app_settings (key, value)
VALUES ('receipt_ocr_model', 'anthropic/claude-sonnet-4-6')
ON CONFLICT (key) DO NOTHING;
