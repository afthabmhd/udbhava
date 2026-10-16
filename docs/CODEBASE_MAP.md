# Codebase Map

## Overview

This is a static, multi-page Udbhava college tech-fest website with a small Python standard-library server. The browser uses plain JavaScript, HTML, CSS, canvas, and local image assets; there is no frontend framework or package manager. The server serves the built site, reads the root Events.csv file, exposes a filtered event API, and accepts registration submissions into local CSV files.

Current pages are the landing page, events directory, about page, and registration form. The experience includes animated nebula backgrounds, event-category/departments filtering, and event-specific hero sections. Registration is implemented as a local CSV workflow; there is no payment processor or hosted database integration.

## File structure

- Root HTML pages: index.html (landing), events.html, about.html, registration.html, and 404.html.
- Root styles: styles.css, typography.css, events.css, about.css, registration.css.
- Root runtime/data: server.py, build.py, Events.csv, favicon.ico, favicon.png.
- src/*.js and src/*.css: page behavior and event-section effects. Major modules include main.js, events.js, about.js, register.js, nebula-engine.js, robot.js, soccer.js, bike-stunt.js, shock.js, investigation.js, explore.js, paattoholic.js, and site-footer.js, with paired stylesheets for section-specific effects.
- src/assets/: character, robot, coil, crowd, college, and event imagery; logos are in src/assets/logos/.
- src/data/: older events_seed.csv and events_cards.json. These are not included in the production build and are not the active event source.
- tests/test_registration.py: Python unittest coverage for registration server behavior.
- build.py copies an explicit set of root pages/styles/icons plus supported source assets into public/. It excludes src/data.
- .gitignore excludes generated public/, local data/, and Python bytecode/cache.

There is no docs directory currently. The repository has no package.json, lockfile, frontend build configuration, dependency manifest, or pinned third-party runtime dependencies. Google Fonts are loaded remotely. README.md is stale relative to the current multi-page site and backend.

## Entry points/routing

- / and /index.html serve the landing page.
- /events.html serves the event directory.
- /about.html serves the about page.
- /register/<slug> is validated by the server and serves registration.html.
- /api/events returns the server-filtered event list.
- POST /api/register validates and stores a registration.
- /404.html is the not-found page.
- server.py is the HTTP server entry point; build.py constructs public/ from the source tree.
- Browser entry scripts are linked by each page: main.js for landing behavior, events.js for event filters/cards, about.js for about behavior, register.js for the registration flow, and section scripts for their respective effects.

The landing page can link to events.html with category query parameters, but events.js does not currently consume those parameters to preselect a category. Its client filters use registration_mode; display_group/category deep-link selection is not wired through.

## Components/modules

- main.js coordinates landing interactions and initializes shared effects.
- nebula-engine.js provides the reusable animated glyph/particle field.
- robot.js, soccer.js, bike-stunt.js, shock.js, investigation.js, and paattoholic.js implement event-specific animations and interactions.
- explore.js implements the landing page event/category exploration cards.
- events.js loads /api/events, renders the event cards, and handles department, mode, and search filtering.
- about.js handles about-page behavior.
- site-footer.js and site-footer.css provide the shared footer.
- register.js loads event details and controls registration form behavior.
- server.py owns event CSV parsing, public event filtering, page/API routing, input validation, throttling, duplicate checks, and CSV persistence.
- build.py copies source files into the generated public site.
- tests/test_registration.py exercises registration server cases.

## Data today

Events.csv at the repository root is the active event source. It has 63 rows and 18 columns, ordered as: slug, department_id, guide_ref, name, display_group, registration_mode, fee_basis, fee_basis_confirmed, price_inr, prize_pool, capacity, capacity_unit, team_min, team_max, event_dates, date_status, group_slug, is_open.

The six departments represented are CSE, ADS, MECH, CIVIL, EEE, and ECE. Registration modes include paid_online, free_online, and on_spot. Every current is_open value is FALSE. The server applies a code-level closed override for cse-hackathon, but that does not change the other events'' current opens-soon state.

The active server consumes slug, department_id, name, registration_mode, fee_basis, price_inr, and is_open, then returns the first six fields plus a derived registration_state. Other CSV fields are not currently exposed. date_status/event_dates, prize_pool, team size, and capacity are therefore unavailable to the current event cards and registration page.

The older src/data/events_seed.csv uses a legacy schema including price_paise and needs_confirmation. It is unused by runtime code and excluded from public/. src/data/events_cards.json contains richer legacy event descriptions and display metadata, but current pages/server do not load it. These files can confuse future maintenance because their event information is not authoritative.

For the current CSV, 40 rows have date_status=tbd; prize_pool is blank for three events; several optional capacity/team/date/group values are empty. Date strings use mixed formats. No active code currently parses or displays event dates or prize pools.


## Data flow

1. server.py reads and validates Events.csv when serving the event API or handling registration.
2. GET /api/events returns only the event fields the current interface needs: slug, name, department_id, registration_mode, fee_basis, price_inr, and derived registration_state.
3. events.js fetches that API and renders event cards and filters. It does not read CSV/JSON data directly.
4. register.js requests the same API to resolve the selected event, then renders fields based on registration_mode.
5. The browser submits to POST /api/register. The server validates the payload again, checks the event state and registration mode, applies duplicate/rate/origin checks, and appends a row to a local CSV file under data/ (test mode uses a test CSV).
6. There is no provider callback or payment verification step. Paid registrations collect UPI details and show QR placeholders, but this does not establish that a payment occurred.

## Design system

The site uses a black background with violet/purple nebula effects, white display text, and occasional blue/pink accents. typography.css defines global typography including Black Ops One display styling and Inter body/UI styling, with remote Google Fonts loading and fallback stacks. Root styles and page/section CSS files define responsive layouts, card surfaces, borders, glow, and mobile adjustments.

The visual identity relies heavily on canvas/glyph effects in nebula-engine.js and section-specific image assets. The project has no documented design tokens or component library; styling is distributed across root and src CSS files. Event cards use generated/fallback artwork when a matching per-event image is unavailable.

## Planned feature status

Based on the current implementation and project notes/code:

- Event registration route and event lookup by slug: implemented.
- Event form fields and server-side validation: implemented; phone, registration number, participant name/college, and paid-mode UPI details are validated.
- Registration modes: implemented. paid_online requests UPI details; free_online omits them; on_spot is not an online registration flow.
- Registration-open state: implemented from is_open with the cse-hackathon code override; all CSV rows currently set is_open to false.
- CSV persistence: implemented for local/test use, not a managed production database.
- Department QR codes: not implemented. QR configuration entries are null and no QR asset set exists.
- Supabase schema/RLS/service-key integration: not implemented.
- Razorpay integration: not implemented in the current server or client.
- Registration result/status administration, email confirmation, refunds, and payment reconciliation: not implemented.
- Security controls include strict request origin checking, payload validation, an in-memory rate limiter, honeypot handling, duplicate checks, CSV formula escaping, and response security headers. CORS is not enabled as a general cross-origin API.

## Data/files still to create

If the intended production flow is retained, the project still needs:
- Confirmed department payment QR assets and verified recipient details, or a real payment-provider flow.
- A durable registration store and schema, with migration, access policy, backups, and retention/deletion process.
- Payment verification/callback handling before treating a paid registration as complete.
- A production configuration and deployment/TLS/proxy plan.
- Event artwork under src/assets/events/ if the per-event image path is intended to resolve locally.
- Any desired page content derived from currently unused CSV values (dates, prize pool, capacity, and team limits), with product decisions on formatting and visibility.

These are feature gaps, not files created by this audit.


## Risks/issues

1. High — There is no verified payment flow. Paid mode collects UPI details and displays QR placeholders, but the server has no payment confirmation mechanism; a submitted form cannot prove payment.
2. High — All 63 current Events.csv rows have is_open=false, so the normal registration path is unavailable for every event; the one closed override only changes the displayed state.
3. High — Registrations are stored in local CSV files. This is not a durable multi-instance production database; duplicate protection is process-local and concurrent server instances can race.
4. High — QR configuration is empty. Any paid registration UI that expects department QR images cannot provide the actual payment destination.
5. Medium — fee_basis_confirmed is not returned to the UI. The interface may label an unconfirmed per-person/per-team basis as authoritative.
6. Medium — Landing-page category links are not read by events.js, so the intended preselected event category does not carry through navigation.
7. Medium — Current page/API code omits event_dates, prize_pool, capacity, and team bounds, even though those values exist in Events.csv.
8. Medium — No TLS server is provided. Production security depends on a correctly configured external HTTPS proxy; proxy trust is controlled by configuration and must match deployment.
9. Medium — Several validation/rate protections are in memory and local files, limiting their reliability across multiple processes/hosts.
10. Low — README.md and the legacy CSV/JSON data can mislead maintainers about the actual architecture and active source of event data.
11. Low — build.py recreates public/ from scratch; any manual edits in that generated directory are discarded on the next build.
12. Low — Per-event artwork paths are requested by the UI but no src/assets/events directory is present, so cards may use generic fallback art.

No secret values are reproduced in this map. Configuration reads environment variables for site origin, proxy-header trust, registration mode, host, and port. Keep real values outside the repository and do not publish private registration CSV data.

## Open questions

- Is local CSV persistence intended only for development, or should the registration feature use Supabase or another production database?
- What payment method is authoritative: verified UPI QR/manual reconciliation or an online provider? Who confirms a payment before registration is accepted?
- Which events should be open, closed, or opening soon? The current source marks every event closed to registration.
- Should fee_basis be shown when fee_basis_confirmed is false, and what wording should replace it?
- Should cards show dates, prize pool, team limits, or capacity from the currently unused CSV fields?
- Should landing-page category cards preselect display_group/category, and what URL parameter contract should be used?
- Where should event artwork live, and what image naming/coverage is expected?
- What production host, TLS termination, reverse-proxy headers, and multi-instance behavior are intended?
- What are the retention, access, backup, and deletion requirements for registration data containing personal information?
- Is src/assets/a.png or the unused robot cutout an intentional asset, or leftover material?

