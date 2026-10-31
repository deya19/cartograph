-- The agent reads one analysis with no signed-in user of its own. Rather than
-- hand it a key that bypasses row-level security, a signed-in member grants
-- it one analysis for a few minutes: the grant row is the credential, and the
-- read policies below are the only thing that turn it into rows. Only the
-- token's hash is stored, so a copy of this table reads nothing.
create table public.agent_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index agent_grants_analysis_id_idx on public.agent_grants (analysis_id);

alter table public.agent_grants enable row level security;

-- Minting is the ownership proof. The analyses subquery runs under the
-- analyses policy, so another organization's analysis is invisible and the
-- insert fails. The lifetime cap lives here because a check constraint can't
-- compare against the time of insertion. There is deliberately no select,
-- update or delete policy: nobody reads a grant back.
create policy "Organization members can grant the agent one analysis"
  on public.agent_grants for insert to authenticated
  with check (
    organization_id = (select auth.jwt() ->> 'org_id')
    and expires_at <= now() + interval '10 minutes'
    and exists (
      select 1
      from public.analyses
      where analyses.id = agent_grants.analysis_id
        and analyses.organization_id = agent_grants.organization_id
    )
  );

-- Outside the exposed schema so these are not callable over the API. Security
-- definer because anon has no access to agent_grants itself; each returns only
-- what the presented token names, and null for a missing, unknown or expired
-- token, which matches no row.
create schema if not exists private;

create function private.agent_grant_analysis_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select grants.analysis_id
  from public.agent_grants as grants
  where grants.token_hash = encode(
      sha256(convert_to(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-agent-grant', ''), 'UTF8')),
      'hex'
    )
    and grants.expires_at > now()
$$;

create function private.agent_grant_organization_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select grants.organization_id
  from public.agent_grants as grants
  where grants.token_hash = encode(
      sha256(convert_to(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-agent-grant', ''), 'UTF8')),
      'hex'
    )
    and grants.expires_at > now()
$$;

revoke all on function private.agent_grant_analysis_id() from public;
revoke all on function private.agent_grant_organization_id() from public;
grant usage on schema private to anon;
grant execute on function private.agent_grant_analysis_id() to anon;
grant execute on function private.agent_grant_organization_id() to anon;

-- Each policy names both the analysis and its organization, as the grant
-- does. The functions are wrapped in selects so they run once per query, not
-- once per row.
create policy "An agent grant can read its analysis"
  on public.analyses for select to anon
  using (
    id = (select private.agent_grant_analysis_id())
    and organization_id = (select private.agent_grant_organization_id())
  );

create policy "An agent grant can read its analysis's project"
  on public.projects for select to anon
  using (
    organization_id = (select private.agent_grant_organization_id())
    and exists (
      select 1
      from public.analyses
      where analyses.project_id = projects.id
        and analyses.id = (select private.agent_grant_analysis_id())
    )
  );

create policy "An agent grant can read its analysis's files"
  on public.files for select to anon
  using (
    analysis_id = (select private.agent_grant_analysis_id())
    and organization_id = (select private.agent_grant_organization_id())
  );

create policy "An agent grant can read its analysis's edges"
  on public.edges for select to anon
  using (
    analysis_id = (select private.agent_grant_analysis_id())
    and organization_id = (select private.agent_grant_organization_id())
  );

create policy "An agent grant can read its analysis's routes"
  on public.routes for select to anon
  using (
    analysis_id = (select private.agent_grant_analysis_id())
    and organization_id = (select private.agent_grant_organization_id())
  );

create policy "An agent grant can read its analysis's file roles"
  on public.file_roles for select to anon
  using (
    analysis_id = (select private.agent_grant_analysis_id())
    and organization_id = (select private.agent_grant_organization_id())
  );
