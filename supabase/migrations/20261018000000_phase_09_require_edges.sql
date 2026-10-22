-- Phase 9 collects require() calls as edges; the check constraint must accept
-- the new kind before an Express repository can be stored.
alter table public.edges
  drop constraint edges_import_kind_check;

alter table public.edges
  add constraint edges_import_kind_check check (import_kind in ('import', 're-export', 'dynamic-import', 'require'));
