-- Model output is cached on the content of what was explained, not on a file
-- row: re-analysing deletes and re-inserts every file, and an unchanged file
-- must still hit. The key already contains the model name and the content
-- hash, so rows are never updated — a different input is a different key.
create table public.ai_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  kind text not null check (kind in ('file-explanation', 'folder-explanation', 'classification')),
  cache_key text not null,
  model text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint ai_cache_organization_key unique (organization_id, cache_key)
);

alter table public.ai_cache enable row level security;

create policy "Organization members can read the AI cache"
  on public.ai_cache for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

-- Explanations are written from the signed-in user's request, so the insert
-- is checked against the same claim that gates reading.
create policy "Organization members can add to the AI cache"
  on public.ai_cache for insert to authenticated
  with check (organization_id = (select auth.jwt() ->> 'org_id'));

-- A model-assigned role is kept apart from files.role: convention owns the
-- structural roles, and only these non-structural ones may come from a model.
alter table public.file_roles
  add constraint file_roles_file_id_key unique (file_id),
  add constraint file_roles_role_check check (role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook'));

alter table public.analyses
  drop constraint analyses_stage_check;

alter table public.analyses
  add constraint analyses_stage_check check (stage in ('fetching', 'selecting', 'parsing', 'labelling', 'storing'));
