-- AI使用量テーブル
-- user_id + month_key(YYYY-MM) でユニーク
create table if not exists ai_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  month_key   text not null,  -- 例: '2026-06'
  count       int  not null default 0,
  updated_at  timestamptz default now(),
  unique(user_id, month_key)
);

-- RLS有効化（Edge Functionからservice_roleで操作するのでポリシーは読み取りのみ）
alter table ai_usage enable row level security;

-- 自分のデータのみ読み取り可
create policy "ai_usage: own read" on ai_usage
  for select using (auth.uid() = user_id);

-- プランテーブル（将来の有料化に備えて今から用意）
create table if not exists user_plans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free',  -- 'free' | 'couple'
  expires_at timestamptz,
  updated_at timestamptz default now()
);

alter table user_plans enable row level security;

create policy "user_plans: own read" on user_plans
  for select using (auth.uid() = user_id);
