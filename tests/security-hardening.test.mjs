import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("cross-account profile, character, asset and storage access is not granted directly to Admin clients", () => {
  const sql = read("supabase/migrations/002_vio_studio_v2_security_hardening.sql");
  for (const policy of [
    "vio_profiles_update_self",
    "vio_characters_write_self",
    "vio_assets_write_self",
    "vio_storage_read_self",
    "vio_storage_delete_self",
  ]) assert.match(sql, new RegExp("create policy " + policy + "\\b", "i"));
  assert.doesNotMatch(sql, /using\s*\([^)]*vio_is_admin\(\)/i);
  assert.match(sql, /Admin cross-account reads are served by the Edge Function/i);
});

test("private Realtime reads and writes require an active, unexpired room", () => {
  const sql = read("supabase/migrations/002_vio_studio_v2_security_hardening.sql");
  const readPolicy = sql.match(/create policy vio_room_realtime_read[\s\S]*?\);/i)?.[0] || "";
  const writePolicy = sql.match(/create policy vio_room_realtime_write[\s\S]*?\);/i)?.[0] || "";
  for (const policy of [readPolicy, writePolicy]) {
    assert.match(policy, /r\.status='active'/i);
    assert.match(policy, /r\.expires_at > now\(\)/i);
  }
  assert.match(readPolicy, /vio_overlay_devices/i);
});

test("Admin bootstrap is serialized and restricted to a single Admin row", () => {
  const sql = read("supabase/migrations/002_vio_studio_v2_security_hardening.sql");
  assert.match(sql, /create unique index if not exists vio_single_admin_uq[\s\S]*?where role = 'admin'/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('vio_bootstrap_admin'\)\)/i);
});

test("OBS overlay API rejects expired rooms before registering overlay devices", () => {
  const edge = read("supabase/functions/vio-api/index.ts");
  const handler = edge.match(/if \(action === "overlay_connect"\)[\s\S]*?return json\(\{ ok: true, room:/)?.[0] || "";
  assert.match(handler, /expires_at/);
  assert.match(handler, /getTime\(\) <= Date\.now\(\)/);
  assert.ok(handler.indexOf("expires_at") < handler.indexOf('from("vio_overlay_devices")'));
});


test("character accessories have owner-scoped metadata and cloud lifecycle actions", () => {
  const sql = read("supabase/migrations/003_vio_character_accessories.sql");
  const edge = read("supabase/functions/vio-api/index.ts");
  for (const column of ["storage_path", "mime_type", "size_bytes", "x", "y", "w", "h", "mirror", "follow_avatar", "effects_enabled"]) {
    assert.match(sql, new RegExp("\\b" + column + "\\b"));
  }
  assert.match(sql, /create policy vio_accessories_read_self/i);
  assert.match(sql, /create policy vio_accessories_write_self/i);
  for (const action of ["record_accessory", "update_accessory", "delete_accessory", "my_assets"]) {
    assert.ok(edge.includes('action === "' + action + '"'), "missing accessory action " + action);
  }
  assert.match(edge, /vio_character_accessories/);
});

test("accessories are included in collaboration and OBS snapshots and rendered by the shared avatar renderer", () => {
  const edge = read("supabase/functions/vio-api/index.ts");
  const app = read("src/app.js");
  const overlay = read("src/overlay.js");
  const renderer = read("src/avatar-renderer.js");
  assert.ok(edge.includes("vio_character_accessories(id,name,storage_path,bucket_id,x,y,w,h,mirror,follow_avatar,effects_enabled,sort_order)"));
  assert.ok(edge.includes("accessories: accessories.filter(Boolean)"));
  assert.ok(app.includes("avatarRenderer.setAccessories(characterAccessories)"));
  assert.ok(overlay.includes("renderer.setAccessories(accessories)"));
  assert.ok(renderer.includes("item.follow !== false"));
});

test("character library actions exist and expression uploads are bound to an owned character", () => {
  const edge = read("supabase/functions/vio-api/index.ts");
  for (const action of ["character_library", "create_character_draft", "save_character", "set_active_character", "delete_character"]) {
    assert.ok(edge.includes('action === "' + action + '"'), "missing character action " + action);
  }
  const record = edge.match(/if \(action === "record_asset"\)[\s\S]*?if \(action === "record_accessory"\)/)?.[0] || "";
  assert.match(record, /body\.character_id/);
  assert.match(record, /eq\("id", characterId\)\.eq\("user_id", user\.id\)/);
  assert.match(record, /expectedPath/);
  assert.doesNotMatch(record, /eq\("name", "Default"\)/);
});

test("my_assets only returns the selected character assets and includes its id", () => {
  const edge = read("supabase/functions/vio-api/index.ts");
  const handler = edge.match(/if \(action === "my_assets"\)[\s\S]*?if \(action === "get_my_active_room"\)/)?.[0] || "";
  assert.match(handler, /character_id: characterId/);
  assert.match(handler, /eq\("character_id", characterId/);
  assert.match(handler, /active_character_id/);
});

test("accessory upload is scoped to the selected owned character, not a Default name", () => {
  const edge = read("supabase/functions/vio-api/index.ts");
  const handler = edge.match(/if \(action === "record_accessory"\)[\s\S]*?if \(action === "update_accessory"\)/)?.[0] || "";
  assert.match(handler, /body\.character_id/);
  assert.match(handler, /expectedPrefix/);
  assert.match(handler, /pathParts.length !== 4/);
  assert.match(handler, /eq\("id", characterId\)\.eq\("user_id", user\.id\)/);
  assert.doesNotMatch(handler, /characters\/default|eq\("name", "Default"\)/);
});


test("saved profile audio device is loaded before microphone capture starts", () => {
  const app = read("src/app.js");
  const login = app.match(/currentUser = identity\.user;[\s\S]*?footerSession/)?.[0] || "";
  assert.ok(login.indexOf("await loadCurrentProfile()") >= 0);
  assert.ok(login.indexOf("await startMicrophone({ silent: true })") > login.indexOf("await loadCurrentProfile()"));
});

test("room controls reset from profile defaults before applying room-scoped overrides", () => {
  const app = read("src/app.js");
  const loader = app.match(/async function loadRoomMembers\(\)[\s\S]*?function renderRoomParticipants/)?.[0] || "";
  assert.match(loader, /profileRoomDefaults/);
  assert.match(loader, /roomOverrides = \{ \.\.\.profileRoomDefaults, \.\.\.\(ownMember\?\.overrides \|\| \{\}\) \}/);
  assert.match(loader, /renderRoomControls\(\)/);
  assert.match(loader, /currentDeviceId !== nextDeviceId/);
});

test("new Solo OBS rooms publish the current microphone state after Realtime subscription", () => {
  const app = read("src/app.js");
  const generator = app.match(/async function generateOverlayLink[\s\S]*?async function /)?.[0] || "";
  assert.match(generator, /if \(!micEnabled\) await startMicrophone\(\)/);
  assert.match(generator, /await subscribeRoom\(room\.id\);[\s\S]*?await loadRoomMembers\(\);[\s\S]*?await broadcastPlayerState\(currentMicState\)/);
});

test("collaboration and OBS snapshots pass profile preferences and active-character assets to the shared renderer", () => {
  assert.match(app, /entry\.renderer\.setPreferences\(profile\)/);
  assert.match(overlay, /renderer\.setPreferences\(profile\)/);
  const overlay = read("src/overlay.js");
  for (const action of ["room_members", "overlay_connect"]) {
    const start = edge.indexOf('if (action === "' + action + '")');
    const next = edge.indexOf('if (action === "', start + 10);
    const handler = start >= 0 ? edge.slice(start, next > start ? next : undefined) : "";
    assert.match(handler, /active_character_id/);
    assert.match(handler, /preferences/);
    assert.match(handler, /vio_character_assets/);
  }
  assert.match(app, /entry\.renderer\.setPreferences\(preferences\)/);
  assert.match(overlay, /renderer\.setPreferences\(preferences\)/);
});


test("legacy global Visual Effect setting enables configured effect objects without per-effect enabled flags", async () => {
  const { normalizeEffects } = await import("../src/avatar-renderer.js");
  const legacy = normalizeEffects({
    enabled: true,
    bloom: { intensity: 55, color: "#ffd7b8" },
    filter: { intensity: 40 },
    shake: { enabled: false, intensity: 20 }
  });
  assert.equal(legacy.enabled, true);
  assert.equal(legacy.bloom.enabled, true);
  assert.equal(legacy.filter.enabled, true);
  assert.equal(legacy.stroke.enabled, false);
  assert.equal(legacy.shake.enabled, false);
  const disabled = normalizeEffects({ enabled: false, bloom: { intensity: 55 } });
  assert.equal(disabled.bloom.enabled, false);
});

test("GO Collaboration opens Host/Join chooser even while a personal Solo OBS room is restored", () => {
  const app = read("src/app.js");
  const chooser = app.match(/function openRoomChooser\(\)[\s\S]*?function showHostForm/)?.[0] || "";
  assert.match(chooser, /currentRoom && currentRoom\.purpose !== "personal_overlay"/);
  assert.match(chooser, /currentRoom\?\.purpose === "personal_overlay"/);
  assert.match(chooser, /hostRoomChoice/);
  assert.match(chooser, /joinRoomChoice/);
});

test("GO Collaboration shared stage uses a dedicated landscape canvas", () => {
  const app = read("src/app.js");
  const stage = app.slice(app.indexOf("function renderRoomParticipants"), app.indexOf("function drawRoomStageFrame"));
  assert.ok(stage.includes("const width = 1920"));
  assert.ok(stage.includes("const height = 1080"));
  assert.ok(stage.includes('canvas.style.aspectRatio = "16 / 9"'));
  const css = read("assets/app.css");
  assert.ok(css.includes("aspect-ratio:16/9!important"));
  const overlay = read("src/overlay.js");
  assert.ok(overlay.includes('roomPurpose === "collaboration"'));
});

test("room layout sliders update the local member renderer immediately", () => {
  const app = read("src/app.js");
  const controls = app.match(/function renderRoomControls\([^)]*\)[\s\S]*?async function subscribeRoom/)?.[0] || "";
  const stage = app.match(/function renderRoomParticipants\(\)[\s\S]*?function drawRoomStageFrame/)?.[0] || "";
  assert.match(controls, /ownMember\.overrides = \{ \.\.\.\(ownMember\.overrides \|\| \{\}\), \[item\.key\]: value \}/);
  assert.match(stage, /member\.user_id === currentUser\.id[\s\S]*?\.\.\.roomOverrides/);
});

test("OBS overlay automatically requests microphone access for Solo and Collaboration", () => {
  const overlay = read("src/overlay.js");
  const html = read("overlay.html");
  const audio = read("src/audio-engine.js");
  assert.match(overlay, /import \{ AudioEngine \} from "\.\/audio-engine\.js\?v=/);
  assert.match(overlay, /if \(localMicUserId\) void startOverlayMicrophone\(\)/);
  assert.match(audio, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(overlay, /Creator-side state broadcasts/);
  assert.match(html, /<canvas id="stage"/);
  assert.doesNotMatch(html, /overlayMicToggle|overlayMicDevice|overlayControls/);
});

test("generated Solo and Collaboration OBS links never enable editor controls", () => {
  const app = read("src/app.js");
  const html = read("index.html");
  const start = app.indexOf("async function generateOverlayLink(");
  const end = app.indexOf("async function loadAdminOverview", start);
  const generator = app.slice(start, end);
  assert.ok(generator.includes("url.hash = new URLSearchParams"));
  assert.ok(!generator.includes('searchParams.set("controls", "1")'));
  assert.ok(!html.includes('id="copyOverlayControlsLink"'));
  assert.match(html, /id="copyOverlayLink"/);
});

test("overlay API returns room purpose for Solo or Collaboration rendering", () => {
  const edge = read("supabase/functions/vio-api/index.ts");
  const start = edge.indexOf('if (action === "overlay_connect")');
  const end = edge.indexOf("return json({ ok: true, room:", start);
  const handler = edge.slice(start, end > start ? end + 120 : undefined);
  assert.match(handler, /select\("id,status,purpose,overlay_token_hash/);
  assert.match(handler, /purpose: room\.purpose/);
});


test("Solo overlay accepts Creator Talking broadcasts as a fallback even when local CEF mic capture starts", () => {
  const overlay = read("src/overlay.js");
  assert.match(overlay, /localMicActive && payload\.user_id === localMicUserId && payload\.state !== "talking"/);
  assert.match(overlay, /states\.set\(payload\.user_id, payload\.state\)/);
  assert.match(overlay, /startOverlayMicrophone/);
});


test("Solo OBS renders its animation directly into the visible stage canvas", () => {
  const overlay = read("src/overlay.js");
  assert.match(overlay, /drawDirectlyToStage = roomPurpose === "personal_overlay"/);
  assert.match(overlay, /if \(roomPurpose === "personal_overlay" && visible.length === 1/);
  assert.match(overlay, /drawCompositeFrame/);
});

test("renderer keeps a decoded fallback avatar visible when a state asset is unavailable", () => {
  const renderer = read("src/avatar-renderer.js");
  assert.match(renderer, /this.assets\[expression\], this.assets\[this.state\], this.assets\.idle/);
  assert.match(renderer, /candidates\.find\(item => item\.complete && item\.naturalWidth\)/);
});

test("renderer invalidates the last-good frame when the active character asset set changes", () => {
  const renderer = read("src/avatar-renderer.js");
  assert.match(renderer, /nextAssetIdentity = JSON\.stringify/);
  assert.match(renderer, /this\.assetIdentity !== nextAssetIdentity/);
  assert.match(renderer, /this\.lastGoodAvatarImage = null/);
  assert.match(renderer, /this\.ctx\.clearRect\(0, 0, this\.canvas\.width, this\.canvas\.height\)/);
});

test("editor preview stays square at 500x500 while OBS output dimensions remain profile-controlled", () => {
  const app = read("src/app.js");
  const preview = app.match(/function drawPreview\(\)[\s\S]*?function accessoryCanvasPoint/)?.[0] || "";
  assert.match(preview, /const previewWidth = 500/);
  assert.match(preview, /const previewHeight = 500/);
  assert.match(preview, /stageFrame\.style\.aspectRatio = "1 \/ 1"/);
  assert.doesNotMatch(preview, /roomStage\.width = width/);
  assert.match(app, /outputWidth: 500, outputHeight: 500/);
  assert.ok(app.includes("profilePreferences = { scale: 1, avatarScalePercent: 0, outputWidth: 500, outputHeight: 500"));
  assert.match(app, /now - lastRoomStageFrame >= 1000 \/ 30/);
});


test("Solo renderer publishes complete bounded frames without clearing visible OBS output", () => {
  const renderer = read("src/avatar-renderer.js");
  assert.match(renderer, /1280 \/ Math\.max\(outputWidth, outputHeight\)/);
  assert.match(renderer, /this\.renderCanvas/);
  assert.match(renderer, /if \(hasAvatar \|\| hasAccessories \|\| hasOpaqueBackground\)/);
  assert.match(renderer, /output\.drawImage\(this\.renderCanvas/);
  assert.doesNotMatch(renderer, /const rows = 48/);
});

test("Collaboration composition grid is a Creator preview guide and is excluded from OBS output", () => {
  const app = read("src/app.js");
  const overlay = read("src/overlay.js");
  const backend = read("supabase/functions/vio-api/index.ts");
  assert.match(app, /roomCompositionGrid/);
  assert.match(app, /showGrid/);
  assert.match(app, /drawRoomCompositionGrid\(ctx, canvas\.width, canvas\.height\)/);
  assert.match(backend, /"showGrid"/);
  const overlayDraw = overlay.slice(overlay.indexOf("function drawCompositeFrame"), overlay.indexOf("function render()"));
  assert.doesNotMatch(overlayDraw, /drawCompositionGrid|drawCenterGuide/);
  assert.match(overlayDraw, /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\)/);
  assert.match(overlayDraw, /ctx\.drawImage\(entry\.canvas, 0, 0, canvas\.width, canvas\.height\)/);
});


test("OBS overlay keeps working when Realtime channel subscription fails", () => {
  const overlay = read("src/overlay.js");
  assert.match(overlay, /Realtime unavailable; using polling fallback/);
  assert.match(overlay, /realtimeConnected \? 2500 : 1000/);
  assert.doesNotMatch(overlay, /reject\(new Error\(\`Realtime channel error/);
});

test("OBS overlay has no visible buttons or control panels in either mode", () => {
  const html = read("overlay.html");
  const overlay = read("src/overlay.js");
  assert.doesNotMatch(html, /<button|<select|overlay-controls|overlayControlsShow/);
  assert.match(html, /\.debug \.status\{display:block\}/);
  assert.match(overlay, /if \(localMicUserId\) void startOverlayMicrophone\(\)/);
});

test("Collaboration keeps a 1920x1080 shared stage; composition guides stay in Creator preview only", () => {
  const app = read("src/app.js");
  const overlay = read("src/overlay.js");
  const html = read("overlay.html");
  const backend = read("supabase/functions/vio-api/index.ts");
  assert.match(app, /const width = 1920;[\s\S]*const height = 1080;/);
  assert.match(app, /ctx\.drawImage\(entry\.canvas, 0, 0, canvas\.width, canvas\.height\)/);
  assert.match(overlay, /ctx\.drawImage\(entry\.canvas, 0, 0, canvas\.width, canvas\.height\)/);
  assert.match(app, /drawRoomCenterGuide\(ctx, canvas\.width, canvas\.height\)/);
  assert.match(app, /drawRoomCompositionGrid\(ctx, canvas\.width, canvas\.height\)/);
  const overlayDraw = overlay.slice(overlay.indexOf("function drawCompositeFrame"), overlay.indexOf("function render()"));
  assert.doesNotMatch(overlayDraw, /drawCenterGuide|drawCompositionGrid/);
  assert.match(app, /Math\.max\(18, Math\.round\(width \/ 100\)\)/);
  assert.match(backend, /"showCenterGuide"/);
  assert.match(html, /height:auto!important/);
});


test("Solo and Collaboration OBS outputs are menu-free and Collaboration size follows preview", () => {
  const app = read("src/app.js");
  const html = read("index.html");
  const overlayHtml = read("overlay.html");
  const overlay = read("src/overlay.js");
  const generatorStart = app.indexOf("async function generateOverlayLink(");
  const generatorEnd = app.indexOf("async function loadAdminOverview", generatorStart);
  const generator = app.slice(generatorStart, generatorEnd);
  assert.ok(!generator.includes('searchParams.set("controls", "1")'));
  assert.match(generator, /const stage = \$\("roomStage"\)/);
  assert.match(generator, /url\.searchParams\.set\("width", String\(width\)\)/);
  assert.match(generator, /url\.searchParams\.set\("height", String\(height\)\)/);
  assert.doesNotMatch(overlayHtml, /<button|<select|overlayControls/);
  assert.match(overlay, /const requestedWidth = Number\(params\.get\("width"\)\) \|\| 1920/);
  assert.match(overlay, /const requestedHeight = Number\(params\.get\("height"\)\) \|\| 1080/);
  assert.doesNotMatch(html, /copyOverlayControlsLink/);
});

test("AudioEngine reduces mic detection latency without removing noise gating", () => {
  const audio = read("src/audio-engine.js");
  assert.match(audio, /this\.analyser\.fftSize = 1024/);
  assert.match(audio, /hangoverMs: 140/);
  assert.match(audio, /this\.level = this\.level \* 0\.45 \+ rms \* 0\.55/);
  assert.match(audio, /this\.noiseFloor \* this\.options\.noiseMultiplier/);
  assert.match(audio, /now - this\.lastEmit\) > 25/);
});



test("navigation keeps its original sidebar DOM placement without reparenting controls", () => {
  const app = read("src/app.js");
  const html = read("index.html");
  const css = read("assets/app.css");
  const navigation = app.slice(app.indexOf("function renderNavigation()"), app.indexOf("function selectMenu("));
  assert.match(navigation, /const nav = \$\("navigation"\);[\s\S]*if \(nav\)/);
  assert.match(navigation, /if \(logoutButton\) logoutButton\.hidden = !currentUser/);
  assert.doesNotMatch(navigation, /append\(logoutButton\)/);
  assert.match(html, /<div class="sidebar-bottom">[\s\S]*?<button id="logoutButton"/);
  assert.doesNotMatch(app, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.doesNotMatch(css, /Mobile navigation refresh/);
});

test("editor view is revealed before optional navigation and settings rendering", () => {
  const app = read("src/app.js");
  const selectStart = app.indexOf("function selectMenu(");
  const selectEnd = app.indexOf("function settingField(", selectStart);
  const select = app.slice(selectStart, selectEnd);
  const showEditor = select.indexOf('showView("editorView")');
  const renderNavigation = select.indexOf("renderNavigation()", showEditor);
  assert.ok(showEditor >= 0, "selectMenu must reveal the editor view");
  assert.ok(renderNavigation > showEditor, "the editor must be visible before navigation is rendered");

  const loginStart = app.indexOf("async function login(");
  const loginEnd = app.indexOf("async function loadCurrentProfile()", loginStart);
  const login = app.slice(loginStart, loginEnd);
  const selectProfile = login.indexOf('selectMenu("about")');
  const restoreRoom = login.indexOf("await restoreSavedRoom()");
  assert.ok(selectProfile >= 0, "successful login must open the About workspace");
  assert.ok(restoreRoom > selectProfile, "room restoration must happen after the editor is opened");
  assert.doesNotMatch(login, /renderNavigation\\(\\);\\s*selectMenu\\("about"\\)/);
});

test("view switching tolerates missing optional DOM elements", () => {
  const app = read("src/app.js");
  const showViewStart = app.indexOf("function showView(");
  const showViewEnd = app.indexOf("function allowedMenus(", showViewStart);
  const showView = app.slice(showViewStart, showViewEnd);
  assert.match(showView, /const view = \$\(viewId\);[\s\S]*if \(view\) view\.hidden/);
  assert.match(showView, /if \(roomButton\) roomButton\.hidden/);
});


test("Creator Studio mobile dock has the requested five workspace tabs", () => {
  const html = read("index.html"); const app = read("src/app.js"); const css = read("assets/app.css");
  const dock = html.match(/<nav id="mobileBottomNav"[\s\S]*?<\/nav>/)?.[0] || "";
  const targets = [...dock.matchAll(/data-dock-target="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(targets, ["audio", "effects", "avatar", "accessories", "about"]);
  assert.doesNotMatch(dock, /data-dock-target="settings"/);
  assert.doesNotMatch(app, /case "settings":[\s\S]*?scrollIntoView/);
  for (const id of ["audio", "effects", "avatar", "accessories", "about"]) assert.ok(app.includes("case \"" + id + "\"") || app.includes("menuId === \"" + id + "\""));
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.app-shell\.in-room \.mobile-bottom-nav\s*\{\s*display: none !important/);
});

test("mobile navigation does not replace avatar, audio, OBS, backend, or Collaboration engines", () => {
  const app = read("src/app.js");
  const renderer = read("src/avatar-renderer.js");
  const audio = read("src/audio-engine.js");
  const overlay = read("src/overlay.js");
  const html = read("index.html");
  assert.match(app, /import \{ AudioEngine \} from "\.\/audio-engine\.js\?v=/);
  assert.match(app, /import \{ AvatarRenderer, resolveRoomAvatarPreferences \} from "\.\/avatar-renderer\.js\?v=/);
  assert.match(app, /function drawPreview\(\)/);
  assert.match(app, /async function generateOverlayLink\(/);
  assert.match(app, /async function enterRoom\(/);
  assert.match(renderer, /export class AvatarRenderer/);
  assert.match(audio, /export class AudioEngine/);
  assert.match(overlay, /AvatarRenderer/);
  assert.match(html, /id="avatarCanvas"/);
  assert.match(html, /id="roomStage"/);
  assert.match(html, /src="\.\/src\/app\.js\?v=/);
});


test("Collaboration OBS output stays transparent and never renders editor-only guide layers", () => {
  const overlay = read("src/overlay.js");
  const draw = overlay.slice(overlay.indexOf("function drawCompositeFrame"), overlay.indexOf("function render()"));
  assert.match(draw, /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\)/);
  assert.match(draw, /ctx\.drawImage\(entry\.canvas, 0, 0, canvas\.width, canvas\.height\)/);
  assert.doesNotMatch(draw, /fillStyle = "#000000"|drawCenterGuide|drawCompositionGrid/);
});

test("AvatarRenderer preserves the last decoded PNG while a new expression is loading", () => {
  const renderer = read("src/avatar-renderer.js");
  assert.match(renderer, /this\.lastGoodAvatarImage = null/);
  assert.match(renderer, /const decodedAvatar = candidates\.find\(item => item\.complete && item\.naturalWidth\)/);
  assert.match(renderer, /const image = decodedAvatar \|\| lastGood \|\| candidates\.find\(item => !item\.complete\)/);
  assert.match(renderer, /this\.lastGoodAvatarImage = decodedAvatar/);
  assert.match(renderer, /else if \(!pendingAvatar && !this\.lastGoodAvatarImage\)/);
});


test("Collaboration Creator and OBS use one canonical room-layout transform", () => {
  const app = read("src/app.js");
  const overlay = read("src/overlay.js");
  const renderer = read("src/avatar-renderer.js");
  assert.match(app, /resolveRoomAvatarPreferences\(profile, overrides, playerWidth, playerHeight, index, visible\.length\)/);
  assert.match(overlay, /resolveRoomAvatarPreferences\(profile, overrides, width, canvas\.height, memberIndex, members\.length\)/);
  assert.match(renderer, /export function resolveRoomAvatarPreferences\(/);
  assert.match(renderer, /setRoomLayout\(layout = \{\}\)/);
  assert.doesNotMatch(app, /offsetX: Math\.max\(-100/);
  assert.doesNotMatch(overlay, /preferences\.offsetX = Math\.max\(-100/);
});


test("AudioEngine retries a suspended context on the first invisible user interaction", () => {
  const audio = read("src/audio-engine.js");
  assert.match(audio, /for \(const eventName of \["pointerdown", "touchend", "keydown"\]\)/);
  assert.match(audio, /document\?\.addEventListener\?\.\(eventName, this\.resumeHandler, \{ capture: true, passive: true \}\)/);
  assert.match(audio, /this\.resumeHandler = \(\) => \{ this\.resume\(\)/);
});


test("room override writes merge partial updates with previously saved personal controls", () => {
  const edge = read("supabase/functions/vio-api/index.ts");
  const handler = edge.slice(edge.indexOf('if (action === "set_room_override")'), edge.indexOf('if (action === "record_asset")'));
  assert.match(handler, /select\("overrides"\)[\s\S]*?maybeSingle\(\)/);
  assert.match(handler, /const mergedOverrides = \{ \.\.\.stored, \.\.\.clean \}/);
  assert.match(handler, /overrides: mergedOverrides/);
});

test("dummy composition guide layers above participant backgrounds in Creator preview and stays out of OBS", () => {
  const app = read("src/app.js");
  const overlay = read("src/overlay.js");
  const appDraw = app.slice(app.indexOf("function drawRoomStageFrame"), app.indexOf("async function leaveRoom"));
  const overlayDraw = overlay.slice(overlay.indexOf("function drawCompositeFrame"), overlay.indexOf("function render()"));
  assert.ok(appDraw.indexOf("ctx.drawImage(entry.canvas") < appDraw.indexOf("drawRoomCenterGuide(ctx"));
  assert.ok(appDraw.indexOf("drawRoomCenterGuide(ctx") < appDraw.indexOf("drawRoomCompositionGrid(ctx"));
  assert.doesNotMatch(overlayDraw, /drawCenterGuide|drawCompositionGrid/);
  assert.match(overlayDraw, /ctx\.drawImage\(entry\.canvas, 0, 0, canvas\.width, canvas\.height\)/);
});

test("OBS Solo renderer applies complete member preferences before its direct render loop starts", () => {
  const overlay = read("src/overlay.js");
  const renderer = overlay.slice(overlay.indexOf("function ensurePlayerRenderer"), overlay.indexOf("function updateLocalMicState"));
  assert.ok(renderer.indexOf("renderer.setPreferences(profile)") < renderer.indexOf("renderer.start()"));
  assert.ok(renderer.indexOf("renderer.setPreferences(profile)") < renderer.indexOf("renderer.setAssets(assets)"));
  assert.ok(renderer.includes("drawDirectlyToStage"));
});
