# Vio Studio v2.0 checkpoint — 21 November 2026

## Protected baseline
- Pre-refactor source commit: 5b179539276bda7c512a9b659d8d41a059bbe4c6.
- Recovery branch: checkpoint/2026-11-21-before-room-ui-refactor.
- Offline v1.7 RELEASE remains a separate, untouched baseline.
- No Supabase schema migration, secrets, or Offline v1.7 files are changed.

## Preserved working behavior
- OBS Solo direct-to-stage renderer and microphone state handling.
- Collaboration shared stage, per-member profile snapshots, and microphone state sync.
- Profile-saved microphone, avatar, effects, and background configuration.
- Character PNG expressions, animation parameters, accessories, drag positioning, and accessory scaling.
- Existing role-gated Admin and Test Lab menus.

## Changes in this checkpoint
- Room override writes merge partial updates, preventing one slider/checkbox from deleting other room controls.
- Collaboration dummy/center guide is drawn above participant canvases, so opaque avatar backgrounds cannot hide it.
- OBS Solo renderer applies member profile settings, including signed image/video background, before starting its direct render loop.
- Navigation categories: Audio, Visual +, Avatar, Aksesoris, About.
- Mobile Settings remains a shortcut to the stage preview, not a duplicate settings page.
- Avatar holds saved characters, PNG expressions, bobbing/breathing/bounce, mirror, output resolution, and background.
- Aksesoris holds upload, selection, scaling, and deletion.
- Visual + contains visual effect controls only.
- About contains project summary, target audience, repository/preview links, and empty embed/admin-contact placeholders.

## Validation
- Added regression tests for override merge semantics, guide draw order, Solo renderer initialization, menu responsibility, and retained animation/background/accessory controls.
- Added npm test/check scripts and a GitHub Actions validation workflow.
- Runtime verification is still required in Chrome Android and the target OBS Browser Source/CEF host, particularly microphone permission and Solo background rendering.