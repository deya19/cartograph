-- One project per repository per organization, and one analysis per project.
-- Pasting a URL twice finds the existing row instead of creating another;
-- re-running is an update to that analysis, not a new one.
alter table public.projects
  add constraint projects_organization_repository_key unique (organization_id, repository_url);

alter table public.analyses
  add constraint analyses_project_id_key unique (project_id);

-- status says whether the run is alive; stage says where it is or where it
-- died. stage_updated_at is what lets the dashboard call a run stale, since
-- nothing else will ever move a row that a dead process left mid-parse.
alter table public.analyses
  add column stage text check (stage in ('fetching', 'selecting', 'parsing', 'storing')),
  add column stage_message text,
  add column stage_updated_at timestamptz not null default now(),
  add column error text,
  add column adapter text,
  add column summary jsonb,
  add column coverage jsonb,
  add column skipped jsonb;

alter table public.files
  add column directory text,
  add column module text,
  add column extension text,
  add column lines integer,
  add column sha256 text,
  add column role text,
  add constraint files_analysis_path_key unique (analysis_id, path);

alter table public.edges
  add constraint edges_import_kind_check check (import_kind in ('import', 're-export', 'dynamic-import'));

create index edges_source_file_id_idx on public.edges (source_file_id);
create index edges_target_file_id_idx on public.edges (target_file_id);
