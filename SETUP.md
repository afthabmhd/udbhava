# Deployment setup

1. In Supabase, open the SQL editor and run the contents of schema.sql. This creates both registration tables, unique constraints, the status check, and RLS with no client policies. The API does not modify status.
2. In the Supabase project settings, copy the project URL and service-role key. Do not use the anon key for server functions and do not add either value to browser files or git.
3. Create a Vercel project from this repository with the repository root as the project root. The project configuration runs `python build.py`, serves `public/`, discovers the Python functions in api/, and includes Events.csv in each function bundle. Current Vercel build images include Python 3.12, so no alternate build is needed.
4. Add these environment variables in Vercel Project Settings for the environments where registration should work: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REGISTRATION_MODE, and SITE_ORIGIN. Set REGISTRATION_MODE to test first; use live only when ready for real registrations. SITE_ORIGIN must be the full production origin, including https and the domain, with no trailing slash. Set Vercel's Preview environment separately; preview deployments are accepted only outside production.
5. Deploy a Preview and check the event list, registration route, a test registration, and the Vercel function logs. Test mode writes only to test_registrations. Test using unique sample data and remove it from the Supabase dashboard afterward if appropriate.
6. Add the supplied payment QR images under src/assets/upi/ using the filenames below. The registration page shows a readable placeholder for each missing file.
7. After reviewing the test table entries and confirming payment/admin procedures, set REGISTRATION_MODE to live in Vercel Production settings and deploy. The function then writes to registrations.

No Supabase operation has been run by this project change. The site does not provide payment verification; paid submissions remain pending until a human updates status in the Supabase dashboard.

## Payment QR files to supply

- src/assets/upi/cse-1.png and src/assets/upi/cse-2.png
- src/assets/upi/ads-1.png and src/assets/upi/ads-2.png
- src/assets/upi/mech-1.png and src/assets/upi/mech-2.png
- src/assets/upi/civil-1.png and src/assets/upi/civil-2.png
- src/assets/upi/eee-1.png and src/assets/upi/eee-2.png
- src/assets/upi/ece-1.png and src/assets/upi/ece-2.png

## Local development

Run `python build.py`, then `python server.py`. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local environment before testing registration; otherwise the API returns a generic unavailable response. REGISTRATION_MODE defaults to test when missing or invalid. Never use production data for local testing.
