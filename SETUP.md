# Udbhava ’26 setup

## Admin dashboard go-live steps

1. **Back up both registration tables first.** In Supabase, export `public.registrations` and `public.test_registrations` as CSVs, or run `pg_dump "$SUPABASE_DB_URL" --data-only --table=public.registrations --table=public.test_registrations --file=registrations-before-admin.sql`. Keep the exports outside the repository. No database data was changed while implementing this dashboard.
2. In the Supabase SQL editor, run the new `admin_schema.sql`. It creates only `events` and `admin_audit`; it does not alter either registrations table.
3. Run the event import dry run from the repository root: `python scripts/import_events_to_supabase.py --dry-run`. Confirm 72 rows and review the department and state totals.
4. After reviewing the dry run, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your shell, then run `python scripts/import_events_to_supabase.py`. It upserts only `public.events` by slug. Do not run `schema.sql` for this dashboard.
5. Add these Vercel environment variables for the intended Preview and Production environments: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`, `REGISTRATION_MODE`, and `SITE_ORIGIN`. `ADMIN_EMAILS` is a comma-separated organizer email allow-list. Keep the service role key server-side; it is never included in browser assets.
6. In Supabase Auth, disable public sign-ups and invite organizer accounts. Add those exact email addresses to `ADMIN_EMAILS` (matching is case-insensitive). Organizers can use **Set or reset password** on `/admin` to receive a secure setup link; the reset page requires a password of 12–72 characters.
7. Deploy the `admin-dashboard` branch as a Vercel Preview. For safe event-edit testing, point Preview Supabase variables at an isolated Supabase project/branch, then apply `admin_schema.sql` and import the CSV there too. Preview and Production share event edits if they use the same `SUPABASE_URL`; `REGISTRATION_MODE=test` isolates only registration writes to `test_registrations`. Set Preview `REGISTRATION_MODE=test` and confirm it reads and updates only that registration table. The active `TEST` or `LIVE` mode appears in the dashboard.
8. Test the checklist below. Once approved, merge the branch through your normal review process and deploy. Set Production `REGISTRATION_MODE=live` only when organizers are ready to use `registrations`.

## Verification checklist

- Sign in at `/admin`; non-allow-listed users are denied. A session token is held only in `sessionStorage`.
- Edit an event, choose **Review changes**, verify the confirmation lists only changed fields as old → new, then click **Confirm**. The UI reports “Live on website”; verify `/events.html` and `/register/{slug}` reflect the edit within about 10 seconds without a redeploy.
- Set an event to **Closed** and verify a new registration is rejected by the server.
- Update a registration to **Confirmed** and verify the database value is `verified` (the existing database enum is retained). Check Pending, Confirmed, and Rejected counts and CSV export filters.
- Compare registration row counts before and after. They must be unchanged; the admin API only patches `status` on a registration.
- Verify the Preview dashboard displays `TEST`, then verify the Production dashboard displays `LIVE` only after its environment is configured.

## Configuration and behavior

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key used by registration and admin APIs.
- `SUPABASE_ANON_KEY`: Supabase Auth key used by server-side login and token verification.
- `ADMIN_EMAILS`: comma-separated, case-insensitive organizer allow-list.
- `REGISTRATION_MODE`: `test` for local/Preview, `live` for production (Vercel Production always selects live).
- `SITE_ORIGIN`: full site origin, including `https://`, with no trailing slash.

The event CSV remains a backup and runtime fallback if Supabase is unreachable. Supabase event values are converted to the same API shape as the existing CSV parser. Competition/type and fee are stored as text to preserve values such as “Extempore”, “Free / ₹75”, and “300 / person”. Event dates are stored as text arrays. `spot-only` and `n/a` are represented in the database as `spot_only` and `na` and mapped back for the public API. The public events response uses `Cache-Control: public, s-maxage=10, stale-while-revalidate=30`; registration validation fetches current Supabase event data on each request.

Admin routes use Supabase Auth email/password, enforce `ADMIN_EMAILS`, rate-limit login attempts, and set `Cache-Control: no-store`. Password recovery sends email only to allow-listed organizer addresses and uses the configured `SITE_ORIGIN`; the homepage forwards Supabase recovery tokens to the no-index reset page. The reset endpoint verifies the recovery token and organizer allow-list before updating the password. The Content Security Policy was not loosened: browser requests go only to this site's `/api/admin/*` routes. The build copies only explicit public assets; `admin_schema.sql`, scripts, CSV source, and backups are not copied into `public/`.

## Local development

Run `python build.py`, then `python server.py`. Configure the environment variables above in the local shell. Missing/unavailable Supabase event data falls back to the bundled CSV with a warning. Avoid using Production mode for local testing.
