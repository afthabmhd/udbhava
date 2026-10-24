-- Add editable seat limits. "Open" means there is no registration cap.
alter table public.events
    add column if not exists seats text not null default 'Open';

do $migration$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'events_seats_format_check'
          and conrelid = 'public.events'::regclass
    ) then
        alter table public.events
            add constraint events_seats_format_check
            check (seats = 'Open' or seats ~ '^[1-9][0-9]*( (participants?|teams?))?$');
    end if;
end;
$migration$;

update public.events
set seats = case slug
    when 'civil-clay-studio' then '40 participants'
    when 'cse-offscript' then '50 participants'
    when 'cse-quizbuzz' then '36 teams'
    when 'cse-web-weaver' then '50 participants'
    else 'Open'
end,
updated_at = now();

create or replace function public.enforce_event_seat_limit()
returns trigger
language plpgsql
as $$
declare
    event_seats text;
    seat_limit integer;
    active_count bigint;
begin
    -- Lock the event row to serialize concurrent registrations for this event.
    select seats into event_seats
    from public.events
    where slug = new.event_slug
    for update;

    if event_seats is null or event_seats = 'Open' then
        return new;
    end if;

    seat_limit := substring(event_seats from '^[0-9]+')::integer;
    execute format(
        'select count(*) from public.%I where event_slug = $1 and status <> %L',
        tg_table_name,
        'rejected'
    ) into active_count using new.event_slug;

    if active_count >= seat_limit then
        raise exception using errcode = 'P0001', message = 'event_seats_full';
    end if;

    return new;
end;
$$;

drop trigger if exists registrations_enforce_event_seat_limit on public.registrations;
create trigger registrations_enforce_event_seat_limit
before insert on public.registrations
for each row execute function public.enforce_event_seat_limit();

drop trigger if exists test_registrations_enforce_event_seat_limit on public.test_registrations;
create trigger test_registrations_enforce_event_seat_limit
before insert on public.test_registrations
for each row execute function public.enforce_event_seat_limit();
