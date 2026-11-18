/* VoixOff Studio — montage vidéo + voix off TTS, 100% navigateur */
"use strict";

/* ---------- État global ---------- */

const state = {
  media: [],        // {id, name, type:'image'|'video', url, el, duration, thumbURL}
  audios: [],       // {id, name, buffer}
  scenes: [],       // {id, mediaId, text, durationMs, voiceURI, rate, pitch, keywords, hue, imgEl, attribution}
  selectedSceneId: null,
  playing: false,
  playStartTs: 0,
  currentSceneId: null,
  exportAbort: false,
  music: null,      // {name, buffer}
  musicVolume: 0.35,
  musicLoop: true,
  transition: "fade-black",
};

let uid = 0;
const nextId = (p) => `${p}_${++uid}`;

const $ = (sel) => document.querySelector(sel);
const canvas = $("#stage");
const ctx = canvas.getContext("2d");

const W = canvas.width, H = canvas.height;
const MIN_SCENE_MS = 1500;
const FADE_MS = 350;

/* ---------- Utilitaires ---------- */

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function estSpeechMs(text, rate) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ms = (words / 150) * 60000 / (rate || 1);
  return Math.max(MIN_SCENE_MS, Math.round(ms + 800));
}

function totalDurationMs() {
  return state.scenes.reduce((sum, s) => sum + s.durationMs, 0);
}

function getSceneById(id) {
  return state.scenes.find((s) => s.id === id) || null;
}

function selectedScene() {
  return getSceneById(state.selectedSceneId);
}

function loadEl(url, type) {
  return new Promise((resolve, reject) => {
    if (type === "image") {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.src = url;
      v.onloadeddata = () => resolve(v);
      v.onerror = reject;
    }
  });
}

/* ---------- Médias ---------- */

$("#fileMedia").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    const type = file.type.startsWith("video") ? "video" : "image";
    const url = URL.createObjectURL(file);
    try {
      const el = await loadEl(url, type);
      state.media.push({
        id: nextId("med"),
        name: file.name,
        type,
        url,
        el,
        duration: type === "video" ? el.duration * 1000 : 0,
      });
    } catch {
      toast(`Impossible de charger « ${file.name} »`, true);
    }
  }
  e.target.value = "";
  renderMediaList();
});

function renderMediaList() {
  const list = $("#mediaList");
  list.innerHTML = "";
  state.media.forEach((m) => {
    const div = document.createElement("div");
    div.className = "media-item";
    div.title = m.name;
    if (m.type === "image") {
      const img = new Image();
      img.src = m.url;
      div.appendChild(img);
    } else {
      const v = document.createElement("video");
      v.src = m.url;
      v.muted = true;
      div.appendChild(v);
    }
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = m.name;
    div.appendChild(name);
    div.onclick = () => {
      const sc = selectedScene();
      if (sc) { sc.mediaId = m.id; renderTimeline(); }
      else toast("Sélectionnez d'abord une scène pour lui assigner ce média.");
    };
    list.appendChild(div);
  });
}

/* ---------- Script -> scènes ---------- */

$("#scriptInput").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    generateScenes();
  }
});

$("#btnGenerate").addEventListener("click", generateScenes);

function generateScenes() {
  const raw = $("#scriptInput").value.trim();
  if (!raw) { toast("Écrivez d'abord votre script.", true); return; }

  const blocks = raw
    .split(/\n\s*\n|\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (!blocks.length) return;

  const voice = $("#voiceSelect").value || null;
  const rate = parseFloat($("#rateRange").value);
  const pitch = parseFloat($("#pitchRange").value);
  const visualMode = $("#visualMode").value;

  state.scenes = blocks.map((text, i) => {
    const sc = {
      id: nextId("scn"),
      mediaId: null,
      text,
      durationMs: estSpeechMs(text, rate),
      voiceURI: voice,
      rate,
      pitch,
    };
    if (visualMode === "manual" && state.media.length) {
      sc.mediaId = state.media[i % state.media.length].id;
    } else if (visualMode.startsWith("auto")) {
      sc.keywords = extractKeywords(text);
      sc.hue = hueFor(sc.keywords.join(" ") || text);
      if (visualMode === "auto-images") fetchAutoImage(sc);
    }
    return sc;
  });
  state.selectedSceneId = state.scenes[0].id;
  renderMediaList();
  renderTimeline();
  renderSceneProps();
  previewCurrentSceneFrame();
  toast(`${state.scenes.length} scène(s) générée(s) depuis le script.`);
}

/* ---------- Illustrations automatiques ---------- */

const FR_STOPWORDS = new Set(
  ("le la les un une des du de d au aux et ou mais donc or ni car que qui quoi dont où " +
   "je tu il elle on nous vous ils elles me te se lui leur y en ce cet cette ces mon ton son " +
   "ma ta sa mes tes ses notre vos leurs pour par avec sans sous sur dans devant derrière " +
   "entre vers chez afin ainsi alors aussi est sont être avoir ai as ont avons avez avait " +
   "avaient sera seront été suis es sommes êtes plus moins très bien peu tout tous toute " +
   "toutes quelque certains certaine cela ça ceci celui celle ceux déjà encore ne pas oui " +
   "non si comme quand parce voici voilà aujourd'hui toujours parfois mais alors puis").split(/\s+/)
);

function extractKeywords(text, n = 2) {
  const words = text
    .toLowerCase()
    .replace(/^[dlqu]'/gm, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FR_STOPWORDS.has(w));
  const VERB_END = /(?:ent|ant|ait|aient|er|ez|ons|ions|iez|issons|é|és|ée|ées|ir|rai|rons|drons)$/;
  const uniq = [...new Set(words)];
  uniq.sort((a, b) => {
    const sa = a.length - (VERB_END.test(a) ? 4 : 0);
    const sb = b.length - (VERB_END.test(b) ? 4 : 0);
    return sb - sa;
  });
  return uniq.slice(0, n);
}

function hueFor(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

const CORS_TIMEOUT_MS = 9000;

function loadCORSImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => reject(new Error("timeout")), CORS_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      if (img.naturalWidth > 50) resolve(img);
      else reject(new Error("image trop petite"));
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("chargement impossible"));
    };
    img.src = url;
  });
}

function searchURL(kind, query, limit) {
  const q = encodeURIComponent(query);
  if (kind === "openverse") {
    return `https://api.openverse.org/v1/images/?q=${q}&page_size=${limit}&license_type=all-cc`;
  }
  return `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrsearch=${encodeURIComponent("filetype:bitmap " + query)}` +
    `&gsrlimit=${limit}&prop=imageinfo&iiprop=url&iiurlwidth=1280`;
}

async function openverseResults(query, limit) {
  const r = await fetch(searchURL("openverse", query, limit), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("openverse " + r.status);
  const data = await r.json();
  return (data.results || [])
    .filter((it) => it.thumbnail || it.url)
    .map((it) => ({
      url: it.thumbnail || it.url,
      attribution: it.creator ? `${it.creator} — ${it.license || "CC"}` : "",
    }));
}

async function commonsResults(query, limit) {
  const r = await fetch(searchURL("commons", query, limit));
  if (!r.ok) throw new Error("commons " + r.status);
  const data = await r.json();
  const pages = Object.values(data?.query?.pages || {});
  return pages
    .map((p) => p.imageinfo?.[0]?.thumburl)
    .filter(Boolean)
    .map((url) => ({ url, attribution: "Wikimedia Commons" }));
}

async function fetchAutoImage(sc) {
  const query = sc.keywords.join(" ") || sc.text.slice(0, 40);
  const sources = [openverseResults, commonsResults];
  for (const source of sources) {
    try {
      const candidates = await source(query, 5);
      for (const cand of candidates) {
        try {
          const img = await loadCORSImage(cand.url);
          sc.imgEl = img;
          sc.attribution = cand.attribution;
          renderTimeline();
          if (selectedScene() === sc && !state.playing) previewCurrentSceneFrame();
          return;
        } catch {}
      }
    } catch {}
  }
}

function drawGradientScene(c, sc, localMs) {
  const progress = Math.min(1, Math.max(0, localMs / Math.max(1, sc.durationMs)));
  const hue = sc.hue || 220;
  const drift = 30 * Math.sin(progress * Math.PI);
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue + drift}, 60%, 24%)`);
  g.addColorStop(1, `hsl(${hue + 60 + drift}, 55%, 11%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const rg = c.createRadialGradient(
    W * (0.3 + 0.4 * progress), H * 0.35, 20,
    W * (0.3 + 0.4 * progress), H * 0.35, W * 0.45
  );
  rg.addColorStop(0, `hsla(${hue + 80}, 80%, 65%, 0.35)`);
  rg.addColorStop(1, "hsla(0, 0%, 0%, 0)");
  c.fillStyle = rg;
  c.fillRect(0, 0, W, H);
}

/* ---------- Timeline ---------- */

function renderTimeline() {
  const tl = $("#timeline");
  tl.innerHTML = "";

  if (!state.scenes.length) {
    tl.innerHTML = `<div class="empty-timeline">Aucune scène.<br>Importez des médias puis générez les scènes depuis votre script (étapes 1 et 2).</div>`;
    return;
  }

  state.scenes.forEach((sc, i) => {
    const media = state.media.find((m) => m.id === sc.mediaId);
    const card = document.createElement("div");
    card.className = "scene-card" + (sc.id === state.selectedSceneId ? " active" : "");

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (media) {
      thumb.style.backgroundImage = `url("${media.url}")`;
    } else if (sc.hue !== undefined) {
      thumb.style.background = `linear-gradient(135deg, hsl(${sc.hue}, 60%, 32%), hsl(${(sc.hue + 60) % 360}, 55%, 14%))`;
      if (sc.imgEl) thumb.style.backgroundImage = `url("${sc.imgEl.src}")`;
    } else {
      thumb.textContent = "🎞";
    }
    card.appendChild(thumb);

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = sc.text;
    card.appendChild(text);

    const meta = document.createElement("div");
    meta.className = "meta";
    const dur = document.createElement("span");
    dur.textContent = `${i + 1} · ${fmtTime(sc.durationMs)}`;
    meta.appendChild(dur);

    const tools = document.createElement("div");
    tools.className = "tools";
    const upBtn = mkBtn("↑", () => moveScene(i, -1));
    const downBtn = mkBtn("↓", () => moveScene(i, 1));
    const dupBtn = mkBtn("⧉", () => duplicateScene(i));
    const delBtn = mkBtn("✕", () => deleteScene(sc.id));
    delBtn.classList.add("danger");
    tools.append(upBtn, downBtn, dupBtn, delBtn);
    meta.appendChild(tools);
    card.appendChild(meta);

    card.onclick = (e) => {
      if (e.target.closest("button")) return;
      stopPlayback();
      state.selectedSceneId = sc.id;
      renderTimeline();
      renderSceneProps();
      previewCurrentSceneFrame();
    };
    tl.appendChild(card);
  });
}

function mkBtn(label, onClick, title = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = title;
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
}

function moveScene(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.scenes.length) return;
  [state.scenes[i], state.scenes[j]] = [state.scenes[j], state.scenes[i]];
  renderTimeline();
}

function duplicateScene(i) {
  const src = state.scenes[i];
  state.scenes.splice(i + 1, 0, { ...src, id: nextId("scn") });
  renderTimeline();
}

function deleteScene(id) {
  const i = state.scenes.findIndex((s) => s.id === id);
  if (i === -1) return;
  state.scenes.splice(i, 1);
  if (state.selectedSceneId === id) state.selectedSceneId = state.scenes[0]?.id || null;
  renderTimeline();
  renderSceneProps();
}

/* ---------- Propriétés de scène ---------- */

function renderSceneProps() {
  const box = $("#sceneProps");
  box.innerHTML = "";
  const sc = selectedScene();
  if (!sc) {
    box.innerHTML = `<p class="hint">Sélectionnez une scène dans la timeline.</p>`;
    return;
  }

  const textGroup = document.createElement("div");
  textGroup.className = "prop-group";
  const textLabel = document.createElement("label");
  textLabel.textContent = "Texte de la voix off";
  const textarea = document.createElement("textarea");
  textarea.rows = 4;
  textarea.value = sc.text;
  textarea.oninput = () => { sc.text = textarea.value; refreshSceneCardText(); };
  textLabel.appendChild(textarea);
  textGroup.appendChild(textLabel);
  box.appendChild(textGroup);

  const medium = state.media.find((m) => m.id === sc.mediaId);
  const selLabel = document.createElement("label");
  selLabel.textContent = "Média";
  const sel = document.createElement("select");
  const optNone = document.createElement("option");
  optNone.value = "";
  optNone.textContent = "— Écran noir —";
  sel.appendChild(optNone);
  state.media.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name;
    if (m.id === sc.mediaId) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    sc.mediaId = sel.value || null;
    renderTimeline();
    previewCurrentSceneFrame();
  };
  selLabel.appendChild(sel);
  textGroup.appendChild(selLabel);
  box.appendChild(selLabel);
  void medium;

  if (sc.keywords) {
    const autoInfo = document.createElement("p");
    autoInfo.className = "hint";
    autoInfo.textContent = sc.imgEl
      ? `Illustration automatique trouvée pour « ${sc.keywords.join(", ")} »`
      : `Recherche d'illustration pour « ${sc.keywords.join(", ")} »…`;
    box.appendChild(autoInfo);
  }

  const durLabel = document.createElement("label");
  durLabel.textContent = `Durée : ${fmtTime(sc.durationMs)}`;
  const dur = document.createElement("input");
  dur.type = "range";
  dur.min = MIN_SCENE_MS;
  dur.max = 30000;
  dur.step = 250;
  dur.value = sc.durationMs;
  dur.oninput = () => {
    sc.durationMs = parseInt(dur.value, 10);
    durLabel.firstChild.textContent = `Durée : ${fmtTime(sc.durationMs)} `;
  };
  durLabel.appendChild(dur);
  box.appendChild(durLabel);

  const rateLabel = document.createElement("label");
  rateLabel.textContent = `Vitesse voix : ${sc.rate.toFixed(1)}`;
  const rate = document.createElement("input");
  rate.type = "range";
  rate.min = 0.5; rate.max = 2; rate.step = 0.1; rate.value = sc.rate;
  rate.oninput = () => {
    sc.rate = parseFloat(rate.value);
    rateLabel.firstChild.textContent = `Vitesse voix : ${sc.rate.toFixed(1)} `;
  };
  rateLabel.appendChild(rate);
  box.appendChild(rateLabel);

  const pitchLabel = document.createElement("label");
  pitchLabel.textContent = `Tonalité : ${sc.pitch.toFixed(1)}`;
  const pitch = document.createElement("input");
  pitch.type = "range";
  pitch.min = 0; pitch.max = 2; pitch.step = 0.1; pitch.value = sc.pitch;
  pitch.oninput = () => {
    sc.pitch = parseFloat(pitch.value);
    pitchLabel.firstChild.textContent = `Tonalité : ${sc.pitch.toFixed(1)} `;
  };
  pitchLabel.appendChild(pitch);
  box.appendChild(pitchLabel);

  const btnRow = document.createElement("div");
  btnRow.className = "row";
  const listen = document.createElement("button");
  listen.textContent = "🔊 Écouter la voix";
  listen.onclick = () => speakScene(sc);
  const auto = document.createElement("button");
  auto.textContent = "⏱ Durée auto";
  auto.title = "Recalculer la durée à partir du texte";
  auto.onclick = () => {
    sc.durationMs = estSpeechMs(sc.text, sc.rate);
    durLabel.firstChild.textContent = `Durée : ${fmtTime(sc.durationMs)} `;
    dur.value = sc.durationMs;
    renderTimeline();
  };
  btnRow.append(listen, auto);
  box.appendChild(btnRow);
}

function refreshSceneCardText() {
  renderTimeline();
}

/* ---------- Synthèse vocale ---------- */

const synth = window.speechSynthesis;
const voices = [];

function loadVoices() {
  const list = synth.getVoices();
  if (!list.length) return false;
  voices.length = 0;
  voices.push(...list);
  const select = $("#voiceSelect");
  const prev = select.value;
  select.innerHTML = "";
  const sorted = [...voices].sort((a, b) => {
    const fa = a.lang.toLowerCase().startsWith("fr") ? 0 : 1;
    const fb = b.lang.toLowerCase().startsWith("fr") ? 0 : 1;
    return fa - fb || a.name.localeCompare(b.name);
  });
  sorted.forEach((v) => {
    const o = document.createElement("option");
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    select.appendChild(o);
  });
  if (prev && sorted.some((v) => v.voiceURI === prev)) select.value = prev;
  return true;
}

if ("speechSynthesis" in window) {
  if (!loadVoices()) {
    synth.addEventListener("voiceschanged", loadVoices);
    let tries = 0;
    const iv = setInterval(() => {
      if (loadVoices() || ++tries > 20) clearInterval(iv);
    }, 250);
  }
} else {
  toast("La synthèse vocale n'est pas disponible dans ce navigateur.", true);
}

function voiceByURI(uri) {
  return voices.find((v) => v.voiceURI === uri) || voices.find((v) => v.default) || voices[0] || null;
}

function speakScene(sc, onEnd) {
  if (!("speechSynthesis" in window) || !sc.text.trim()) {
    if (onEnd) setTimeout(onEnd, 100);
    return;
  }
  const u = new SpeechSynthesisUtterance(sc.text);
  const v = voiceByURI(sc.voiceURI);
  if (v) u.voice = v;
  u.lang = v?.lang || "fr-FR";
  u.rate = sc.rate;
  u.pitch = sc.pitch;
  if (onEnd) u.onend = () => onEnd();
  synth.speak(u);
}

$("#btnPreviewVoice").addEventListener("click", () => {
  const sc = selectedScene();
  if (!sc) { toast("Sélectionnez une scène.", true); return; }
  speakScene(sc);
});

/* ---------- Rendu canvas ---------- */

function drawCover(c, el) {
  const ew = el.videoWidth || el.naturalWidth;
  const eh = el.videoHeight || el.naturalHeight;
  if (!ew || !eh) return;
  const scale = Math.max(W / ew, H / eh);
  const dw = ew * scale, dh = eh * scale;
  c.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawTextOverlay(c, text) {
  if (!text.trim()) return;
  const fontSize = 34;
  c.font = `600 ${fontSize}px system-ui, sans-serif`;
  c.textAlign = "center";

  const maxW = W - 160;
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (c.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(-4);

  const pad = 14;
  const boxH = shown.length * (fontSize + 8) + pad * 2;
  const y0 = H - boxH - 60;

  c.fillStyle = "rgba(0,0,0,0.55)";
  const boxW = Math.min(
    W - 80,
    Math.max(...shown.map((l) => c.measureText(l).width)) + pad * 2
  );
  roundRect(c, (W - boxW) / 2, y0, boxW, boxH, 12);
  c.fill();

  c.fillStyle = "#fff";
  shown.forEach((l, i) => {
    const y = y0 + pad + fontSize + i * (fontSize + 8) - 6;
    c.fillText(l, W / 2, y);
  });
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  const rr = Math.min(r, w / 2, h / 2);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function drawSceneAt(sc, localMs, target, withFades = state.transition === "fade-black") {
  const c = target || ctx;
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);

  const media = state.media.find((m) => m.id === sc.mediaId);
  const progress = Math.min(1, Math.max(0, localMs / sc.durationMs));

  if (media) {
    if (media.type === "image") {
      const el = media.el;
      const zoom = 1 + 0.06 * progress;
      const ew = el.naturalWidth * zoom;
      const eh = el.naturalHeight * zoom;
      const scale = Math.max(W / ew, H / eh);
      const dw = ew * scale, dh = eh * scale;
      c.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else if (media.el.readyState >= 2) {
      drawCover(c, media.el);
    }
  } else if (sc.hue !== undefined) {
    drawGradientScene(c, sc, localMs);
  }

  drawTextOverlay(c, sc.text);

  if (sc.attribution) {
    c.font = "16px system-ui, sans-serif";
    c.textAlign = "right";
    c.fillStyle = "rgba(255, 255, 255, 0.55)";
    c.fillText(sc.attribution, W - 20, H - 16);
  }

  if (withFades) {
    const fadeIn = Math.min(1, localMs / FADE_MS);
    const fadeOut = Math.min(1, (sc.durationMs - localMs) / FADE_MS);
    const alpha = 1 - Math.min(fadeIn, fadeOut);
    if (alpha > 0) {
      c.fillStyle = `rgba(0,0,0,${alpha})`;
      c.fillRect(0, 0, W, H);
    }
  }
}

function previewCurrentSceneFrame() {
  const sc = selectedScene();
  if (state.playing) return;
  if (sc) {
    drawSceneAt(sc, Math.min(600, sc.durationMs));
    updatePlaytime(totalDurationMs());
  } else {
    drawWelcomeFrame();
  }
}

function drawWelcomeFrame() {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "hsl(240, 45%, 16%)");
  g.addColorStop(1, "hsl(280, 40%, 8%)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.font = "600 44px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText("🎬 VoixOff Studio", W / 2, H / 2 - 30);
  ctx.font = "600 24px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("1. Collez votre script   2. ✨ Générer les scènes   3. ▶ Lecture", W / 2, H / 2 + 34);
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText("Chaque ligne du script devient une scène illustrée avec sa voix off.", W / 2, H / 2 + 74);
  updatePlaytime(0);
}

/* ---------- Lecture ---------- */

function sceneAtTime(ms) {
  let acc = 0;
  for (let idx = 0; idx < state.scenes.length; idx++) {
    const sc = state.scenes[idx];
    if (ms < acc + sc.durationMs) return { sc, localMs: ms - acc, idx };
    acc += sc.durationMs;
  }
  return null;
}

const TRANS_MS = 600;
const offA = document.createElement("canvas");
const offB = document.createElement("canvas");
offA.width = offB.width = W;
offA.height = offB.height = H;
const transCache = { idx: -1 };

function smoothstep(p) {
  return p * p * (3 - 2 * p);
}

function drawWithTransition(sc, localMs, idx) {
  const type = state.transition;
  if (idx === 0 || localMs >= TRANS_MS || type === "none" || type === "fade-black") {
    drawSceneAt(sc, localMs);
    return;
  }
  if (type === "fade-white") {
    drawSceneAt(sc, localMs, ctx, false);
    ctx.fillStyle = `rgba(255,255,255,${1 - smoothstep(localMs / TRANS_MS)})`;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (transCache.idx !== idx) {
    const prev = state.scenes[idx - 1];
    drawSceneAt(prev, Math.max(0, prev.durationMs - FADE_MS), offA.getContext("2d"), false);
    transCache.idx = idx;
  }
  const p = smoothstep(Math.min(1, localMs / TRANS_MS));
  drawSceneAt(sc, localMs, offB.getContext("2d"), false);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (type === "crossfade") {
    ctx.drawImage(offA, 0, 0);
    ctx.globalAlpha = p;
    ctx.drawImage(offB, 0, 0);
    ctx.globalAlpha = 1;
  } else if (type === "slide") {
    ctx.drawImage(offA, -p * W, 0);
    ctx.drawImage(offB, (1 - p) * W, 0);
  } else if (type === "zoom") {
    ctx.drawImage(offA, 0, 0);
    const s = 1.15 - 0.15 * p;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.drawImage(offB, -W / 2, -H / 2);
    ctx.restore();
  }
}

let rafId = null;
let spokenScenes = new Set();
const videoEls = new Set();

function updatePlaytime(ms) {
  $("#playTime").textContent = `${fmtTime(ms)} / ${fmtTime(totalDurationMs())}`;
}

function playbackLoop(ts) {
  const elapsed = ts - state.playStartTs;
  const at = sceneAtTime(elapsed);

  if (!at || state.exportAbort) {
    stopPlayback(true);
    if (state.onPlaybackEnd) { const cb = state.onPlaybackEnd; state.onPlaybackEnd = null; cb(); }
    return;
  }

  const { sc, localMs } = at;
  if (sc.id !== state.currentSceneId) {
    state.currentSceneId = sc.id;
    videoEls.forEach((v) => v.pause());
    videoEls.clear();
    const media = state.media.find((m) => m.id === sc.mediaId);
    if (media?.type === "video") {
      media.el.muted = true;
      media.el.currentTime = 0;
      media.el.play().catch(() => {});
      videoEls.add(media.el);
    }
    if (!spokenScenes.has(sc.id) && sc.text.trim()) {
      spokenScenes.add(sc.id);
      speakScene(sc);
    }
  }

  drawWithTransition(sc, localMs, at.idx);
  updatePlaytime(elapsed);
  rafId = requestAnimationFrame(playbackLoop);
}

function startPlayback(fromStart = true, onEnd = null) {
  if (!state.scenes.length) { toast("Rien à lire : générez des scènes d'abord.", true); return; }
  stopPlayback(true);
  state.playing = true;
  state.exportAbort = false;
  state.onPlaybackEnd = onEnd;
  state.currentSceneId = null;
  spokenScenes = new Set();
  transCache.idx = -1;
  state.playStartTs = performance.now() + 250;
  startMusicPreview();
  $("#btnPlay").textContent = "⏸ Pause";
  rafId = requestAnimationFrame(playbackLoop);
}

function stopPlayback(silent = false) {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  const wasPlaying = state.playing;
  state.playing = false;
  if ("speechSynthesis" in window) synth.cancel();
  videoEls.forEach((v) => v.pause());
  videoEls.clear();
  stopMusicPreview();
  $("#btnPlay").textContent = "▶ Lecture";
  if (wasPlaying && !silent) { previewCurrentSceneFrame(); }
  if (wasPlaying) updatePlaytime(totalDurationMs());
}

$("#btnPlay").addEventListener("click", () => {
  if (state.playing) { stopPlayback(); return; }
  if (!state.scenes.length) {
    if (!$("#scriptInput").value.trim()) {
      toast("Écrivez votre script puis cliquez « ✨ Générer les scènes ».", true);
      return;
    }
    generateScenes();
  }
  startPlayback(true);
});
$("#btnStop").addEventListener("click", () => {
  state.exportAbort = true;
  stopPlayback();
  previewCurrentSceneFrame();
});

/* ---------- Export ---------- */

$("#btnExport").addEventListener("click", exportVideo);

async function pickTabAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) return null;
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false },
    preferCurrentTab: true,
  });
  const track = stream.getAudioTracks()[0];
  stream.getVideoTracks().forEach((t) => t.stop());
  return track || null;
}

async function exportVideo() {
  if (!state.scenes.length) { toast("Rien à exporter : générez des scènes d'abord.", true); return; }
  if (typeof MediaRecorder === "undefined") { toast("MediaRecorder non supporté par ce navigateur.", true); return; }

  const mode = $("#audioMode").value;
  stopPlayback(true);

  let audioCtx = null;
  let dest = null;
  let audioTrack = null;
  let scheduled = [];
  let tabStreamTrack = null;

  const ensureDest = () => {
    if (!audioCtx) audioCtx = new AudioContext();
    if (!dest) dest = audioCtx.createMediaStreamDestination();
    return dest;
  };

  try {
    if (mode === "tab") {
      toast("Choisissez « Cet onglet » et cochez « Partager l'audio de l'onglet ».");
      tabStreamTrack = await pickTabAudio();
      if (tabStreamTrack) {
        audioCtx.createMediaStreamSource(new MediaStream([tabStreamTrack])).connect(ensureDest());
      } else {
        toast("Aucune piste audio capturée : vidéo muette (sauf musique de fond).", true);
      }
    } else if (mode === "file" && state.audios.length) {
      const d = ensureDest();
      let offset = 0;
      for (let i = 0; i < state.scenes.length; i++) {
        const buf = state.audios[i % state.audios.length]?.buffer;
        if (!buf) continue;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(d);
        src.start(audioCtx.currentTime + offset / 1000);
        scheduled.push(src);
        offset += state.scenes[i].durationMs;
      }
    }

    if (state.music) {
      const d = ensureDest();
      const src = audioCtx.createBufferSource();
      src.buffer = state.music.buffer;
      src.loop = state.musicLoop;
      const gain = audioCtx.createGain();
      gain.gain.value = state.musicVolume;
      src.connect(gain).connect(d);
      src.start(audioCtx.currentTime + 0.25);
      scheduled.push(src);
    }

    if (dest) audioTrack = dest.stream.getAudioTracks()[0];
  } catch (err) {
    toast("Capture audio annulée : " + err.message, true);
    return;
  }

  const canvasStream = canvas.captureStream(30);
  const mixed = new MediaStream(canvasStream.getVideoTracks());
  if (audioTrack) mixed.addTrack(audioTrack);

  const mimeCandidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    "video/mp4",
    'video/webm;codecs="vp9,opus"',
    'video/webm;codecs="vp8,opus"',
    "video/webm",
  ];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
  const ext = mimeType && mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  const rec = new MediaRecorder(mixed, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  rec.onstop = () => {
    canvasStream.getVideoTracks().forEach((t) => t.stop());
    scheduled.forEach((s) => { try { s.stop(); } catch {} });
    if (tabStreamTrack) tabStreamTrack.stop();
    if (audioCtx) audioCtx.close();
    const blob = new Blob(chunks, { type: (mimeType || "video/webm").split(";")[0] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voixoff-studio-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Export terminé : vidéo ${ext.toUpperCase()} téléchargée 🎉`);
  };

  state.exportAbort = false;
  rec.start(500);
  if (ext === "mp4") {
    toast("Enregistrement en cours… (format MP4/H.264).");
  } else {
    toast("Enregistrement en temps réel… (MP4 non supporté ici : export WebM — convertible en MP4).");
  }

  startPlayback(true, () => {
    setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, 600);
  });

  const watch = setInterval(() => {
    if (!state.playing || state.exportAbort) {
      clearInterval(watch);
      if (state.exportAbort && rec.state !== "inactive") rec.stop();
    }
  }, 300);
}

/* ---------- Fichiers audio ---------- */

let previewAudio = null;

function startMusicPreview() {
  if (!state.music) return;
  try {
    if (!previewAudio) previewAudio = { ctx: new AudioContext() };
    previewAudio.ctx.resume();
    const src = previewAudio.ctx.createBufferSource();
    src.buffer = state.music.buffer;
    src.loop = state.musicLoop;
    const gain = previewAudio.ctx.createGain();
    gain.gain.value = state.musicVolume;
    src.connect(gain).connect(previewAudio.ctx.destination);
    src.start(previewAudio.ctx.currentTime + 0.25);
    previewAudio.src = src;
  } catch {}
}

function stopMusicPreview() {
  if (previewAudio?.src) {
    try { previewAudio.src.stop(); } catch {}
    previewAudio.src = null;
  }
}

$("#fileMusic").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const ac = new AudioContext();
  try {
    state.music = { name: file.name, buffer: await ac.decodeAudioData(await file.arrayBuffer()) };
    toast(`Musique « ${file.name} » prête (${fmtTime(state.music.buffer.duration * 1000)}).`);
  } catch {
    toast(`Musique illisible : ${file.name}`, true);
  }
  ac.close();
  e.target.value = "";
});

$("#musicVolume").addEventListener("input", () => {
  state.musicVolume = parseInt($("#musicVolume").value, 10) / 100;
  $("#musicVolVal").textContent = $("#musicVolume").value + "%";
});

$("#musicLoop").addEventListener("change", () => {
  state.musicLoop = $("#musicLoop").checked;
});

$("#transitionSelect").addEventListener("change", () => {
  state.transition = $("#transitionSelect").value;
  if (!state.playing) previewCurrentSceneFrame();
});

$("#fileAudio").addEventListener("change", async (e) => {
  const ac = new AudioContext();
  for (const file of e.target.files) {
    try {
      const buffer = await ac.decodeAudioData(await file.arrayBuffer());
      state.audios.push({ id: nextId("aud"), name: file.name, buffer });
    } catch {
      toast(`Audio illisible : ${file.name}`, true);
    }
  }
  ac.close();
  e.target.value = "";
  toast(`${state.audios.length} fichier(s) audio prêt(s) pour l'export.`);
});

/* ---------- Réglages voix globaux ---------- */

$("#rateRange").addEventListener("input", () => { $("#rateVal").textContent = parseFloat($("#rateRange").value).toFixed(1); });
$("#pitchRange").addEventListener("input", () => { $("#pitchVal").textContent = parseFloat($("#pitchRange").value).toFixed(1); });

/* ---------- Initialisation ---------- */

window.addEventListener("beforeunload", () => { if ("speechSynthesis" in window) synth.cancel(); });
document.fonts?.ready.then(() => previewCurrentSceneFrame());
previewCurrentSceneFrame();
