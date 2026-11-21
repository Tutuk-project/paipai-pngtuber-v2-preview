# Vio Studio · PNGTuber v2.0 (development foundation)

This is the first modular v2.0 foundation for the existing PNGTuber project. It is intentionally additive: it does not replace the current v1.0 deployment or touch the Offline v1.7 release.

## What is included

- New responsive UI shell with collapsible icon-only / icon+label sidebar.
- Username-first login gate on every visit. After a device is paired once, returning use asks only for the username while the Supabase anonymous session remains on that device; app logout retains the device binding.
- Admin-created User / Tester accounts; no public registration route.
- One-time device pairing code for first use or a new device. This is not a reusable password.
- Admin bootstrap for `paipai77` through a one-time server-side bootstrap token.
- Admin overview, account creation, role/disable/delete, pairing-code reissue, device-session revocation, room inspection/edit/closure, profile editing, asset inspection/deletion, recent audit-log viewer, and audited support-view sessions.
- Support View is a scoped, time-limited inspection/edit session, not a full login as the user's identity. Admin keeps their own session; no user credential or device session is copied.
- GO Collaboration host/join foundation, capacity 1–4, 4-digit room code, private Realtime channel, persisted idle/talking snapshot for late-joining overlays, separate per-user room overrides, reconnectable rooms, and a separate one-player OBS room.
- Separate transparent OBS renderer page with per-player scale and X/Y room override rendering.
- New microphone engine with platform-friendly media constraints, fallback capture constraints, AGC/noise suppression preferences, adaptive noise floor, calibrated threshold, hysteresis, hangover, gain control and AudioContext resume support.
- Additive Supabase SQL schema and a single Edge Function API.

## Latest implementation note

- [Accessory dropdown editor and shared Collaboration OBS layout requirements](docs/IMPLEMENTATION-NOTE-2026-11-21-ACCESSORY-EDITOR-SHARED-OBS.md)

## Renderer performance benchmark

The fast CI smoke test validates pixel output at 360×640. A separate high-resolution benchmark exercises a 1080×1920 canvas, four accessories and all seven effects without a full-frame pixel readback. Run it from `v2/` with `node tests/browser-renderer.performance.mjs` after installing the Playwright dependencies and Chromium used by CI. It reports per-frame and average render time; results from GitHub-hosted Chromium are comparative only and do not establish POCO X7 Pro or iOS performance.

## Important state

This is a **development foundation**, not a production release. The active preview repository/branch is `Tutuk-project/paipai-pngtuber-v2-preview` / `main`. The current preview deployment is separate from Offline v1.7 RELEASE and Online v1.0. Keep those baselines unchanged.

## Repository strategy

Work on the active development branch `main` in the preview repository. Do not modify the Offline v1.7 RELEASE or Online v1.0 baselines. The GitHub Pages preview is for v2 development and does not authorize promotion to production. Confirm the deployment workflow after each source change.

## Setup

Follow the full [Supabase Development setup guide](docs/SUPABASE-DEV-SETUP.md) before connecting a backend. It uses a separate Development project and explicitly avoids Supabase Live.

1. Copy `src/config.example.js` to `src/config.js` and use only the separate Development project's URL and public publishable key.
2. Fill `supabaseUrl` and the public `sb_publishable_...` key from the existing Supabase Development project. Never use a secret/service-role key in this file.
3. In Supabase Auth settings, enable Anonymous Sign-Ins. Anonymous auth creates a persistent device session; users who clear browser storage or change devices need a new one-time pairing code from Admin. CAPTCHA / Turnstile is not wired into this frontend yet: integrate and test a challenge-token flow before enabling mandatory CAPTCHA or exposing anonymous sign-in broadly.
4. Use the isolated Development project only. Review and apply migrations in numerical order. Never use the production project for initial integration testing.
5. In the Development project only, set a long random Edge Function secret named `VIO_ADMIN_BOOTSTRAP_TOKEN`. Keep it private. It is used once to bootstrap the first `paipai77` Admin account.
6. Deploy the Edge Function directory `supabase/functions/vio-api` as `vio-api` to the Development project only. The local Supabase CLI config is `supabase/config.toml`; always pass the explicit Development project reference when deploying.
7. Open the v2 preview, enter `paipai77` and the one-time bootstrap token. After the first successful Admin bootstrap, remove `VIO_ADMIN_BOOTSTRAP_TOKEN` from the function secrets and redeploy the function.
8. From Admin, create User / Tester accounts and provide each new user the generated one-time device pairing code privately. Returning use on that device requires only their username. A new device needs a new pairing code from Admin.

### Supabase keys

The Edge Function reads the current `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` variables when available, with legacy key names as compatibility fallback. The secret key remains server-side only.

### Security model

A username alone is not proof of identity. The first login on each device is paired with a single-use code created by Admin. The browser stores a Supabase anonymous session after pairing. The role is always read from the server-side `vio_app_users` table; it is never accepted from local storage or supplied by the client.

### Realtime

The migration adds private-topic authorization policies for room members and OBS overlay devices. Disable **Allow public access** for Realtime channels after confirming the policies are applied. Clients subscribe to `room:<uuid>` with `config.private: true`. Presence is for online membership; Broadcast carries low-frequency state transitions and layout updates. Raw microphone audio is never sent.

## Local syntax check

Run:

```sh
./tests/check-syntax.sh
```
