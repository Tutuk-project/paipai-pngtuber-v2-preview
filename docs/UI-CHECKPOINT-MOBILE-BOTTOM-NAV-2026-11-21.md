# Vio Studio v2.0 — Mobile Navigation UI Checkpoint
Date: 2026-11-21

## Request
Move the mobile side navigation to a bottom navigation dock matching the supplied reference direction, while retaining Vio Studio's original logo, original menu icons, and menu names. Avoid changing application navigation semantics or other systems.

## Changes
- `assets/app.css`: at viewport widths up to 900px, the sidebar becomes a fixed bottom dock with horizontal scrolling, safe-area spacing, translucent Vio styling, and vertically stacked original icons plus visible labels.
- The original Vio Studio brand mark and brand copy remain at the top of the screen in a fixed header strip.
- Workspace top/bottom padding accounts for the brand strip and bottom dock.
- The Collaboration room view also receives the bottom navigation on mobile; it no longer hides the sidebar in this breakpoint.
- `src/app.js`: the existing Logout button is moved into the bottom navigation on mobile and returned to its original sidebar footer on wider screens. Its existing event listener and logout function are unchanged.
- Desktop/tablet widths above 900px retain the existing collapsible left sidebar.
- No changes to Supabase, API actions, microphone, renderer, room state, overlay generation, or profile data.

## Regression test
Added a source test checking brand retention, bottom navigation layout, icon/label visibility, logout placement, and safe-area support.

## Verification
- Pending GitHub Actions validation and Pages deployment for the UI-only commit.
- Real-device visual check is still required on Android Chrome at narrow phone widths and tablet/desktop widths.
