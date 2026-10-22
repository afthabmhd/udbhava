# Deployment setup

1. Run the updated schema.sql in the configured Supabase project to allow school registration rows to omit school name or registration number. The script creates both registration tables where needed, applies the nullable-column migration to existing tables, retains unique constraints and the status check, and enables RLS with no client policies. The API does not modify status.
2. In the Supabase project settings, copy the project URL and service-role key. Do not use the anon key for server functions and do not add either value to browser files or git.
3. Create a Vercel project from this repository with the repository root as the project root. The project configuration runs `python build.py`, serves `public/`, discovers the Python functions in api/, and includes `udbhava_events.csv` in each function bundle. Current Vercel build images include Python 3.12, so no alternate build is needed.
4. Add these environment variables in Vercel Project Settings for the environments where registration should work: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REGISTRATION_MODE, and SITE_ORIGIN. Set REGISTRATION_MODE to test first; use live only when ready for real registrations. SITE_ORIGIN must be the full production origin, including https and the domain, with no trailing slash. Set Vercel's Preview environment separately; preview deployments are accepted only outside production.
5. Deploy a Preview and check the event list, registration route, a test registration, and the Vercel function logs. Test mode writes only to test_registrations. Test using unique sample data and remove it from the Supabase dashboard afterward if appropriate.
6. Payment QR images are supplied under src/qr/. For each department, file 1 is the primary QR and file 2 is the fallback. UDBHAVA-level events use spot registration and do not display online payment QR codes or request UPI references; other charged events use their department pair. The event's Registration Fee is shown as supplied with a rupee prefix when it is not already marked free; the site does not calculate a payment total from fee text.
7. After reviewing the test table entries and confirming payment/admin procedures, set REGISTRATION_MODE to live in Vercel Production settings and deploy. The function then writes to registrations.

The Supabase project is named `udhbava` and is in Mumbai; its schema is applied. No registration rows have been inserted. The site does not provide payment verification; paid submissions remain pending until a human updates status in the Supabase dashboard.

## Payment QR files

- src/UPI/CSE 1.png and src/UPI/CSE 2.png
- src/UPI/ADS 1.png and src/UPI/ADS 2.png
- src/UPI/MECH 1.png and src/UPI/MECH 2.png
- src/UPI/EEE 1.png and src/UPI/EEE 2.png
- src/UPI/ECE 1.png and src/UPI/ECE 2.png
- src/UPI/Civil 1.png and src/UPI/Civil 2.png

The Civil QR pair is enabled in the registration page; Civil registrations remain subject to the event's server-side open/closed state.

## Local development

Run `python build.py`, then `python server.py`. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local environment before testing registration; otherwise the API returns a generic unavailable response. REGISTRATION_MODE defaults to test when missing or invalid. Never use production data for local testing.
