-- 每日消息 V2 —— 数据库结构
-- 对应《每日消息V2-后端需求文档》§2
-- 在 Supabase SQL Editor 里整段执行即可（可重复执行）。

-- ── 扩展 ──────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- 中文模糊搜索

-- ── 枚举 ──────────────────────────────────────────────
do $$ begin
  create type run_status as enum ('queued','running','ok','no_update','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fulltext_status as enum ('pending','ok','failed','skipped','purged');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fetch_tier as enum ('fetcher','dynamic','stealthy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type export_format as enum ('md','zip');
exception when duplicate_object then null; end $$;

-- ── 关键词：用户唯一的输入 ─────────────────────────────
create table if not exists keywords (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  query             text not null,
  sources           jsonb not null default '[]'::jsonb,
  retention_days    int  not null default 90  check (retention_days between 1 and 3650),
  max_items_per_run int  not null default 5   check (max_items_per_run between 1 and 20),
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists keywords_enabled_idx on keywords (enabled) where enabled;

-- ── 采集运行记录 ──────────────────────────────────────
create table if not exists runs (
  id              uuid primary key default gen_random_uuid(),
  keyword_id      uuid not null references keywords(id) on delete cascade,
  run_date        date not null,
  trigger         text not null default 'schedule',   -- schedule | manual
  status          run_status not null default 'queued',
  started_at      timestamptz,
  finished_at     timestamptz,
  items_found     int not null default 0,
  items_new       int not null default 0,
  fulltext_ok     int not null default 0,
  fulltext_failed int not null default 0,
  images_ok       int not null default 0,
  images_failed   int not null default 0,
  tokens_in       int not null default 0,
  tokens_out      int not null default 0,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now()
);

-- 同日只允许一条“非失败”的运行：失败可重跑。
-- claim_run 的 on conflict do nothing 依赖这个部分唯一索引实现幂等（§4.5）。
create unique index if not exists runs_keyword_day_success
  on runs (keyword_id, run_date)
  where status in ('queued','running','ok','no_update');
create index if not exists runs_keyword_date_idx on runs (keyword_id, run_date desc);
create index if not exists runs_created_idx on runs (created_at desc);

-- ── 日报：一个关键词一天一条 ──────────────────────────
create table if not exists digests (
  id          uuid primary key default gen_random_uuid(),
  keyword_id  uuid not null references keywords(id) on delete cascade,
  digest_date date not null,
  title       text not null,
  summary_md  text not null default '',
  bullets     jsonb not null default '[]'::jsonb,   -- [{text, item_ids:[uuid]}]
  is_read     boolean not null default false,
  is_starred  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (keyword_id, digest_date)
);
create index if not exists digests_keyword_date_idx on digests (keyword_id, digest_date desc);
create index if not exists digests_unread_idx on digests (keyword_id) where not is_read;
create index if not exists digests_search_trgm on digests
  using gin ((title || ' ' || summary_md) gin_trgm_ops);

-- ── 条目：单条消息 ────────────────────────────────────
create table if not exists items (
  id              uuid primary key default gen_random_uuid(),
  keyword_id      uuid not null references keywords(id) on delete cascade,
  digest_id       uuid references digests(id) on delete set null,
  url             text not null,
  url_hash        text not null,                     -- sha256(规范化URL)
  title           text not null,
  source_domain   text not null,
  published_at    timestamptz,
  discovered_at   timestamptz not null default now(),
  discovery_type  text not null,                     -- rss | gnews | listing | websearch
  rss_summary     text,
  search_text     text,                              -- 全文前 2000 字，供搜索命中（§8）
  fulltext_key    text,
  fulltext_bytes  int,
  fulltext_status fulltext_status not null default 'pending',
  fetch_tier      fetch_tier,
  fetch_error     text,
  images          jsonb not null default '[]'::jsonb, -- [{index,key,alt,width,height,bytes}]
  image_count     int not null default 0,
  image_bytes     int not null default 0,
  is_starred      boolean not null default false,
  unique (keyword_id, url_hash)                       -- 去重主力
);
create index if not exists items_digest_idx on items (digest_id);
create index if not exists items_keyword_discovered_idx on items (keyword_id, discovered_at desc);
create index if not exists items_cleanup_idx on items (fulltext_status, discovered_at)
  where fulltext_status = 'ok';                       -- 清理任务扫描用
create index if not exists items_search_trgm on items
  using gin ((title || ' ' || coalesce(search_text,'')) gin_trgm_ops);

-- ── 导出文件：按需生成 + 到期清理 ─────────────────────
create table if not exists exports (
  id          uuid primary key default gen_random_uuid(),
  digest_id   uuid not null references digests(id) on delete cascade,
  format      export_format not null,
  storage_key text not null,
  bytes       int not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  unique (digest_id, format)
);
create index if not exists exports_expires_idx on exports (expires_at);

-- ── 触发器：updated_at ────────────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists keywords_touch on keywords;
create trigger keywords_touch before update on keywords
  for each row execute function touch_updated_at();

-- ── RLS：全开、不写任何策略 ───────────────────────────
-- A 和 W 都用 service_role key（绕过 RLS）。
-- 这样即便 anon key 泄露，也是零权限（§2.5）。
alter table keywords enable row level security;
alter table runs     enable row level security;
alter table digests  enable row level security;
alter table items    enable row level security;
alter table exports  enable row level security;
