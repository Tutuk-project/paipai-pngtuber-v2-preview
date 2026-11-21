import test from "node:test";
import assert from "node:assert/strict";
import { AvatarRenderer, resolveRoomAvatarPreferences } from "../src/avatar-renderer.js";

test("room layout transform produces predictable stage-relative X/Y values", () => {
  const profile = { scale: 1.1, avatarScalePercent: 10, background: { mode: "image", src: "signed-bg" } };
  const result = resolveRoomAvatarPreferences(profile, { scale: 0.8, x: 28, y: -7 }, 1920, 1080, 0, 1);
  assert.equal(result.scale, 0.8);
  assert.equal(result.avatarScalePercent, undefined);
  assert.equal(result.offsetX, 215.04);
  assert.equal(result.offsetY, -26.46);
  assert.equal(result.background, profile.background);
});

test("room layout helper applies deterministic default spacing when X is not saved", () => {
  const first = resolveRoomAvatarPreferences({}, {}, 1920, 1080, 0, 2);
  const second = resolveRoomAvatarPreferences({}, {}, 1920, 1080, 1, 2);
  assert.equal(first.offsetX, -130.56);
  assert.equal(second.offsetX, 130.56);
});

test("changing room position never reconfigures or replaces the profile background", () => {
  const renderer = Object.create(AvatarRenderer.prototype);
  const background = { mode: "video", src: "signed-video" };
  renderer.preferences = { scale: 1, offsetX: 0, offsetY: 0, background, effects: { enabled: true } };
  renderer.running = true;
  renderer.drawOnce = () => {};
  renderer.setRoomLayout({ scale: 1.25, offsetX: 215, offsetY: -26 });
  assert.equal(renderer.preferences.scale, 1.25);
  assert.equal(renderer.preferences.offsetX, 215);
  assert.equal(renderer.preferences.offsetY, -26);
  assert.equal(renderer.preferences.background, background);
  assert.equal(renderer.preferences.effects.enabled, true);
});

test("Creator retains the last collaboration stage frame and avoids reapplying media for layout changes", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const start = app.indexOf("function renderRoomParticipants()");
  const end = app.indexOf("function drawRoomCompositionGrid(", start);
  const block = app.slice(start, end);
  const emptyBranch = block.indexOf("if (!visible.length)");
  const firstClear = block.indexOf("ctx.clearRect(0, 0, canvas.width, canvas.height)");
  assert.ok(emptyBranch >= 0 && firstClear > emptyBranch, "populated stage must not be cleared before the empty-room check");
  assert.match(block, /entry\.renderer\.setRoomLayout\(preferences\)/);
  assert.doesNotMatch(block, /entry\.renderer\.setBackgroundImage\(/);
  assert.doesNotMatch(block, /entry\.renderer\.setBackgroundVideo\(/);
});

test("OBS reapplies member transforms on render and reconciles active Realtime connections frequently", async () => {
  const { readFile } = await import("node:fs/promises");
  const overlay = await readFile(new URL("../src/overlay.js", import.meta.url), "utf8");
  const start = overlay.indexOf("function render()");
  const end = overlay.indexOf("async function pollOverlayState()", start);
  const block = overlay.slice(start, end);
  assert.match(block, /ensurePlayerRenderer\(member, canvas\.width, index\)/);
  assert.match(overlay, /realtimeConnected \? 2500 : 1000/);
});

test("room position changes persist during dragging and flush on touch release", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /scheduleRoomLayoutPersistence\(\)/);
  assert.match(app, /range\.addEventListener\("touchend", flushLayout/);
  assert.match(app, /await api\("set_room_override", \{ room_id: currentRoom\.id, overrides: snapshot \}\)/);
  assert.match(app, /await broadcastPlayerLayout\(\)/);
});
