-- Seeds stood in for real analyses before anything could create one. They
-- point at fake repositories, can never open a map, and break the
-- one-analysis-per-repository constraint that follows. Analyses cascade.
delete from public.projects
where id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102'
);
