create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  repository_url text not null,
  name text not null,
  default_branch text not null default 'main',
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'complete', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  path text not null,
  language text,
  created_at timestamptz not null default now()
);

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  source_file_id uuid not null references public.files(id) on delete cascade,
  target_file_id uuid not null references public.files(id) on delete cascade,
  import_kind text not null,
  created_at timestamptz not null default now()
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  method text not null,
  path text not null,
  created_at timestamptz not null default now()
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now()
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  kind text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index analyses_organization_id_created_at_idx
  on public.analyses (organization_id, created_at desc);
create index projects_organization_id_idx on public.projects (organization_id);
create index files_analysis_id_idx on public.files (analysis_id);
create index edges_analysis_id_idx on public.edges (analysis_id);
create index routes_analysis_id_idx on public.routes (analysis_id);
create index explanations_analysis_id_idx on public.explanations (analysis_id);
create index file_roles_analysis_id_idx on public.file_roles (analysis_id);
create index insights_analysis_id_idx on public.insights (analysis_id);

alter table public.projects enable row level security;
alter table public.analyses enable row level security;
alter table public.files enable row level security;
alter table public.edges enable row level security;
alter table public.routes enable row level security;
alter table public.explanations enable row level security;
alter table public.file_roles enable row level security;
alter table public.insights enable row level security;

create policy "Organization members can read projects"
  on public.projects for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Organization members can read analyses"
  on public.analyses for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Organization members can read files"
  on public.files for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Organization members can read edges"
  on public.edges for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Organization members can read routes"
  on public.routes for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Organization members can read explanations"
  on public.explanations for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Organization members can read file roles"
  on public.file_roles for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

create policy "Organization members can read insights"
  on public.insights for select to authenticated
  using (organization_id = (select auth.jwt() ->> 'org_id'));

insert into public.projects (id, organization_id, repository_url, name)
values
  ('00000000-0000-0000-0000-000000000001', 'org_demo_alpha', 'https://github.com/example/alpha', 'Alpha repository'),
  ('00000000-0000-0000-0000-000000000002', 'org_demo_beta', 'https://github.com/example/beta', 'Beta repository');

insert into public.analyses (id, organization_id, project_id, status, completed_at)
values
  ('00000000-0000-0000-0000-000000000011', 'org_demo_alpha', '00000000-0000-0000-0000-000000000001', 'complete', now()),
  ('00000000-0000-0000-0000-000000000012', 'org_demo_beta', '00000000-0000-0000-0000-000000000002', 'running', null);
