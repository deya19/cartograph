insert into public.projects (id, organization_id, repository_url, name)
values
  ('00000000-0000-0000-0000-000000000101', 'org_3KbaISsdzanVtjUY4LvppMpGPqW', 'https://github.com/example/devyaa-demo', 'Devyaa Demo repository'),
  ('00000000-0000-0000-0000-000000000102', 'org_3KYqPTNYhoMxmisEtYSfz2pKhMf', 'https://github.com/example/devyaa-organization', 'Devyaa Organization repository');

insert into public.analyses (id, organization_id, project_id, status, completed_at)
values
  ('00000000-0000-0000-0000-000000000111', 'org_3KbaISsdzanVtjUY4LvppMpGPqW', '00000000-0000-0000-0000-000000000101', 'complete', now()),
  ('00000000-0000-0000-0000-000000000112', 'org_3KYqPTNYhoMxmisEtYSfz2pKhMf', '00000000-0000-0000-0000-000000000102', 'queued', null);
