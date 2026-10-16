alter table public.analyses
  add column commit_sha text;

update public.analyses
set commit_sha = case id
  when '00000000-0000-0000-0000-000000000111' then '0c7de92'
  when '00000000-0000-0000-0000-000000000112' then null
  else commit_sha
end;
