import test from "node:test";
import assert from "node:assert/strict";
import { AvatarRenderer, compareRoomMembers, mergeRoomMemberOverrides, resolveRoomAvatarLayouts, resolveRoomAvatarPreferences, resolveRoomBackgroundPreferences, sortRoomMembers } from "../src/avatar-renderer.js";

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
  assert.match(block, /const layouts = roomPurpose === "collaboration" \? resolveRoomAvatarLayouts\(orderedMembers, canvas\.width, canvas\.height\) : \[\]/);
  assert.match(block, /ensurePlayerRenderer\(member, canvas\.width, index, layouts\[index\] \|\| null\)/);
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

test("Creator and OBS compose one host background beneath transparent participant sprites", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../src/overlay.js", import.meta.url), "utf8");
  const appFrame = app.slice(app.indexOf("function drawRoomStageFrame("), app.indexOf("async function leaveRoom(", app.indexOf("function drawRoomStageFrame(")));
  const overlayFrame = overlay.slice(overlay.indexOf("function drawCompositeFrame("), overlay.indexOf("function render()", overlay.indexOf("function drawCompositeFrame(")));
  assert.match(app, /resolveRoomAvatarLayouts\(roomMembers/);
  assert.match(overlay, /resolveRoomAvatarLayouts\(orderedMembers/);
  assert.match(app, /resolveRoomBackgroundPreferences\(roomMembers\)/);
  assert.match(overlay, /resolveRoomBackgroundPreferences\(members\)/);
  assert.ok(appFrame.indexOf("roomBackgroundRenderer?.drawBackgroundTo") < appFrame.indexOf("ctx.drawImage(entry.canvas"));
  assert.ok(overlayFrame.indexOf("roomBackgroundRenderer?.drawBackgroundTo") < overlayFrame.indexOf("ctx.drawImage(entry.canvas"));
  assert.equal((appFrame.match(/roomBackgroundRenderer\?\.drawBackgroundTo/g) || []).length, 1);
  assert.equal((overlayFrame.match(/roomBackgroundRenderer\?\.drawBackgroundTo/g) || []).length, 1);
});

test("Creator and OBS apply the same DB-backed member overrides", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../src/overlay.js", import.meta.url), "utf8");
  const { resolveRoomAvatarLayouts } = await import("../src/avatar-renderer.js");
  const members = [
    { user_id: "host", is_host: true, joined_at: "2026-11-21T04:00:00Z", overrides: { x: 0 } },
    { user_id: "joiner", joined_at: "2026-11-21T04:01:00Z", overrides: { x: 24 } }
  ];
  const layouts = resolveRoomAvatarLayouts(members, 1920, 1080);
  assert.deepEqual(layouts.map(item => item.preferences.offsetX), [0, 184.32]);
  assert.match(app, /resolveRoomAvatarLayouts\(roomMembers/);
  assert.match(overlay, /resolveRoomAvatarLayouts\(orderedMembers/);
  assert.doesNotMatch(app.slice(app.indexOf("function renderRoomParticipants()"), app.indexOf("function drawRoomCompositionGrid(")), /\.\.\.roomOverrides/);
});

test("presence loss idles a collaboration member without deleting membership", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../src/overlay.js", import.meta.url), "utf8");
  assert.match(app, /remotePlayerStates\.set\(member\.user_id, "idle"\)/);
  assert.match(app, /loadRoomMembers\(\);/);
  assert.match(overlay, /if \(!presentIds\.has\(member\.user_id\)\) member\.state = "idle"/);
  assert.doesNotMatch(app, /presenceState\(\)[\s\S]{0,240}roomMembers\.filter/);
});


test("canonical collaboration layouts produce stable 1-4 member X positions from database membership", () => {
  const host = { user_id: "host", is_host: true, joined_at: "2026-11-21T04:00:00Z" };
  const participants = [1, 2, 3].map(n => ({ user_id: `member-${n}`, joined_at: `2026-11-21T04:0${n}:00Z`, state: "idle", online: true }));
  const expected = { 1: [0], 2: [-130.56, 130.56], 3: [-261.12, 0, 261.12], 4: [-391.68, -130.56, 130.56, 391.68] };
  for (let count = 1; count <= 4; count++) {
    const members = [host, ...participants].slice(0, count);
    const layouts = resolveRoomAvatarLayouts(members, 1920, 1080);
    assert.deepEqual(layouts.map(item => item.preferences.offsetX), expected[count]);
    assert.deepEqual(layouts.map(item => item.member.user_id), sortRoomMembers(members).map(item => item.user_id));
  }
});

test("presence loss and reconnect never change resolved X for any database room member", () => {
  const members = [
    { user_id: "host", is_host: true, joined_at: "2026-11-21T04:00:00Z", state: "talking", online: true },
    { user_id: "b", joined_at: "2026-11-21T04:01:00Z", state: "idle", online: true },
    { user_id: "c", joined_at: "2026-11-21T04:02:00Z", state: "talking", online: true },
    { user_id: "d", joined_at: "2026-11-21T04:03:00Z", state: "idle", online: true }
  ];
  const project = list => resolveRoomAvatarLayouts(list, 1920, 1080).map(({ member, preferences }) => [member.user_id, preferences.offsetX]);
  const before = project(members);
  assert.deepEqual(project(members.map(member => ({ ...member, online: false, state: "idle" }))), before);
  assert.deepEqual(project(members.map(member => ({ ...member, online: true, state: "talking" }))), before);
});

test("room override merge can only mutate the authenticated owner's member row", () => {
  const members = [{ user_id: "alice", overrides: { x: 2, scale: 1 } }, { user_id: "bob", overrides: { x: 20, scale: 0.8 } }];
  assert.equal(mergeRoomMemberOverrides(members, "alice", "bob", { x: 99 }), members);
  const updated = mergeRoomMemberOverrides(members, "alice", "alice", { x: 12 });
  assert.deepEqual(updated.map(member => member.overrides), [{ x: 12, scale: 1 }, { x: 20, scale: 0.8 }]);
});

test("collaboration background is resolved only from the host; participant sprite profiles stay transparent", () => {
  const members = [
    { user_id: "joiner", joined_at: "2026-11-21T04:01:00Z", preferences: { background: { mode: "image", src: "joiner-private-url" } } },
    { user_id: "host", is_host: true, joined_at: "2026-11-21T04:00:00Z", preferences: { background: { mode: "video", src: "host-signed-private-url", storage_path: "host/background.mp4", bucket_id: "vio-backgrounds" } } }
  ];
  assert.deepEqual(resolveRoomBackgroundPreferences(members), { background: members[1].preferences.background });
  const layouts = resolveRoomAvatarLayouts(members, 1920, 1080);
  assert.ok(layouts.every(item => item.spriteProfile.background.mode === "transparent"));
  assert.ok(layouts.every(item => !JSON.stringify(item.spriteProfile).includes("joiner-private-url")));
});
