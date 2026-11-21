# Vio Studio v2.0 — Implementation Note: Accessory Editor and Shared Collaboration OBS Layout

Date: 2026-11-21
Status: Active implementation requirements; Android/OBS runtime verification is still required.

## 1. Canonical project references

- Repository: https://github.com/Tutuk-project/paipai-pngtuber-v2-preview
- Active branch verified on 2026-11-21: `main`
- Published preview: https://tutuk-project.github.io/paipai-pngtuber-v2-preview/
- Latest repository commit checked while writing this note: `ac09dbc35266a5bb9782601d1e46d5b96c34517a`
- Latest collaboration rendering fix in the commit history: `d0d309762078ad0fa433116b4f3e5950b382246e`
- Validation recorded by follow-up commit `ac09dbc`: Validate Vio Studio 111/111 passed; Preview validation 44/44 passed; GitHub Pages deployment succeeded.
- The passing CI checks do not prove that the generated Browser Source follows live controls on a physical phone/streaming app. That remains a manual test.

## 2. Supabase Development configuration

Use this isolated Development project only for Vio Studio v2.0 work.

| Setting | Verified value |
|---|---|
| Project name | `vio-studio-v2-dev` |
| Project ref / ID | `nbpqnwjxavuhpiuntcep` |
| Region | `ap-northeast-1` (Tokyo) |
| Project status | `ACTIVE_HEALTHY` |
| Database engine | PostgreSQL 17 |
| Project URL | `https://nbpqnwjxavuhpiuntcep.supabase.co` |
| Frontend key | `sb_publishable_dQXujRGbCUQF60Saj2ubQw_iS18HJYl` |
| Edge Function | `vio-api` |
| Edge Function status | ACTIVE, version 15 |
| Edge Function JWT verification | `verify_jwt=true` |

Frontend configuration uses only the project URL and publishable key. Never put a Supabase secret/service-role key, database password, or Edge Function secret in browser code, repository docs, generated overlay URLs, or client-visible configuration.

The legacy anon key exists but the modern publishable key above is the preferred frontend key. Do not copy the legacy JWT key into new configuration unless compatibility specifically requires it.

### Migrations verified in Development

The live Development migration history currently contains:

1. `001_vio_studio_v2`
2. `002_vio_studio_v2_security_hardening`
3. `003_vio_character_accessories`
4. `004_vio_background_media`
5. `005_vio_storage_cleanup_queue`
6. `006_vio_storage_cleanup_reference_guard`
7. `007_vio_security_advisor_hardening`
8. `008_move_rls_helpers_to_private_schema`
9. `009_saved_character_library`

Relevant existing tables include `vio_rooms`, `vio_room_members`, `vio_room_overrides`, `vio_overlay_devices`, `vio_character_accessories`, `vio_character_assets`, and `vio_profiles`. The inspected public tables have RLS enabled. `vio_room_overrides` is documented as temporary per-user collaboration settings and must not overwrite saved profile preferences.

### Secrets and deployment boundary

- The Development function has used the server-side secret name `VIO_ADMIN_BOOTSTRAP_TOKEN` for initial Admin bootstrap. The value is intentionally not recorded here.
- Keep all privileged secrets in Supabase Edge Function secrets, never in the client.
- The separate production/Live Supabase project must remain untouched.
- Do not deploy migrations or Edge Functions to Live as part of this work.
- The previous deployment history records `vio-api` v15 ACTIVE with JWT verification enabled. Re-check before any future deployment rather than assuming the version has not changed.

## 3. Current UI issue: accessory controls must become a dropdown editor

The current mobile Aksesoris panel (see user screenshot dated 2026-11-21) shows an accessory row with minus/plus controls and a percentage value. The user reports that accessories cannot be dragged.

Replace the current per-item percentage-only control with a dropdown/list selector in the Aksesoris workspace:

- Dropdown lists the accessories belonging to the currently selected character.
- Selecting an item selects only that accessory; editing one item must not move or resize other accessories.
- Each item exposes independent Scale, Rotation, Position X and Position Y controls.
- Support direct pointer/touch drag on the preview/stage to change Position X/Y.
- Keep scale and rotation adjustable from controls; update the preview immediately.
- Persist each accessory's own transform with its accessory metadata and selected character/profile.
- Restore the exact transforms after refresh, profile switch, character switch, and room re-entry.
- Do not couple accessory transforms to the avatar's own X/Y/scale room layout.
- Preserve PNG/WebP transparency and the existing accessory renderer/follow/effect behavior unless a test demonstrates a regression.

Acceptance checks:
1. Upload/select at least two accessories.
2. Drag accessory A; accessory B must remain fixed.
3. Change scale and rotation for A; only A changes.
4. Refresh and reopen the character; both transforms remain correct.
5. Switch characters/profiles and return; transforms remain scoped to the correct character.
6. Test touch drag on Android Chrome, not only mouse drag in desktop tests.

## 4. Critical unresolved requirement: one shared Collaboration OBS link, per-user live character layout

### Expected user experience

A room host generates one OBS Collaboration URL for the room. That generated URL is shared with all users in that room and remains identical for everyone. It is not necessary or desirable to generate a different OBS link for each participant.

Each participant must be able to open the OBS Collaboration controls in Vio Studio and adjust the position and scale of their own character. The change must appear in the already-open generated Collaboration OBS Browser Source in real time. The OBS source must not need a URL regeneration, page reload, or manual refresh.

This is a room-wide shared output with independently controlled participant transforms:
- One room ID and one generated OBS URL per room.
- Each participant owns their own layout values (X, Y, scale) within that room.
- Participant A can move only A's character; participant B can move only B's character.
- All connected viewers of the same room OBS URL see the updated composition.
- Changes from one participant must not overwrite another participant's layout.
- The same generated URL must continue working when participants change their own layout.

### Known failure and history

The user has reported that the generated OBS link does not follow the character's position. The earlier source investigation identified several likely contributors:

1. Creator and OBS had separate X/Y-to-canvas transform calculations, allowing preview and OBS to disagree.
2. OBS refreshed transforms only at selected call sites; a missed Realtime event could leave the Browser Source using stale layout data.
3. Realtime-connected fallback polling had been 10 seconds, too slow to mask missed updates.
4. Layout persistence was tied mainly to the slider `change` event, so movement during dragging was not continuously reflected in persisted/broadcast state.
5. The OBS renderer could reuse a stale participant model rather than re-resolving the current transform during every render.
6. The Creator stage cleared before the next animation-frame composite, causing blank intermediate frames during mic/expression/layout changes.
7. Profile/background/assets were reapplied during layout-only updates, which could cause background blinking.
8. Cached Creator/OBS module URLs could keep old renderer code loaded.

The source-level fix series introduced:
- `resolveRoomAvatarPreferences()` as a canonical transform helper shared by Creator and OBS.
- `AvatarRenderer.setRoomLayout()` to update X/Y/scale without rebuilding background, decoded images, accessories, or effect configuration.
- Debounced persistence while dragging and flush on pointer/touch/keyboard release.
- Realtime layout broadcasts and OBS reconciliation on render.
- Realtime-connected polling reduced to 2.5 seconds; disconnected fallback remains 1 second.
- Asset query-version bumps.
- Regression tests for transform arithmetic, shared helper use, background preservation, OBS reconciliation, and touch persistence.

Relevant commits:
- `d0d309762078ad0fa433116b4f3e5950b382246e` — Fix Collaboration OBS position sync and preserve background frames.
- `84d276a8b03a3fb4131e61a235e279ed7c350f1c` — Repair Collaboration regression test expectations.
- `ac09dbc35266a5bb9782601d1e46d5b96c34517a` — Record successful Collaboration fix validation and Pages deployment.

These changes have passed the recorded CI checks, but they do not close the issue until the user confirms the existing generated link follows live changes on the actual OBS/streaming Browser Source. Treat the issue as OPEN until that test passes.

### Required data flow and invariants

1. The Creator's Collaboration controls update the current participant's local in-memory override immediately.
2. Persist the changed `x`, `y`, and `scale` to that participant's own room-member override record. Do not write these temporary values into `vio_profiles` or the character's saved default preferences.
3. Broadcast a Realtime event on the private room channel, identifying the participant by authenticated user/member ID and including a monotonically increasing sequence number plus the changed layout values.
4. The shared OBS page receives the event and updates only the matching participant model.
5. The OBS render loop applies the latest participant model through the same canonical `resolveRoomAvatarPreferences()` transform used by Creator.
6. Every connected OBS client for that room sees the same room composition update. The room's generated URL remains unchanged.
7. On reconnect, initial overlay snapshot/polling must load the latest persisted per-member overrides so the output converges even if a Realtime event was missed.
8. Sequence handling must reject stale/out-of-order events. A participant's update must never be applied to another member.
9. Layout updates must not reset mic state, expression state, background image/video, accessories, or avatar effects.
10. Editor-only grid and center dummy guides must remain absent from the transparent OBS output.

### Device acceptance test (must use one existing URL)

1. Create/join a room with at least two participants.
2. Generate the Collaboration OBS URL once and open it in the target OBS/streaming Browser Source.
3. Copy/share that exact same URL to a second OBS/browser viewer if available. Confirm both viewers show the same room composition.
4. Without regenerating or reloading the URL, participant A changes X, Y, and scale from the OBS Collaboration controls. Both viewers must show A moving while B stays fixed.
5. Participant B changes their own X, Y, and scale. Both viewers must show B moving while A stays fixed.
6. Keep dragging, not only releasing the slider; the output should visibly track updates during movement with a sensible throttle.
7. Reload one OBS viewer or temporarily disconnect/reconnect Realtime. The overlay must recover the latest saved layout from the snapshot/polling path.
8. Verify the same behavior with 3–4 participants.
9. Trigger Idle/Talking expression and microphone changes while moving characters. Backgrounds must not blink and the character must not disappear.
10. Confirm the URL string did not change during all layout operations.

Record the actual target app, browser/device, room participant count, URL unchanged (yes/no), live X/Y/scale behavior, reconnect recovery, and any console/API/Realtime errors. Do not mark the issue fixed based only on CI or Creator preview.

## 5. Guardrails for the next implementation

- Work only in the active Vio Studio v2.0 development repository and branch `main`.
- Keep Offline v1.7 RELEASE and Online v1.0 untouched.
- Keep Supabase Live untouched; use only `vio-studio-v2-dev`.
- Do not create per-user OBS links. The room has one shared generated link.
- Do not regenerate the link to apply X/Y/scale changes.
- Keep participant layout overrides isolated per room member.
- Do not rewrite saved profile preferences when changing temporary room layout.
- Do not modify AudioEngine or Solo OBS renderer for a Collaboration-only defect unless a reproducible test proves it is involved.
- Keep Creator preview grid/center guides out of OBS output.
- Add regression tests for every discovered failure, then perform the real Android/OBS test.

## 6. Next work order

1. Implement the Aksesoris dropdown editor and independent drag/scale/rotation/position persistence.
2. Reproduce the OBS position issue with one existing generated room URL and at least two participants.
3. Trace the full control -> local state -> database persistence -> private Realtime broadcast -> OBS member model -> canonical transform -> canvas draw path.
4. Fix the actual failing boundary, not just the Creator preview.
5. Add tests for shared URL semantics and per-member transform isolation.
6. Re-run CI and Pages deployment.
7. Complete the Android Chrome and target Browser Source acceptance test before closing the OBS issue.


## 7. Implementation update — 2026-11-21

The accessory editor repair has now been implemented in the v2 preview source:

- Declared the pointer-drag state explicitly. The previous handler assigned to `accessoryDragState` without a module-level declaration; ES modules run in strict mode, so the first successful accessory pointer-down could throw a `ReferenceError`.
- Removed the old behavior that treated any tap elsewhere on the canvas as a drag of the currently selected accessory. A drag now starts only when the pointer hits an accessory's rendered bounds.
- Added rotated bounding-box hit testing that accounts for avatar-follow transform and each accessory's own rotation.
- Replaced the accessory card/stepper-only workspace with an accessory dropdown and a selected-item editor.
- Added independent Scale, Rotation, Position X and Position Y controls.
- Added pointer capture, touch-action handling, and a safe finish path for pointer-up, pointer-cancel and lost pointer capture.
- Accessory transforms are persisted per accessory; they do not modify the avatar's profile scale or Collaboration room layout.
- The shared renderer applies accessory rotation around the accessory center.
- Added migration `010_accessory_rotation.sql`; Development database migration history confirms it is applied and `rotation` exists as a non-null double precision column defaulting to 0, constrained to -180..180.
- Updated `vio-api` to accept, validate, and return rotation for editor assets, Collaboration room snapshots, and OBS overlay snapshots. Development Edge Function is ACTIVE at version 17 with JWT verification enabled.
- Updated app/CSS cache versions and added renderer/source regression coverage.

### Validation boundary

- Supabase Development schema: verified by a read-only query; the `rotation` column exists with default 0 and is non-null.
- Supabase Development Edge Function: `vio-api` v17 ACTIVE, `verify_jwt=true`.
- GitHub Pages preview validation: latest observed run passed on commit `9870a7007f2cb8ee8f9ae12f5bd5719e6e13a201`.
- GitHub Validate Vio Studio and latest Pages deployment workflow are still being rechecked after the final regression-test adjustment.
- Actual POCO X7 Pro touch-drag, persistence-after-refresh, and rendered result verification remains required. Do not call the issue fully closed until those checks pass.
- Supabase Live, Offline v1.7 RELEASE, and Online v1.0 were not modified.
