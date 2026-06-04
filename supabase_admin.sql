-- 管理者用: メールアドレスからuser_idを取得するRPC
-- SECURITY DEFINERでauth.usersにアクセス
create or replace function get_user_id_by_email(p_email text)
returns uuid language plpgsql security definer as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where email = p_email
  limit 1;
  return v_user_id;
end;
$$;

-- user_plansのRLSを管理者操作用に拡張（service_roleは全操作可）
-- 既存のポリシーに追加: 自分のデータはupsert可能
create policy "user_plans: own upsert" on user_plans
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- team_membersのRLS無限ループ修正（2026-06-04）
-- my_all_team_ids()をSECURITY DEFINERにしてRLSバイパス
CREATE OR REPLACE FUNCTION my_all_team_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT team_id FROM team_members WHERE user_id = auth.uid();
$$;
