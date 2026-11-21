import test from "node:test";
import assert from "node:assert/strict";
import { AvatarRenderer, compareRoomMembers, resolveRoomAvatarPreferences, sortRoomMembers } from "../src/avatar-renderer.js";

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
  assert.match(app, /api\("set_room_override", \{ room_id: currentRoom\.id, overrides: snapshot \}\)/);
  assert.match(app, /await broadcastPlayerLayout\(\)/);
});


test("collaboration member ordering is host-first, join-time stable, then user-id", () => {
  const host = { user_id: "host", is_host: true, joined_at: "2026-11-21T04:00:00Z" };
  const b = { user_id: "b", is_host: false, joined_at: "2026-11-21T04:01:00Z", state: "idle" };
  const c = { user_id: "c", is_host: false, joined_at: "2026-11-21T04:02:00Z", state: "talking" };
  assert.deepEqual(sortRoomMembers([c, b, host]).map(member => member.user_id), ["host", "b", "c"]);
  const updatedB = { ...b, state: "talking", state_updated_at: "2026-11-21T04:03:00Z" };
  assert.equal(compareRoomMembers(host, updatedB), -1);
  assert.deepEqual(sortRoomMembers([c, updatedB, host]).map(member => member.user_id), ["host", "b", "c"]);
});

test("join, leave and rejoin recompute rank without changing identity or host transform", () => {
  const host = { user_id: "host", is_host: true, joined_at: "2026-11-21T04:00:00Z", overrides: { x: 0, y: 0, scale: 1 } };
  const b = { user_id: "b", is_host: false, joined_at: "2026-11-21T04:01:00Z", overrides: { x: 18, y: 0, scale: 1 } };
  const c = { user_id: "c", is_host: false, joined_at: "2026-11-21T04:02:00Z", overrides: {} };
  const rank = members => sortRoomMembers(members).map((member, index, list) => ({
    id: member.user_id,
    layout: resolveRoomAvatarPreferences({}, member.overrides, 1920, 1080, index, list.length)
  }));
  const hostOnly = rank([host]);
  assert.equal(hostOnly[0].layout.offsetX, 0);
  const joinedBC = rank([c, host, b]);
  assert.deepEqual(joinedBC.map(item => item.id), ["host", "b", "c"]);
  assert.equal(joinedBC.find(item => item.id === "host").layout.offsetX, 0);
  const afterBLeaves = rank([host, c]);
  assert.deepEqual(afterBLeaves.map(item => item.id), ["host", "c"]);
  const rejoinedB = { ...b, joined_at: "2026-11-21T04:04:00Z" };
  const afterBRejoins = rank([c, rejoinedB, host]);
  assert.deepEqual(afterBRejoins.map(item => item.id), ["host", "c", "b"]);
  assert.equal(afterBRejoins.find(item => item.id === "host").layout.offsetX, 0);
});

test("collaboration stage and OBS draw one host background before transparent member sprites", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../src/overlay.js", import.meta.url), "utf8");
  const appFrame = app.slice(app.indexOf("function drawRoomStageFrame("), app.indexOf("async function leaveRoom(", app.indexOf("function drawRoomStageFrame(")));
  const overlayFrame = overlay.slice(overlay.indexOf("function drawCompositeFrame("), overlay.indexOf("function render()", overlay.indexOf("function drawCompositeFrame(")));
  assert.match(app, /const spriteProfile = \{ \.\.\.profile, background: \{ mode: "transparent" \} \}/);
  assert.match(overlay, /roomPurpose === "collaboration" \? \{ \.\.\.profile, background: \{ mode: "transparent" \} \} : profile/);
  assert.ok(appFrame.indexOf("roomBackgroundRenderer?.drawBackgroundTo") < appFrame.indexOf("ctx.drawImage(entry.canvas"));
  assert.ok(overlayFrame.indexOf("roomBackgroundRenderer?.drawBackgroundTo") < overlayFrame.indexOf("ctx.drawImage(entry.canvas"));
  assert.equal((appFrame.match(/roomBackgroundRenderer\?\.drawBackgroundTo/g) || []).length, 1);
  assert.equal((overlayFrame.match(/roomBackgroundRenderer\?\.drawBackgroundTo/g) || []).length, 1);
});

test("Creator local collaboration rendering reads the same DB override object as remote members", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const start = app.indexOf("function renderRoomParticipants()");
  const end = app.indexOf("function drawRoomCompositionGrid(", start);
  const block = app.slice(start, end);
  assert.match(block, /const overrides = member\.overrides \|\| \{\}/);
  assert.doesNotMatch(block, /\.\.\.roomOverrides/);
});
