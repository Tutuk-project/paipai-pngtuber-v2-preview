# Vio Studio v2.0 — Mobile Navigation UI Experiment
Date: 2026-11-21

## Original request
Move the mobile side navigation to the bottom while retaining Vio Studio's original logo, original menu icons, and menu names.

## Experiment and regression
The first implementation forced the complete sidebar into a fixed bottom dock and moved the Logout button between DOM parents using a viewport check in JavaScript. This was too invasive and caused a reported project regression. The automatic validation passing did not establish runtime compatibility across all views.

## Rollback performed
- Removed the fixed bottom-dock CSS rules.
- Restored the original responsive/collapsible sidebar layout.
- Restored the original Logout button DOM placement under `.sidebar-bottom`; its existing action/listener remains unchanged.
- Added a regression test to ensure navigation does not move Logout into the navigation element or depend on viewport JS for DOM relocation.
- Retained all unrelated renderer, Collaboration, profile, microphone, overlay, and backend code.

## Current status
The bottom-navigation design experiment is rolled back. The app should be tested again on Android Chrome and Collaboration after the latest Preview deployment. A safer visual redesign should be done using a dedicated mobile navigation container that does not repurpose the existing sidebar or move live controls between DOM parents.


## Blank editor workspace repair
- The reported Android screen showed the top bar and session footer while the Editor view remained hidden.
- Updated successful login navigation so the Editor view is revealed before navigation and settings rendering. A failure in optional sidebar/settings rendering therefore cannot leave the workspace hidden.
- Made view switching and navigation rendering tolerate missing optional DOM nodes.
- Removed the redundant operation that re-appended the Logout button to its existing sidebar parent.
- Added source regression tests for the login-to-editor order, sidebar control placement, and guarded view switching.
- Added a version query to the app CSS and JS references in `index.html` to prevent stale browser asset cache from masking the repair.

## Verification status
- Source changes are committed on `main`.
- The preview-validation workflow runs on push. A completed run for the repair commits has not yet been confirmed here.
- Final visual confirmation still requires reloading the deployed Pages build on Android Chrome and checking Creator, Character, Microphone, Visual Effect, Admin, and Collaboration views.


## Creator Studio mobile redesign — 2026-11-21
- Used `Creator Studio — Mobile-html.zip` as a visual reference only. The static React/design-tool runtime and sample avatar image were not copied into production.
- Added a responsive V+ Creator Studio header and a five-item mobile dock: Stage, Background, Audio, Effects, and Profile.
- Mapped dock actions to existing application views and settings accordions:
  - Stage → scrolls to the existing live avatar preview; from Admin it returns to the Creator workspace first
  - Background → existing Visual Effect+ workspace, opening its Background accordion
  - Audio → existing microphone settings
  - Effects → existing Visual Effect+ workspace, opening the Makeup/effect controls
  - Profile → existing account profile settings; Character & Assets remains available from the account/navigation drawer
- Added a separate mobile account/navigation drawer so Admin Center, Test Lab, and Logout remain reachable without overloading the five primary dock items.
- Added neon cyan / purple / magenta mobile styling, frosted panels, safe-area-aware dock spacing, and portrait-friendly preview layout.
- The dock is hidden in Collaboration room mode; its existing landscape stage and room controls remain the active room UI.
- Only `index.html`, `assets/app.css`, `src/app.js`, regression tests, and this checkpoint were changed. The AudioEngine, AvatarRenderer, OBS overlay runtime, and Supabase Edge Function were not edited.
- Added regression coverage for dock targets, action mappings, existing engine imports/canvases, and room-mode dock hiding.

## Validation
- JavaScript syntax parsing passed for `src/app.js` and `tests/security-hardening.test.mjs` after normalizing module-only `import.meta` references for the syntax check.
- CSS brace/string/comment balance passed.
- Five dock target IDs and cache-busting references were verified against the deployed HTML.
- GitHub Actions runtime result and real-device visual QA remain to be confirmed after deployment.


## Checkpoint update — 2026-11-21, post-redesign verification plan

### Repository state
- Repository: `Tutuk-project/paipai-pngtuber-v2-preview`
- Branch: `main`
- Latest verified commit: `9027b60442de490bf562a0cafa47aa5ed0366898` — `Bust mobile navigation JavaScript cache after final wiring`
- CSS cache key: `app.css?v=20261121-cyber-ui-1`
- JavaScript cache key: `app.js?v=20261121-cyber-ui-2`

### Current UI implementation
- The V+ Creator Studio mobile redesign is committed. It uses the supplied Creator Studio mobile ZIP as a visual reference only; the prototype's static mock avatar and runtime were not copied.
- Mobile dock actions are wired to existing application functionality:
  - Stage: scrolls to the existing avatar preview; if currently in Admin, it returns to the Creator view first.
  - Background: opens the existing Visual Effect+ settings and focuses the Background accordion.
  - Audio: opens the existing microphone settings.
  - Effects: opens the existing Visual Effect+ settings and focuses the Makeup/effect accordion.
  - Profile: opens existing account profile settings.
- Character & Assets, Admin Center, Test Lab, and Logout remain reachable from the account/navigation drawer.
- Collaboration room mode hides the mobile dock so the existing landscape room stage and controls remain unobstructed.
- Mobile presentation includes neon cyan/purple/magenta colors, frosted cards, responsive square preview, mic/OBS controls, microphone meter, avatar scale controls, and safe-area-aware floating navigation.

### Engine and system preservation
The following production files were checked and remained unchanged during this UI redesign:
- `src/avatar-renderer.js`: `33c8d059cc071da44bc5f41976718f2fdea79049`
- `src/audio-engine.js`: `539601a2d264a68bb4cae1d7166a1fdb25935913`
- `src/overlay.js`: `4ee8e82e046649672903340baf9433f47f137d2e`
- Supabase Edge Function `supabase/functions/vio-api/index.ts`: `557a78c877a1134836ff9e5b312c88160b44c269`
- No renderer, audio engine, OBS overlay runtime, or Edge Function logic was intentionally modified by this UI-only work.

### Source-level verification
- `src/app.js` syntax parsing passed.
- `tests/security-hardening.test.mjs` syntax parsing passed after correcting a malformed assertion.
- CSS brace/string/comment balance passed.
- Five mobile dock targets, dock handlers, settings accordion IDs, Collaboration dock hiding, and asset cache keys were verified.
- These are source checks, not a substitute for browser runtime or visual QA.

### GitHub Actions observation
The user's latest screenshot shows:
- Preview Validation run #146, commit `9027b60`: green.
- Preview Validation run #145, commit `02ef4fd`: green.
- Earlier intermediate runs #142, #143, and #144: red.
- Other displayed runs for the redesign/documentation and regression additions were green.
- Treat the red runs as failures on intermediate commits, not proof that the latest `main` source is failing. The screenshot confirms #146 and #145 are green; it does not independently prove runtime visual correctness.

### Next action: test first, do not change engine
Do not make further renderer/audio/OBS/backend changes until the current UI and deployed build are tested on the user's POCO X7 Pro using Chrome Android.

Test sequence:
1. Mobile UI: header, dock, account drawer, scrolling, safe-area spacing, responsive layout, and no clipped/overlapping controls.
2. Avatar Renderer: upload avatar, expression switching, Idle/Talking, blink, accessories, and scale.
3. Audio Engine: microphone permission, input selection/activation, voice-level meter, and talking expression.
4. Visual Effect+: background, filters, stroke, shadow, bloom, and distortion.
5. OBS: generate link, ensure output is clean with no editor menus, and verify avatar/audio behavior.
6. Collaboration: room entry, avatar synchronization, room controls, and landscape stage; ensure mobile dock stays hidden.

After each test, classify any failure by layer (UI, renderer, audio, effects/settings, OBS overlay, or Collaboration) and only then make a narrowly scoped fix. Do not infer that a green workflow proves the app is visually correct on-device.


## Checkpoint update — OBS Solo/Collaboration, automatic mic, and expression transition repair
Date: 2026-11-21

### User-reported findings
1. Solo OBS link did not capture microphone.
2. Grid and dummy/center guide worked in the Creator preview.
3. Collaboration OBS microphone worked only after manually pressing the overlay's "Aktifkan Mic" button.
4. Creator preview and Solo OBS briefly showed a blank PNG during expression transitions.
5. Both Solo and Collaboration OBS outputs must have no visible UI controls.
6. Collaboration OBS must include the live grid and dummy/center guide; when both are disabled output must be transparent; when either is enabled the composition background should be black.
7. Collaboration OBS resolution and character positions must follow the Creator Collaboration preview.

### Changes committed to `main`
- `src/overlay.js`
  - Requests `getUserMedia` automatically after the overlay resolves the room host identity. This applies to Solo/personal overlay and Collaboration.
  - Keeps Creator-side Realtime talking-state broadcasts as fallback if local OBS capture is denied/unavailable.
  - Requests Web Audio context resume on the first allowed pointer/touch/key interaction through AudioEngine's shared unlock listeners.
  - Removed all overlay-control binding/state code from the runtime.
  - Reads grid and center-guide state from current room member overrides at composite time, so turning a guide off removes it rather than retaining the initial ON state.
  - Draws an opaque black base only when a Collaboration grid or center guide is active. With both disabled, the canvas is cleared and alpha transparency is preserved.
  - Accepts validated Collaboration width/height query parameters, with 320–3840 dimension bounds and an 8.3 MP total pixel cap.
- `src/audio-engine.js`
  - Added invisible retry hooks for `AudioContext.resume()` on `pointerdown`, `touchend`, and `keydown`, for browser/CEF autoplay restrictions. No visible OBS controls were added.
- `src/avatar-renderer.js`
  - Retains the last successfully decoded avatar image while a replacement expression PNG is still loading or fails, avoiding transient blank output during Idle/Talking/Blink transitions.
  - Clears that fallback when the actual avatar asset set changes, preventing the previous character from lingering after a character switch.
  - Uses storage path identity without signed URL query/hash tokens, so refreshed signed URLs do not look like a character change.
  - Triggers a redraw when an image load fails, allowing the fallback to be displayed.
- `src/app.js`
  - Creator continues to request its own microphone when generating a link and broadcasts state as fallback.
  - Generated Solo and Collaboration links no longer set `controls=1`.
  - Collaboration links include the actual `roomStage.width` and `roomStage.height`; the OBS output uses these dimensions.
  - X/Y offsets and scale formulas were compared with the Collaboration preview and match.
  - Removed the old “Copy Link + Controls” action from the generator UI.
- `overlay.html`
  - Removed mic/grid/center-guide buttons and device selector entirely rather than merely hiding them.
  - The status panel is only visible in explicit debug mode (`?debug=1`); ordinary Solo and Collaboration output remains clean.
- Supabase Edge Function was not changed.

### Cache versions
- Creator app: `app.js?v=20261121-obs-fix-3`
- OBS overlay: `overlay.js?v=20261121-obs-fix-4`
- Avatar renderer module: `avatar-renderer.js?v=20261121-avatar-fallback-2`
- Audio engine module: `audio-engine.js?v=20261121-auto-mic-1`

### Source verification completed
- JavaScript syntax parsing passed for `src/app.js`, `src/overlay.js`, `src/avatar-renderer.js`, `src/audio-engine.js`, and `tests/security-hardening.test.mjs`.
- Static checks passed for automatic mic invocation, native `getUserMedia` path, Web Audio unlock hooks, removal of output buttons/controls, live grid/dummy state, black-background/transparent rules, Collaboration dimensions and layout formulas, renderer fallback, character switch isolation, and updated cache keys.
- Current file revisions:
  - `src/app.js`: `3312e13a266487bd9e713a8bbc8fe777608d5f33`
  - `src/overlay.js`: `833af18324cba42a7736f4b99d58f3b8e6bd548f`
  - `src/avatar-renderer.js`: `0ca4b898f4289f21d9f044f4520ef0536b11c7f3`
  - `src/audio-engine.js`: `8fe8f7396acfdea7574dd5cec8304904f2060a66`
  - `overlay.html`: `3aff945fcbfafa3bdd139623a604ad62371f3b62`
  - `index.html`: `fa062e270b54e618897cf64a5d23b6682c8a38f6`
  - `tests/security-hardening.test.mjs`: `4e653472ad1d5d7257b5d44bd1dcedd9318c46f9`
  - Supabase Edge Function remains `557a78c877a1134836ff9e5b312c88160b44c269`
- These checks are source parsing and static assertions only. A full Node test run/GitHub Actions result for the latest OBS repair commits has not yet been independently confirmed.

### Browser permission limitation
- The page now automatically calls `getUserMedia` when the OBS source loads and the host identity is known, so a browser permission prompt can appear.
- JavaScript cannot silently override a user/browser denial or force an OBS/CEF host to grant microphone access. If a permission was previously denied or the host blocks capture, the site/Browser Source microphone permission must be allowed in that host's settings and the source reloaded.
- Web Audio may remain suspended until user activation in some Chromium/CEF contexts. The first click/tap/key on the host page silently retries `AudioContext.resume()`. This adds no controls to the OBS output.
- Creator microphone Realtime state broadcasts remain a fallback for avatar expression state; they do not carry microphone audio into the OBS source.

### Next required device QA — no additional code changes before this pass
On the user's POCO X7 Pro / Chrome Android and then inside the intended OBS Browser Source:
1. Open a new Solo OBS link. Confirm permission prompt appears automatically; allow microphone. Speak and check Talking/Idle transitions. Also test the previously-denied permission case.
2. Open a Collaboration OBS link. Confirm permission prompt appears without an overlay button; test microphone capture and Creator broadcast fallback.
3. Confirm both output links show no controls or editor UI, including during connection errors.
4. In Collaboration, toggle grid and dummy/center guide ON. Confirm black background, correct guide, resolution matching Creator stage, and matching avatar scale/X/Y positions.
5. Toggle both guide layers OFF. Confirm alpha transparency returns in OBS (test over a colored OBS scene source, not only a black preview).
6. Switch Idle/Talking/Blink expressions rapidly in Creator and OBS. Confirm no transient blank PNG. Then switch to a different character and confirm the previous avatar never flashes or remains.
7. Verify Solo output sizing still follows the Solo profile output dimensions and verify Collaboration remains the selected room-stage dimensions.

Do not report the OBS fixes as device-verified until these checks are completed. Classify any failure as permission/browser host, audio state, guide compositing, output sizing/layout, or avatar asset-transition issue before changing code.
