# Checkpoint — 21 November 2026: Mobile workspace, accessories and live Collaboration OBS

## Repository state
- Repository: `Tutuk-project/paipai-pngtuber-v2-preview`
- Active branch: `main`
- Baseline before this change set: `5f32fc2e0858421e1de14f849ae1a8613c1daeed`
- This checkpoint is additive. Offline v1.7 RELEASE and Online v1.0 remain outside this repository change.

## User-confirmed findings
1. The mobile dock exposed a redundant Settings item alongside About.
2. Accessory upload failed with PostgreSQL error `[22003]` because the API inserted `Date.now()` (milliseconds) into `vio_character_accessories.sort_order`, a PostgreSQL `integer`.
3. The generated Collaboration OBS overlay did not reliably track live Personal Controls. The preview changed while dragging, but persistence and Realtime broadcast were deferred until the slider `change` event.
4. The OBS output should not include the editor-only composition grid or center dummy. Character position and scale must match the Creator preview.

## Changes committed
- Removed the redundant Settings item from the mobile bottom dock. Kept Audio, Visual +, Avatar, Aksesoris, About.
- Moved the Background workspace from Avatar into Visual +. Avatar remains focused on character library, expression assets and avatar motion/layout settings.
- Fixed accessory ordering in the Edge Function: query the current highest `sort_order` for the selected character and append the next integer. Do not store millisecond timestamps in this integer field.
- Added a throttled Realtime layout broadcast while the user drags scale/X/Y controls. The final slider change still persists the full value to `vio_room_overrides`; Realtime broadcasts keep an already-generated OBS source synchronized without regenerating its URL.
- Removed composition grid and center dummy drawing from the OBS collaboration compositor. They remain Creator preview guides only.
- Bumped frontend and overlay asset query versions to force updated mobile/OBS JavaScript to load.
- Added regression assertions for dock order, background ownership, accessory sort order, live layout broadcast, and clean OBS output.

## Commit sequence for this checkpoint
- `a38bccf` Fix accessory sort order integer overflow
- `203590c` Fix live collaboration layout sync and move background into Visual Plus
- `c00f89f` Remove duplicate Settings dock item and refresh mobile assets
- `849d358` Keep OBS collaboration output clean and apply live personal layout
- `8f5dbf8` Bust OBS overlay renderer cache
- `3ea4fb0` Add regression coverage for accessories and live OBS layout

## Validation status
- Source-level assertions after commit confirmed: Settings dock item absent; Background no longer rendered in Avatar and is included in Visual +; accessory insertion no longer uses `Date.now()`; layout broadcast is scheduled during slider input; OBS compositor no longer draws grid/center dummy.
- GitHub commit status endpoint returned no status entries for the inspected commit. This is **not** evidence that the test suite passed.
- Real-device verification on Android Chrome and the generated OBS Browser Source is still required.
- The Edge Function source change must be deployed to the isolated Vio Studio Development Supabase project before the accessory fix becomes active. Do not deploy it to Supabase Live as part of this checkpoint.
- Test the already-generated Collaboration URL after the Pages and Development Edge Function updates. Change X/Y/scale while the source remains open and confirm the character follows without regenerating the link.

## Next verification sequence
1. Confirm GitHub Pages has deployed the latest `main` commit and hard-refresh Android Chrome.
2. Deploy the updated `vio-api` Edge Function to the separate Development project only.
3. Upload one PNG and one WebP accessory; confirm both appear after refresh and remain draggable.
4. Open a Collaboration OBS link once. Keep it open, drag X/Y/scale controls, and verify the output follows in real time.
5. Confirm grid and center dummy are visible in Creator preview but absent from OBS output.
6. Verify Audio, Visual +, Avatar, Aksesoris and About on POCO X7 Pro.

## Guardrails
- Do not alter Audio Engine or Avatar Renderer unless a test demonstrates a defect there.
- Do not regenerate OBS links to apply ordinary position/scale changes.
- Do not expose grid/dummy guides in the OBS output.
- Do not modify Offline v1.7 RELEASE or Online v1.0.
- Do not apply v2 migrations or Edge Functions to the production Supabase project.
