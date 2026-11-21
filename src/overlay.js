import { AvatarRenderer } from "./avatar-renderer.js";
import { AudioEngine } from "./audio-engine.js";

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
let controlsVisible = params.get("controls") === "1";
let gridEnabled = params.get("grid") === "1";
let gridUserOverride = false;
let centerGuideUserOverride = false;
let realtimeConnected = false;
let pollEndpointSupported = null;

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
  const { data, error } = await supabase.functions.invoke(config.edgeFunctionName || "vio-api", { body: { action, ...payload } });
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
    // Solo has one participant: draw straight into the visible OBS canvas.
    // This avoids rendering an animated offscreen canvas that is only copied
    // when the microphone changes state.
    const playerCanvas = drawDirectlyToStage ? canvas : document.createElement("canvas");
    playerCanvas.width = Math.max(1, Math.round(stageWidth));
    playerCanvas.height = canvas.height;
    const renderer = new AvatarRenderer(playerCanvas);
    renderer.start();
    entry = { canvas: playerCanvas, renderer, direct: drawDirectlyToStage };
    playerRenderers.set(member.user_id, entry);
  }
  const { renderer, canvas: playerCanvas } = entry;
  const width = Math.max(1, Math.round(stageWidth));
  if (playerCanvas.width !== width || playerCanvas.height !== canvas.height) {
    playerCanvas.width = width;
    playerCanvas.height = canvas.height;
  }
  renderer.setAssets(member.assets || {});
  renderer.setAccessories(member.accessories || []);
  const overrides = member.overrides || {};
  const layoutX = Object.hasOwn(overrides, "x") ? Number(overrides.x) || 0 : (memberIndex - (members.length - 1) / 2) * 34;
  const preferences = {
    ...(member.preferences || {}),
    scale: overrides.scale ?? member.preferences?.scale ?? 1,
    avatarScalePercent: overrides.scale != null ? undefined : member.preferences?.avatarScalePercent
  };
  preferences.offsetX = Math.max(-100, Math.min(100, layoutX)) * width * 0.004;
  preferences.offsetY = Math.max(-100, Math.min(100, Number(overrides.y) || 0)) * canvas.height * 0.0035;
  renderer.setPreferences(preferences);
  const background = preferences.background || {};
  renderer.setBackgroundImage(background.mode === "image" ? background.src : null);
  renderer.setBackgroundVideo(background.mode === "video" ? background.src : null);
  renderer.setState(states.get(member.user_id) || member.state || "idle");
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
  // Capture from a direct button gesture so Android WebViews can grant mic permission.
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
    updateOverlayControlState();
    await refreshOverlayMicDevices();
    if (debugMode) setStatus("Overlay microphone active", false, true);
  } catch (error) {
    localMicActive = false;
    localMicEngine = null;
    updateOverlayControlState();
    console.warn("OBS overlay microphone capture unavailable:", error);
    setStatus("Mic tidak tersedia: " + error.message + ". Tekan Aktifkan Mic dan izinkan akses mikrofon.", true, true);
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

function updateOverlayControlState() {
  const micButton = document.getElementById("overlayMicToggle");
  const gridButton = document.getElementById("overlayGridToggle");
  const centerButton = document.getElementById("overlayCenterToggle");
  const panel = document.getElementById("overlayControls");
  const showButton = document.getElementById("overlayControlsShow");
  if (micButton) { micButton.textContent = localMicActive ? "Mic ON · Matikan" : "Aktifkan Mic"; micButton.setAttribute("aria-pressed", String(localMicActive)); }
  if (gridButton) gridButton.setAttribute("aria-pressed", String(gridEnabled));
  if (centerButton) centerButton.setAttribute("aria-pressed", String(centerGuideEnabled));
  panel?.classList.toggle("is-visible", controlsVisible);
  showButton?.classList.toggle("is-visible", !controlsVisible && params.get("controls") === "1");
}

async function refreshOverlayMicDevices() {
  const select = document.getElementById("overlayMicDevice");
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const selected = localMicEngine?.options?.deviceId || select.value;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === "audioinput");
    select.replaceChildren(new Option("System default mic", ""));
    devices.forEach((device, index) => select.add(new Option(device.label || ("Microphone " + (index + 1)), device.deviceId)));
    select.value = devices.some(device => device.deviceId === selected) ? selected : "";
  } catch (error) { console.warn("Microphone list unavailable:", error); }
}

function bindOverlayControls() {
  document.getElementById("overlayMicToggle")?.addEventListener("click", async () => {
    const button = document.getElementById("overlayMicToggle"); button.disabled = true;
    try {
      if (localMicActive && localMicEngine) {
        await localMicEngine.stop(); localMicEngine = null; localMicActive = false; updateLocalMicState("idle");
      } else await startOverlayMicrophone();
    } finally { button.disabled = false; updateOverlayControlState(); }
  });
  document.getElementById("overlayMicDevice")?.addEventListener("change", async event => {
    if (!localMicActive) return;
    const deviceId = event.target.value;
    await localMicEngine?.stop(); localMicEngine = null; localMicActive = false;
    const host = members.find(member => member.user_id === localMicUserId);
    if (host) host.preferences = { ...(host.preferences || {}), deviceId };
    await startOverlayMicrophone();
  });
  document.getElementById("overlayGridToggle")?.addEventListener("click", () => { gridUserOverride = true; gridEnabled = !gridEnabled; updateOverlayControlState(); render(); });
  document.getElementById("overlayCenterToggle")?.addEventListener("click", () => { centerGuideUserOverride = true; centerGuideEnabled = !centerGuideEnabled; updateOverlayControlState(); render(); });
  document.getElementById("overlayControlsHide")?.addEventListener("click", () => { controlsVisible = false; updateOverlayControlState(); });
  document.getElementById("overlayControlsShow")?.addEventListener("click", () => { controlsVisible = true; updateOverlayControlState(); });
  updateOverlayControlState();
}

function drawCompositeFrame(now) {
  if (!canvas || !ctx) return;
  if (now - lastCompositeFrame >= 1000 / 30) {
    lastCompositeFrame = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const visible = members.slice(0, 4);
    if (visible.length) {
      const isCollaboration = roomPurpose === "collaboration";
      const showCenter = isCollaboration && (
        centerGuideEnabled || visible.some(member => member.overrides?.showCenterGuide === true)
      );
      const showGrid = isCollaboration && (
        gridEnabled || visible.some(member => member.overrides?.showGrid === true)
      );

      // Collaboration output is opaque black only while a composition guide
      // is enabled. With both guide layers disabled, the canvas stays alpha.
      if (showCenter || showGrid) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (showCenter) drawCenterGuide(ctx, canvas.width, canvas.height);
      visible.forEach(member => {
        const entry = playerRenderers.get(member.user_id);
        if (entry && !entry.direct) ctx.drawImage(entry.canvas, 0, 0, canvas.width, canvas.height);
      });
      if (showGrid) drawCompositionGrid(ctx, canvas.width, canvas.height);
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
  const slotWidth = canvas.width / visible.length;
  visible.forEach(member => {
    const entry = playerRenderers.get(member.user_id) || ensurePlayerRenderer(member, canvas.width, visible.indexOf(member));
    entry.renderer.setState(states.get(member.user_id) || member.state || "idle");
  });
  if (roomPurpose === "personal_overlay" && visible.length === 1 && visible[0].user_id === localMicUserId) {
    if (compositeRaf) cancelAnimationFrame(compositeRaf);
    compositeRaf = 0;
    return; // AvatarRenderer owns the visible canvas and its animation loop.
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
    if (JSON.stringify(member.overrides || {}) !== JSON.stringify(nextOverrides)) {
      member.overrides = nextOverrides;
      ensurePlayerRenderer(member, canvas.width, members.indexOf(member));
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
  if (!gridUserOverride) gridEnabled = members.some(member => member.overrides?.showGrid === true) || params.get("grid") === "1";
  if (!centerGuideUserOverride) centerGuideEnabled = members.some(member => member.overrides?.showCenterGuide === true) || params.get("centerGuide") === "1";
  updateOverlayControlState();
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
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error(`Login perangkat overlay gagal: ${error.message}`);
      session = data.session;
    }
    if (!session) throw new Error("Sesi perangkat overlay tidak berhasil dibuat.");

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
        if (seq && seq <= (layoutSequences.get(payload.user_id) || 0)) return;
        if (seq) layoutSequences.set(payload.user_id, seq);
        const member = members.find(item => item.user_id === payload.user_id);
        if (member) {
          member.overrides = { ...(member.overrides || {}), ...payload.overrides };
          ensurePlayerRenderer(member, canvas.width, members.indexOf(member));
        }
        render();
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
        channel.subscribe(status => {
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
    }, realtimeConnected ? 10000 : 1000);
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
    setStatus(`OBS OVERLAY ERROR: ${message}`, true);
  }
}

boot();

window.addEventListener("pagehide", () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (assetRefreshTimer) clearInterval(assetRefreshTimer);
  if (compositeRaf) cancelAnimationFrame(compositeRaf);
  compositeRaf = 0;
  for (const entry of playerRenderers.values()) entry.renderer.stop();
  void localMicEngine?.stop().catch(() => {});
  localMicEngine = null;
  localMicActive = false;
});
