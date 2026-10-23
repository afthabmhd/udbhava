-- Run this migration in the Supabase SQL Editor for existing projects.
-- Existing registrations default to No; new registrations store the checkbox value.
alter table public.registrations
    add column if not exists require_hostel_accommodation boolean not null default false;

alter table public.test_registrations
    add column if not exists require_hostel_accommodation boolean not null default false;
