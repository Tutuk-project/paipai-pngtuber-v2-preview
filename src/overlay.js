import { AvatarRenderer, resolveRoomAvatarPreferences } from "./avatar-renderer.js?v=20261121-collab-position-fix-1";
import { AudioEngine } from "./audio-engine.js?v=20261121-ui-reorg-1";

let config;
let supabase;
let channel;
let roomId;
let overlayToken;
let roomPurpose = "collaboration";
let localMicEngine = null;
let localMicUserId = null;
let localMicActive = false;
let members = [];
let refreshTimer = 0;
let assetRefreshTimer = 0;
let compositeRaf = 0;
let lastCompositeFrame = 0;
const states = new Map();
const stateSequences = new Map();
const layoutSequences = new Map();
const playerRenderers = new Map();
const canvas = document.getElementById("stage");
const ctx = canvas?.getContext("2d");
const statusEl = document.getElementById("status");
const debugMode = new URLSearchParams(location.search).get("debug") === "1";
const params = new URLSearchParams(location.search);
let centerGuideEnabled = params.get("centerGuide") === "1";
let gridEnabled = params.get("grid") === "1";
let realtimeConnected = false;
let pollEndpointSupported = null;
const BUILD_ID = "OBS-HUD-2026-11-21-r1";
let debugHud = null;
let debugHudTimer = 0;
let realtimeStatus = "NOT_CONNECTED";
let realtimeLastError = "";
let lastBroadcastReceived = null;
let lastPollResult = null;
let authSessionStatus = "not checked";
let authRefreshStatus = "not observed";
let storageStatus = { localStorage: "unknown", sessionStorage: "unknown" };
let rafTicks = 0;
let rafFps = 0;
let rafLastSampleAt = Date.now();
let rafLastTickAt = 0;
const drawnTransforms = new Map();

function debugTime(value) {
  return value ? new Date(value).toLocaleTimeString() : "—";
}
function initializeDebugHud() {
  if (!debugMode || debugHud) return;
  try { localStorage.setItem("__vio_debug_probe", "1"); localStorage.removeItem("__vio_debug_probe"); storageStatus.localStorage = "available"; }
  catch (error) { storageStatus.localStorage = "blocked: " + error.message; }
  try { sessionStorage.setItem("__vio_debug_probe", "1"); sessionStorage.removeItem("__vio_debug_probe"); storageStatus.sessionStorage = "available"; }
  catch (error) { storageStatus.sessionStorage = "blocked: " + error.message; }
  debugHud = document.createElement("pre");
  debugHud.id = "overlayDebugHud";
  debugHud.style.cssText = "position:fixed;z-index:9999;left:8px;top:8px;right:8px;max-height:48vh;overflow:auto;margin:0;padding:10px 12px;border:1px solid #6bd6b4;border-radius:10px;background:rgba(5,12,18,.94);color:#d9fff2;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none";
  document.body.append(debugHud);
  debugHudTimer = window.setInterval(renderDebugHud, 500);
  renderDebugHud();
}
function renderDebugHud() {
  if (!debugHud) return;
  const membersView = members.map(member => {
    const id = member.user_id;
    const drawn = drawnTransforms.get(id);
    const seq = layoutSequences.get(id) ?? 0;
    return {
      member_id: id,
      snapshot_override: member.overrides || {},
      updated_at: member.overrides_updated_at || member.updated_at || null,
      drawn: drawn || "not drawn yet",
      last_applied_seq: seq
    };
  });
  const pollMembers = lastPollResult?.members || [];
  const renderList = members.slice(0, 4).map((member, index) => {
    const entry = playerRenderers.get(member.user_id);
    const assets = Object.entries(member.assets || {}).map(([expression, src]) => {
      const image = entry?.renderer?.images?.get(src);
      const timing = performance.getEntriesByName(src).slice(-1)[0];
      let signedExp = null;
      try {
        const token = new URL(src).searchParams.get("token");
        if (token) signedExp = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/") + "==")).exp || null;
      } catch {}
      return {
        expression, image_state: image?.__vioLoadState || (image === null ? "error" : image ? "loading/unknown" : "not-requested"),
        naturalWidth: image?.naturalWidth || 0, naturalHeight: image?.naturalHeight || 0,
        complete: image?.complete ?? false, error_at: image?.__vioErrorAt || null,
        responseStatus: timing?.responseStatus || "not exposed",
        signed_exp: signedExp ? new Date(signedExp * 1000).toISOString() : null,
        src_key: String(src).split("?")[0].slice(-100)
      };
    });
    return { slot: index, member_id: member.user_id, username: member.username, renderer_exists: !!entry,
      asset_count: Object.keys(member.assets || {}).length, assets };
  });
  const rendererIds = [...playerRenderers.keys()];
  debugHud.textContent = [
    "VIO OBS DEBUG HUD · " + BUILD_ID + " · module=" + (new URL(import.meta.url).searchParams.get("v") || "unversioned"),
    "Realtime: " + realtimeStatus + (realtimeLastError ? " · " + realtimeLastError : ""),
    "Member list (" + members.length + "): " + JSON.stringify(members.map(m => ({ id: m.user_id, username: m.username, state: m.state }))),
    "Render list (max 4): " + JSON.stringify(renderList),
    "Renderer map IDs: " + JSON.stringify(rendererIds),
    "Last broadcast source event: " + (lastBroadcastReceived ? JSON.stringify(lastBroadcastReceived) : "none"),
    "Last poll source event: " + (lastPollResult ? JSON.stringify({ at: debugTime(lastPollResult.at), http_status: lastPollResult.httpStatus, error: lastPollResult.error, members: pollMembers }) : "none"),
    "Member effective layout: " + JSON.stringify(membersView),
    "Asset refresh cadence: 15m · signed URL requested TTL: 60m",
    "rAF: " + rafFps + " ticks/s · alive=" + (Date.now() - rafLastTickAt < 2500),
    "Storage: " + JSON.stringify(storageStatus),
    "Auth: session=" + authSessionStatus + " · refresh=" + authRefreshStatus
  ].join("\n");
}

function setStatus(message, error = false, forceVisible = true) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", error);
  statusEl.classList.toggle("is-visible", forceVisible || debugMode);
}

function clearStatus() {
  if (!statusEl) return;
  statusEl.classList.remove("is-error", "is-visible");
  statusEl.textContent = "";
}

async function api(action, payload = {}) {
  const startedAt = Date.now();
  const { data, error } = await supabase.functions.invoke(config.edgeFunctionName || "vio-api", { body: { action, ...payload } });
  if (action === "overlay_poll" || action === "overlay_connect") {
    const response = error?.context instanceof Response ? error.context : null;
    lastPollResult = {
      at: Date.now(),
      httpStatus: response?.status || (error ? null : 200),
      error: error ? (error.message || String(error)) : (data?.ok ? null : data?.error || "Unknown overlay API error"),
      elapsed_ms: Date.now() - startedAt,
      members: (data?.members || []).map(item => ({
        member_id: item.user_id,
        x: item.overrides?.x, y: item.overrides?.y, scale: item.overrides?.scale,
        overrides: item.overrides || {},
        updated_at: item.overrides_updated_at || item.updated_at || null
      }))
    };
    renderDebugHud();
  }
  if (error) throw new Error(error.message || `Supabase request failed: ${action}`);
  if (!data?.ok) throw new Error(data?.error || `Overlay API failed: ${action}`);
  return data;
}

function ensurePlayerRenderer(member, stageWidth = canvas.width, memberIndex = 0) {
  let entry = playerRenderers.get(member.user_id);
  const drawDirectlyToStage = roomPurpose === "personal_overlay" && member.user_id === localMicUserId;
  if (entry && entry.direct !== drawDirectlyToStage) {
    entry.renderer.stop();
    playerRenderers.delete(member.user_id);
    entry = null;
  }
  if (!entry) {
    const playerCanvas = drawDirectlyToStage ? canvas : document.createElement("canvas");
    playerCanvas.width = Math.max(1, Math.round(stageWidth));
    playerCanvas.height = canvas.height;
    const renderer = new AvatarRenderer(playerCanvas);
    entry = { canvas: playerCanvas, renderer, direct: drawDirectlyToStage, profileKey: "", assetsKey: "", accessoriesKey: "" };
    playerRenderers.set(member.user_id, entry);
  }
  const { renderer, canvas: playerCanvas } = entry;
  const width = Math.max(1, Math.round(stageWidth));
  if (playerCanvas.width !== width || playerCanvas.height !== canvas.height) {
    playerCanvas.width = width;
    playerCanvas.height = canvas.height;
  }
  const profile = member.preferences || {};
  const overrides = member.overrides || {};
  const preferences = resolveRoomAvatarPreferences(profile, overrides, width, canvas.height, memberIndex, members.length);
  const profileKey = JSON.stringify(profile);
  const assets = member.assets || {};
  const assetsKey = JSON.stringify(assets);
  const accessories = member.accessories || [];
  const accessoriesKey = JSON.stringify(accessories);
  if (entry.profileKey !== profileKey) {
    renderer.setPreferences(profile);
    entry.profileKey = profileKey;
  }
  if (entry.assetsKey !== assetsKey) {
    renderer.setAssets(assets);
    entry.assetsKey = assetsKey;
  }
  if (entry.accessoriesKey !== accessoriesKey) {
    renderer.setAccessories(accessories);
    entry.accessoriesKey = accessoriesKey;
  }
  renderer.setRoomLayout(preferences);
  drawnTransforms.set(member.user_id, {
    x: Number(overrides.x ?? 0), y: Number(overrides.y ?? 0), scale: preferences.scale,
    offsetX: preferences.offsetX, offsetY: preferences.offsetY
  });
  renderer.setState(states.get(member.user_id) || member.state || "idle");
  if (!renderer.running) renderer.start();
  return entry;
}


function updateLocalMicState(state) {
  if (!localMicUserId || !["idle", "talking"].includes(state)) return;
  states.set(localMicUserId, state);
  const member = members.find(item => item.user_id === localMicUserId);
  if (member) member.state = state;
  render();
}

async function startOverlayMicrophone() {
  if (!localMicUserId || localMicEngine) return;
  const host = members.find(member => member.user_id === localMicUserId);
  // Request microphone capture as soon as the OBS source resolves its host identity.
  localMicEngine = new AudioEngine({
    deviceId: host?.preferences?.deviceId || "",
    sensitivity: Number(host?.preferences?.sensitivity ?? 1),
    boostDb: Number(host?.preferences?.boostDb ?? 6)
  });
  localMicEngine.addEventListener("state", event => updateLocalMicState(event.detail.state));
  localMicEngine.addEventListener("status", event => {
    const { status, error } = event.detail;
    if (debugMode) setStatus(
      status === "active" ? "Solo mic active · clean overlay" : `Solo mic ${status}${error?.message ? `: ${error.message}` : ""}`,
      status === "error",
      true
    );
  });
  try {
    await localMicEngine.start();
    localMicActive = true;
    updateLocalMicState(localMicEngine.state || "idle");
    if (debugMode) setStatus("Overlay microphone active", false, true);
  } catch (error) {
    localMicActive = false;
    localMicEngine = null;
    console.warn("OBS overlay microphone capture unavailable:", error);
    setStatus("Mic tidak tersedia: " + error.message + ". Izinkan mikrofon untuk halaman overlay di pengaturan browser/OBS, lalu muat ulang source.", true, true);
  }
}

function drawCompositionGrid(context, width, height) {
  context.save();
  context.strokeStyle = "rgba(210,245,235,.98)";
  context.lineWidth = Math.max(18, Math.round(width / 100));
  context.setLineDash([Math.max(18, width / 90), Math.max(14, width / 120)]);
  for (let index = 1; index <= 2; index++) {
    const x = width * index / 3;
    const y = height * index / 3;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  context.setLineDash([]);
  context.strokeStyle = "rgba(210,245,235,.95)";
  context.lineWidth = Math.max(12, Math.round(width / 150));
  context.strokeRect(width * .02, height * .02, width * .96, height * .96);
  context.restore();
}

function drawCenterGuide(context, width, height) {
  const cx = width / 2, cy = height / 2, unit = Math.min(width, height) / 1080;
  const headR = 72 * unit, bodyW = 170 * unit, bodyH = 220 * unit;
  context.save(); context.translate(cx, cy);
  context.globalAlpha = 0.78;
  context.strokeStyle = "rgba(255,220,170,.98)";
  context.fillStyle = "rgba(255,220,170,.28)";
  context.lineWidth = Math.max(7, 7 * unit);
  context.setLineDash([14 * unit, 10 * unit]);
  context.beginPath(); context.moveTo(-width * .16, 0); context.lineTo(width * .16, 0);
  context.moveTo(0, -height * .30); context.lineTo(0, height * .30); context.stroke(); context.setLineDash([]);
  context.beginPath(); context.arc(0, -bodyH * .72, headR, 0, Math.PI * 2); context.fill(); context.stroke();
  context.beginPath(); context.arc(0, -bodyH * .80, headR * 1.08, Math.PI * 1.08, Math.PI * 1.92); context.stroke();
  context.beginPath(); context.arc(-headR * .34, -bodyH * .73, 5 * unit, 0, Math.PI * 2);
  context.arc(headR * .34, -bodyH * .73, 5 * unit, 0, Math.PI * 2); context.stroke();
  context.beginPath(); context.roundRect(-bodyW / 2, -bodyH * .42, bodyW, bodyH * .92, 42 * unit); context.fill(); context.stroke();
  context.beginPath(); context.moveTo(-bodyW / 2, -bodyH * .25); context.lineTo(-bodyW * .92, bodyH * .02);
  context.lineTo(-bodyW * .72, bodyH * .36); context.moveTo(bodyW / 2, -bodyH * .25);
  context.lineTo(bodyW * .92, bodyH * .02); context.lineTo(bodyW * .72, bodyH * .36); context.stroke();
  context.font = "800 " + (24 * unit) + "px system-ui"; context.textAlign = "center";
  context.fillStyle = "rgba(255,235,200,.98)"; context.fillText("AVATAR CENTER", 0, bodyH * .72);
  context.restore();
}

function drawCompositeFrame(now) {
  if (!canvas || !ctx) return;
  rafTicks++;
  rafLastTickAt = Date.now();
  if (Date.now() - rafLastSampleAt >= 1000) {
    rafFps = rafTicks;
    rafTicks = 0;
    rafLastSampleAt = Date.now();
    renderDebugHud();
  }
  if (now - lastCompositeFrame >= 1000 / 30) {
    lastCompositeFrame = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const visible = members.slice(0, 4);
    if (visible.length) {
      // OBS output mirrors participant avatar transforms but never includes
      // editor-only composition guides. Grid and center dummy remain preview aids.
      visible.forEach(member => {
        const entry = playerRenderers.get(member.user_id);
        if (entry && !entry.direct) ctx.drawImage(entry.canvas, 0, 0, canvas.width, canvas.height);
      });
    }
  }
  compositeRaf = requestAnimationFrame(drawCompositeFrame);
}

function render() {
  if (!canvas || !ctx) return;
  const visible = members.slice(0, 4);
  if (!visible.length) {
    if (compositeRaf) cancelAnimationFrame(compositeRaf);
    compositeRaf = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  visible.forEach((member, index) => {
    const entry = ensurePlayerRenderer(member, canvas.width, index);
    entry.renderer.setState(states.get(member.user_id) || member.state || "idle");
  });
  if (roomPurpose === "personal_overlay" && visible.length === 1 && visible[0].user_id === localMicUserId) {
    if (compositeRaf) cancelAnimationFrame(compositeRaf);
    compositeRaf = 0;
    return;
  }
  if (!compositeRaf) compositeRaf = requestAnimationFrame(drawCompositeFrame);
}


async function pollOverlayState() {
  let result;
  if (pollEndpointSupported !== false) {
    try {
      result = await api("overlay_poll", { room_id: roomId, overlay_token: overlayToken });
      pollEndpointSupported = true;
    } catch (error) {
      if (!String(error?.message || error).includes("Unknown action: overlay_poll")) throw error;
      pollEndpointSupported = false;
    }
  }
  // Older deployed Edge Functions do not yet expose overlay_poll. Reuse their
  // existing signed snapshot endpoint but only apply state/layout fields here,
  // never reassign signed image URLs on every fallback tick.
  if (pollEndpointSupported === false) result = await api("overlay_connect", { room_id: roomId, overlay_token: overlayToken });
  const incoming = result.members || [];
  const currentIds = members.map(member => member.user_id).sort().join("|");
  const nextIds = incoming.map(member => member.user_id).sort().join("|");
  if (currentIds !== nextIds) { await refreshMembers(); return; }
  let layoutChanged = false;
  for (const item of incoming) {
    const member = members.find(entry => entry.user_id === item.user_id);
    if (!member) continue;
    if (!(localMicActive && item.user_id === localMicUserId) && ["idle", "talking"].includes(item.state)) {
      states.set(item.user_id, item.state);
      member.state = item.state;
    }
    const nextOverrides = item.overrides || {};
    member.overrides_updated_at = item.overrides_updated_at || item.updated_at || member.overrides_updated_at || null;
    member._debugLastLayoutSource = { source: "poll", at: Date.now(), version: item.version || item.updated_at || item.overrides_updated_at || null };
    if (JSON.stringify(member.overrides || {}) !== JSON.stringify(nextOverrides)) {
      member.overrides = nextOverrides;
      member.overrides_updated_at = item.updated_at || null;
      layoutChanged = true;
    }
  }
  if (layoutChanged || incoming.length) render();
}

async function refreshMembers() {
  const result = await api("overlay_connect", { room_id: roomId, overlay_token: overlayToken });
  roomPurpose = result.room?.purpose || roomPurpose;
  members = result.members || [];
  const hostMember = members.find(member => member.is_host) || members[0];
  if (hostMember) localMicUserId = hostMember.user_id;
  const output = hostMember?.preferences || {};
  const isCollaborationRoom = roomPurpose === "collaboration";
  const requestedWidth = Number(params.get("width")) || 1920;
  const requestedHeight = Number(params.get("height")) || 1080;
  const validCollaborationSize = requestedWidth >= 320 && requestedWidth <= 3840
    && requestedHeight >= 320 && requestedHeight <= 3840
    && requestedWidth * requestedHeight <= 8294400;
  const width = isCollaborationRoom
    ? (validCollaborationSize ? Math.round(requestedWidth) : 1920)
    : Math.max(320, Math.min(3840, Math.round(Number(output.outputWidth) || 500)));
  const height = isCollaborationRoom
    ? (validCollaborationSize ? Math.round(requestedHeight) : 1080)
    : Math.max(320, Math.min(3840, Math.round(Number(output.outputHeight) || 500)));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  canvas.style.aspectRatio = `${width} / ${height}`;

  const activeIds = new Set(members.map(member => member.user_id));
  for (const [userId, entry] of playerRenderers) {
    if (!activeIds.has(userId)) {
      entry.renderer.stop();
      playerRenderers.delete(userId);
      states.delete(userId);
    }
  }
  members.forEach(member => {
    const state = localMicActive && member.user_id === localMicUserId
      ? (states.get(member.user_id) || "idle")
      : (member.state || "idle");
    states.set(member.user_id, state);
    ensurePlayerRenderer(member, canvas.width, members.indexOf(member));
  });
  render();

  if (!members.length) {
    setStatus("Overlay terhubung ke server, tetapi daftar peserta room kosong. Pastikan room masih aktif dan akun pembuat link masih menjadi anggota.", true);
    return;
  }
  // Keep URL flags as explicit link-level overrides only. Room toggles are
  // evaluated from the latest member.overrides on every composite frame so an
  // ON → OFF change immediately restores transparency.
  gridEnabled = params.get("grid") === "1";
  centerGuideEnabled = params.get("centerGuide") === "1";
  
  const hasAvatarAssets = members.some(member => Object.values(member.assets || {}).some(Boolean));
  if (!hasAvatarAssets) {
    setStatus("Overlay terhubung, tetapi PNG avatar belum ditemukan. Unggah setidaknya ekspresi Idle di Vio Studio > Character.", true);
    return;
  }
  clearStatus();
  if (debugMode) setStatus(`Connected · ${members.length} participant(s) · Vio Studio v2.0`, false);
}

async function boot() {
  try {
    if (!canvas || !ctx) throw new Error("Canvas OBS tidak ditemukan di halaman overlay.");
    initializeDebugHud();
    setStatus("Membaca kredensial overlay…");
    const configModule = await import("./config.js");
    config = configModule.VIO_CONFIG;
    if (!config?.supabaseUrl || !config?.supabasePublishableKey || config.supabasePublishableKey.includes("REPLACE_ME")) {
      throw new Error("Konfigurasi Supabase belum tersedia di build ini.");
    }
    const pageUrl = new URL(location.href);
    const linkParams = new URLSearchParams(pageUrl.hash.replace(/^#/, ""));
    roomId = linkParams.get("room") || pageUrl.searchParams.get("room");
    overlayToken = linkParams.get("token") || pageUrl.searchParams.get("token");
    if (!roomId || !overlayToken) throw new Error("URL overlay tidak lengkap. Buat ulang link dari tombol Generate OBS Link.");

    setStatus("Menghubungkan ke layanan overlay…");
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    let { data: { session } } = await supabase.auth.getSession();
    authSessionStatus = session ? "existing session" : "no session";
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error(`Login perangkat overlay gagal: ${error.message}`);
      session = data.session;
      authSessionStatus = session ? "anonymous session created" : "anonymous session missing";
    }
    if (!session) throw new Error("Sesi perangkat overlay tidak berhasil dibuat.");
    authSessionStatus += session.expires_at ? " · expires " + debugTime(session.expires_at * 1000) : "";
    supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "TOKEN_REFRESHED") authRefreshStatus = "success · " + debugTime(Date.now());
      else if (event === "SIGNED_OUT") authRefreshStatus = "signed out";
      else if (event === "SIGNED_IN" && !authRefreshStatus.includes("success")) authRefreshStatus = "signed in";
      if (nextSession?.expires_at) authSessionStatus = "session · expires " + debugTime(nextSession.expires_at * 1000);
      renderDebugHud();
    });
    setStatus("Memuat peserta dan aset avatar…");
    await refreshMembers();
    // Every Solo and Collaboration overlay requests microphone access as soon
    // as the host identity is known. The browser/CEF permission prompt is the
    // only valid way to authorize capture; Creator broadcasts remain fallback.
    if (localMicUserId) void startOverlayMicrophone();
    channel = supabase.channel(`room:${roomId}`, { config: { private: true } })
      .on("broadcast", { event: "player-state" }, ({ payload }) => {
        if (!payload?.user_id || !["idle", "talking"].includes(payload.state)) return;
        const seq = Number(payload.seq) || 0;
        if (seq && seq <= (stateSequences.get(payload.user_id) || 0)) return;
        if (seq) stateSequences.set(payload.user_id, seq);
        // Prefer the local OBS mic for "idle", but never suppress a Creator-side
        // "talking" signal: CEF may report a live stream while failing to deliver
        // real microphone samples or may be bound to a different input device.
        if (localMicActive && payload.user_id === localMicUserId && payload.state !== "talking") return;
        states.set(payload.user_id, payload.state);
        render();
      })
      .on("broadcast", { event: "player-layout" }, ({ payload }) => {
        if (!payload?.user_id || !payload.overrides) return;
        const seq = Number(payload.seq) || 0;
        const previousSeq = layoutSequences.get(payload.user_id) || 0;
        const member = members.find(item => item.user_id === payload.user_id);
        const stale = !!(seq && seq <= previousSeq);
        lastBroadcastReceived = {
          at: Date.now(), member_id: payload.user_id, seq,
          x: payload.overrides.x, y: payload.overrides.y, scale: payload.overrides.scale,
          updated_at: payload.updated_at || null, version: payload.version || payload.updated_at || null,
          applied: !!member && !stale,
          reason: !member ? "member_id_not_found" : stale ? "stale_seq" : "applied"
        };
        if (stale) { renderDebugHud(); return; }
        if (seq) layoutSequences.set(payload.user_id, seq);
        if (member) {
          member._debugLastLayoutSource = { source: "broadcast", at: Date.now(), version: payload.version || payload.updated_at || null };
          member.overrides = { ...(member.overrides || {}), ...payload.overrides };
          render();
        }
        renderDebugHud();
      })
      .on("broadcast", { event: "member-assets-updated" }, () => {
        refreshMembers().catch(error => setStatus(`Gagal memperbarui aset: ${error.message}`, true));
      })
      .on("presence", { event: "sync" }, () => {
        refreshMembers().catch(error => setStatus(`Sinkronisasi peserta gagal: ${error.message}`, true));
      });
    try {
      await supabase.realtime.setAuth();
      await new Promise(resolve => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        const timeout = setTimeout(finish, 6500);
        channel.subscribe((status, error) => {
          realtimeStatus = status;
          if (error) realtimeLastError = error.message || String(error);
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") realtimeLastError = "status=" + status;
          else if (status === "SUBSCRIBED") realtimeLastError = "";
          renderDebugHud();
          if (status === "SUBSCRIBED") { realtimeConnected = true; clearTimeout(timeout); finish(); }
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { realtimeConnected = false; clearTimeout(timeout); finish(); }
        });
      });
    } catch (error) { realtimeConnected = false; console.warn("Realtime unavailable; using polling fallback:", error); }
    if (members.length && members.some(member => Object.values(member.assets || {}).some(Boolean))) {
      if (debugMode) setStatus(realtimeConnected ? "Realtime connected" : "Realtime unavailable · polling fallback active", !realtimeConnected);
      else clearStatus();
    }
    // Microphone permission was requested automatically after the room host
    // was resolved above. If capture is denied, Creator-side state broadcasts
    // remain active and the browser permission must be granted in site settings.
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      pollOverlayState().catch(error => { if (debugMode) setStatus("Polling overlay gagal: " + error.message, true); });
    }, realtimeConnected ? 2500 : 1000);
    if (assetRefreshTimer) clearInterval(assetRefreshTimer);
    assetRefreshTimer = setInterval(() => {
      refreshMembers().catch(error => { if (debugMode) setStatus("Refresh aset overlay gagal: " + error.message, true); });
    }, 15 * 60 * 1000);
  } catch (error) {
    console.error("Vio Studio OBS overlay error:", error);
    let message = error instanceof Error ? error.message : String(error);
    const context = error && typeof error === "object" ? error.context : null;
    if (context instanceof Response) {
      try {
        const body = await context.clone().json();
        if (body?.error) message = String(body.error);
        if (body?.code) message = `[${body.code}] ${message}`;
        if (body?.details) message += ` · ${body.details}`;
      } catch { /* Keep the SDK message if the response is not JSON. */ }
    }
    authSessionStatus = "boot error: " + message;
    renderDebugHud();
    setStatus(`OBS OVERLAY ERROR: ${message}`, true);
  }
}

boot();

window.addEventListener("pagehide", () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (assetRefreshTimer) clearInterval(assetRefreshTimer);
  if (debugHudTimer) clearInterval(debugHudTimer);
  if (compositeRaf) cancelAnimationFrame(compositeRaf);
  compositeRaf = 0;
  for (const entry of playerRenderers.values()) entry.renderer.stop();
  void localMicEngine?.stop().catch(() => {});
  localMicEngine = null;
  localMicActive = false;
});
