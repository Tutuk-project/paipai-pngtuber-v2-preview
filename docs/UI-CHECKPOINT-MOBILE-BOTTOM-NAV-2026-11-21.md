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
