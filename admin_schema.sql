-- Admin dashboard tables. Apply this file manually in the Supabase SQL editor.
-- Registration tables and their rows are intentionally not referenced or changed.
create table if not exists public.events (
    slug text primary key,
    name text not null,
    department_id text not null,
    audience text,
    event_competition text,
    event_dates text[],
    event_time text,
    first_prize text,
    second_prize text,
    third_prize text,
    description text,
    contact_numbers text,
    registration_fee text,
    venue text,
    seats text not null default 'Open' check (seats = 'Open' or seats ~ '^[1-9][0-9]*( (participants?|teams?))?$'),
    registration_state text not null check (registration_state in ('open', 'closed', 'spot_only', 'na')),
    updated_at timestamptz not null default now()
);

create index if not exists events_department_name_idx on public.events (department_id, name);
alter table public.events enable row level security;
revoke all on table public.events from anon, authenticated;
grant all on table public.events to service_role;

create table if not exists public.admin_audit (
    id bigserial primary key,
    admin_email text not null,
    action text not null,
    slug text,
    before jsonb,
    after jsonb,
    at timestamptz not null default now()
);

create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
alter table public.admin_audit enable row level security;
revoke all on table public.admin_audit from anon, authenticated;
grant all on table public.admin_audit to service_role;
grant usage, select on sequence public.admin_audit_id_seq to service_role;
