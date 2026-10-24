# Codebase Map

## Overview

This is a static, multi-page Udbhava college tech-fest website with a small Python standard-library server. The browser uses plain JavaScript, HTML, CSS, canvas, and local image assets; there is no frontend framework or package manager. The server serves the built site, reads the root udbhava_events.csv file, exposes an event API, and accepts registration submissions through Supabase.

Current pages are the landing page, events directory, about page, and registration form. The experience includes animated nebula backgrounds, event-type/department filtering, and event-specific hero sections. Registration records are submitted to Supabase; payments are not verified automatically.

## File structure

- Root HTML pages: index.html (landing), events.html, about.html, registration.html, and 404.html.
- Root styles: styles.css, typography.css, events.css, about.css, registration.css.
- Root runtime/data: server.py, build.py, udbhava_events.csv, favicon.ico, favicon.png.
- src/*.js and src/*.css: page behavior and event-section effects. Major modules include main.js, events.js, about.js, register.js, nebula-engine.js, robot.js, soccer.js, bike-stunt.js, shock.js, investigation.js, explore.js, paattoholic.js, and site-footer.js, with paired stylesheets for section-specific effects.
- src/assets/: character, robot, coil, crowd, college, and event imagery; logos are in src/assets/logos/.
- src/data/: older events_seed.csv and events_cards.json. These are not included in the production build and are not the active event source.
- tests/test_registration.py: Python unittest coverage for registration server behavior.
- build.py copies an explicit set of root pages/styles/icons plus supported source assets into public/. It excludes src/data.
- .gitignore excludes generated public/, local data/, and Python bytecode/cache.

The repository has no package.json, lockfile, frontend build configuration, dependency manifest, or pinned third-party runtime dependencies. Google Fonts are loaded remotely. README.md is stale relative to the current multi-page site and backend.

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

The landing page can link to events.html with category query parameters, but events.js does not currently consume those parameters to preselect a category. The event directory filters by department and Event Competition.

## Components/modules

- main.js coordinates landing interactions and initializes shared effects.
- nebula-engine.js provides the reusable animated glyph/particle field.
- robot.js, soccer.js, bike-stunt.js, shock.js, investigation.js, and paattoholic.js implement event-specific animations and interactions.
- explore.js implements the landing page event/category exploration cards.
- events.js loads /api/events, renders event cards and details, and handles department, competition, and search filtering.
- about.js handles about-page behavior.
- site-footer.js and site-footer.css provide the shared footer.
- register.js loads event details and controls registration form behavior.
- registration_service.py owns event CSV parsing, public event mapping, registration validation, throttling, duplicate checks, and Supabase persistence; server.py routes requests locally.
- build.py copies source files into the generated public site.
- tests/test_registration.py exercises registration server cases.

## Data today

udbhava_events.csv at the repository root is the active event source. It has 71 rows and 15 columns: slug, Event Name, Event Competition, Date, Time, First Prize, Second Prize, Third Prize, Description, Department, Contact Numbers, Registration Fee, Venue, Registration State, Audience. Literal n/a values are normalized to unavailable values by the API. Dates are parsed explicitly as dd/mm/yyyy and comma-separated dates are returned as separate date strings. Event times may be a single time or a start-end range.

The seven departments represented are UDBHAVA, CSE, ADS, MECH, CIVIL, EEE, and ECE. Registration State is the event registration gate: open events accept submissions, while closed and n/a states do not. The current source contains 68 open events, two spot-registration-only events, one closed event, and one event with no registration required. CSE Festival of Fury is spot-registration-only. ADS includes separate 3kg and 5kg Robo Soccer events that share a cover image; Robot Expo is open to visitors without registration. Registration forms retain participant, institution, phone, and registration number fields; school name and school ID/admission number are optional for school-audience events. UDBHAVA events use spot registration and collect fees at the registration spot; other fee-charging events display their department QR pair and request a UPI transaction reference.

The active server maps CSV columns to API fields for slug, name, department, audience, competition, dates, time, three prize values, description, contact numbers, fee, venue, and registration state. Event cards and details use these fields. The browser does not read the CSV directly.

The older src/data/events_seed.csv and src/data/events_cards.json are legacy reference datasets. They are unused by runtime code and excluded from public/; udbhava_events.csv is the sole active event dataset.


## Data flow

1. registration_service.py reads and validates udbhava_events.csv when serving the event API or handling registration.
2. GET /api/events returns mapped event data and Registration State; n/a values are not exposed as literal text.
3. events.js fetches that API and renders event cards, details, department filters, competition filters, and search.
4. register.js requests the same API to resolve the selected event, display its details, select department QR images, and render the current registration form.
5. The browser submits to POST /api/register. The server checks Registration State, validates the participant and payment-reference fields when applicable, applies duplicate/rate/origin checks, and writes through Supabase.
6. There is no provider callback or payment verification step. Charged-fee registrations collect UPI references and show department QR images, but this does not establish that a payment occurred.

## Design system

The site uses a black background with violet/purple nebula effects, white display text, and occasional blue/pink accents. typography.css defines global typography including Black Ops One display styling and Inter body/UI styling, with remote Google Fonts loading and fallback stacks. Root styles and page/section CSS files define responsive layouts, card surfaces, borders, glow, and mobile adjustments.

The visual identity relies heavily on canvas/glyph effects in nebula-engine.js and section-specific image assets. The project has no documented design tokens or component library; styling is distributed across root and src CSS files. Event cards use generated/fallback artwork when a matching per-event image is unavailable.

## Planned feature status

Based on the current implementation and project notes/code:

- Event registration route and event lookup by slug: implemented.
- Event form fields and server-side validation: implemented; phone, registration number, participant name/college, hostel accommodation preference, and UPI references for fees not marked free are validated.
- Registration-open state: driven only by Registration State. Closed events are refused by the client and server.
- Registration persistence: implemented through Supabase, with separate test and live tables.
- Department QR codes: selected from src/qr by department and displayed on every open event form; charged-fee events request a UPI transaction reference.
- Supabase schema/RLS/service-key integration: implemented; registration rows include a boolean `require_hostel_accommodation` field, defaulting to false for existing records.
- Razorpay integration: not implemented in the current server or client.
- Registration result/status administration, email confirmation, refunds, and payment reconciliation: not implemented.
- Security controls include strict request origin checking, payload validation, an in-memory rate limiter, honeypot handling, duplicate checks, CSV formula escaping, and response security headers. CORS is not enabled as a general cross-origin API.

## Data/files still to create

If the intended production flow is retained, the project still needs:
- Verified payment recipient details or a real payment-provider flow.
- Backups and a retention/deletion process for registration records.
- Payment verification/callback handling before treating a paid registration as complete.
- A production configuration and deployment/TLS/proxy plan.

These are feature gaps, not files created by this audit.


## Risks/issues

1. High — There is no verified payment flow. Charged-fee events collect UPI details and display department QR images, but a submitted form cannot prove payment.
2. Medium — Registration Fee is free text, so some events state multiple rates or participant/team bases; the UI preserves that text rather than deriving a payment total.
3. Medium — Landing-page category links are not read by events.js, so the intended preselected event category does not carry through navigation.
4. Medium — No TLS server is provided. Production security depends on a correctly configured external HTTPS proxy; proxy trust is controlled by configuration and must match deployment.
5. Medium — Several validation/rate protections are in memory, limiting their reliability across multiple processes/hosts.
6. Low — README.md and the legacy CSV/JSON data can mislead maintainers about the actual architecture and active source of event data.
7. Low — build.py recreates public/ from scratch; any manual edits in that generated directory are discarded on the next build.

No secret values are reproduced in this map. Configuration reads environment variables for site origin, proxy-header trust, registration mode, host, and port. Keep real values outside the repository and do not publish private registration CSV data.

## Open questions

- Should registrations continue to write to Supabase test/live tables as configured?
- What payment method is authoritative: verified UPI QR/manual reconciliation or an online provider? Who confirms a payment before registration is accepted?
- How should a future Registration State value of test behave? The current file contains only open and closed.
- Should cards show dates and prize values, or keep those details only in the event details dialog?
- Should landing-page category cards preselect display_group/category, and what URL parameter contract should be used?
- What production host, TLS termination, reverse-proxy headers, and multi-instance behavior are intended?
- What are the retention, access, backup, and deletion requirements for registration data containing personal information?
- Is src/assets/a.png or the unused robot cutout an intentional asset, or leftover material?

