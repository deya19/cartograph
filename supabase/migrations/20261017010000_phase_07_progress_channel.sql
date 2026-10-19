-- Progress is published by the database, not polled by the browser. The
-- payload is what the progress UI shows — stage and message, plus status and
-- error so a failure arrives the same way — never the whole row.
create function public.publish_analysis_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status,
      'stage', new.stage,
      'message', new.stage_message,
      'error', new.error,
      'updated_at', new.stage_updated_at
    ),
    'stage',
    'analysis:' || new.id::text,
    true
  );
  return null;
end;
$$;

-- On our own table, never on realtime.messages.
create trigger analyses_publish_stage
  after update of status, stage, stage_message, error on public.analyses
  for each row
  when (
    old.status is distinct from new.status
    or old.stage is distinct from new.stage
    or old.stage_message is distinct from new.stage_message
    or old.error is distinct from new.error
  )
  execute function public.publish_analysis_stage();

-- This policy is the channel's registration: a private channel delivers
-- nothing without one. Only topics shaped analysis:<uuid> are allowed, and
-- only when that analysis is readable — the subquery runs under the analyses
-- policy, so another organization's progress is unsubscribable for the same
-- reason its rows are unselectable. Ids are compared as text so a malformed
-- topic fails the check instead of raising a cast error.
create policy "Organization members can receive analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) ~ '^analysis:[0-9a-f-]{36}$'
    and exists (
      select 1
      from public.analyses
      where analyses.id::text = split_part((select realtime.topic()), ':', 2)
    )
  );
