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
    } else if (visualMode === "anim") {
      sc.prompt = text;
      sc.shot = "auto";
      sc.hue = hueFor(sc.prompt);
      sc.fxTheme = detectTheme(sc.prompt);
    } else if (visualMode === "auto-images") {
      sc.keywords = extractKeywords(text);
      sc.hue = hueFor(sc.keywords.join(" ") || text);
      fetchAutoImage(sc);
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

/* ---------- Animation par prompt ---------- */

const FX_THEMES = ["sun", "ocean", "rain", "snow", "fire", "forest", "mountains", "stars", "city", "abstract"];

const FX_KEYWORDS = {
  sun: ["lever", "coucher", "aube", "aurore", "crépuscule", "crepuscule", "soleil", "sunrise", "sunset", "sun", "horizon"],
  ocean: ["mer", "océan", "ocean", "vague", "vagues", "plage", "surf", "eau", "sea", "wave", "beach", "lac", "lake", "île", "ile", "port", "bateau"],
  rain: ["pluie", "orage", "tempête", "tempete", "storm", "rain", "averse", "mousson"],
  snow: ["neig", "neige", "hiver", "winter", "snow", "froid", "glace", "blizzard", "poudreuse"],
  fire: ["feu", "flamme", "flammes", "volcan", "lave", "fire", "flame", "braise", "braises", "cendre", "incendie", "brasier"],
  forest: ["forêt", "foret", "arbre", "arbres", "jungle", "nature", "forest", "tree", "feuillage", "bois", "clairière"],
  mountains: ["montagne", "montagnes", "colline", "collines", "vallée", "vallee", "mountain", "sommet", "alpin", "paysage", "falaise", "canyon"],
  stars: ["espace", "étoil", "étoile", "étoiles", "etoile", "etoiles", "galaxie", "cosmos", "space", "lune", "moon", "univers", "planète", "planete", "astronaute", "voie lactée"],
  city: ["ville", "city", "urbain", "gratte-ciel", "gratte ciel", "building", "immeuble", "immeubles", "rue", "street", "métropole", "metropole", "skyline", "néons", "neons", "trafic", "nuit", "night"],
  abstract: [],
};

const THEME_LABELS = {
  sun: "Coucher / lever de soleil",
  ocean: "Océan",
  rain: "Pluie",
  snow: "Neige",
  fire: "Feu",
  forest: "Forêt",
  mountains: "Montagnes",
  stars: "Nuit étoilée",
  city: "Ville",
  abstract: "Abstrait",
};

const SHOT_TYPES = [
  ["auto", "Auto (cadrage selon la scène)"],
  ["plan-large", "Plan large"],
  ["plan-moyen", "Plan moyen"],
  ["gros-plan", "Gros plan"],
  ["plongee", "Plongée (vue du dessus)"],
  ["contre-plongee", "Contre-plongée (vue du bas)"],
  ["travelling", "Travelling latéral"],
  ["zoom-avant", "Zoom avant progressif"],
];

function detectTheme(promptText) {
  const p = (promptText || "").toLowerCase();
  for (const theme of FX_THEMES) {
    if ((FX_KEYWORDS[theme] || []).some((k) => p.includes(k))) return theme;
  }
  return "abstract";
}

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fxRange(n, make) {
  return Array.from({ length: n }, () => make());
}

function fxSkylineRow(rnd, minW, maxW, minH, maxH) {
  const row = [];
  let x = -40;
  while (x < W + 40) {
    const w = minW + rnd() * (maxW - minW);
    row.push({ x, w, h: minH + rnd() * (maxH - minH) });
    x += w + rnd() * 24;
  }
  return row;
}

function ensureFx(sc) {
  if (sc.fxParts) return sc.fxParts;
  const rnd = mulberry32(hashStr(sc.id || sc.text || "fx"));
  const R = (a, b) => a + rnd() * (b - a);
  const parts = {};
  switch (sc.fxTheme || "abstract") {
    case "stars":
      parts.stars = fxRange(150, () => ({ x: R(0, W), y: R(0, H * 0.92), r: R(0.6, 2.2), ph: R(0, 6.283), depth: R(0.3, 1) }));
      parts.shootAt = R(3, 6);
      break;
    case "rain":
      parts.drops = fxRange(170, () => ({ x: R(-100, W + 100), y: R(0, H), len: R(14, 34), sp: R(650, 1050) }));
      parts.silhouette = fxSkylineRow(rnd, 60, 150, H * 0.18, H * 0.4);
      break;
    case "snow":
      parts.flakes = fxRange(150, () => ({ x: R(0, W), y: R(0, H), r: R(1.5, 4), sp: R(35, 105), ph: R(0, 6.283), amp: R(14, 42) }));
      break;
    case "fire":
      parts.embers = fxRange(90, () => ({ x: R(W * 0.12, W * 0.88), y: R(0, H), sp: R(60, 170), r: R(1.5, 4.5), ph: R(0, 6.283), amp: R(24, 60) }));
      break;
    case "forest":
      parts.trees = fxRange(14, () => ({ x: R(-40, W + 40), w: R(60, 130), h: R(H * 0.24, H * 0.5), ph: R(0, 6.283) }));
      parts.flies = fxRange(26, () => ({ x: R(0, W), y: R(H * 0.45, H * 0.95), r: R(1.5, 3), ph: R(0, 6.283), ax: R(20, 60), ay: R(10, 30), sx: R(0.3, 0.8), sy: R(0.2, 0.6) }));
      break;
    case "mountains":
      parts.ridges = [0, 1, 2].map(() => ({ y: R(H * 0.42, H * 0.72), amp: R(60, 150), seg: R(140, 260), ph: R(0, 6.283) }));
      break;
    case "ocean":
      parts.waves = [0, 1, 2, 3, 4].map((i) => ({ baseY: H * (0.56 + i * 0.08), amp: 5 + i * 2.2, ph: R(0, 6.283) }));
      break;
    case "sun":
      parts.hills = [
        { y: H * 0.8, amp: 66, seg: 300, ph: R(0, 6.283) },
        { y: H * 0.9, amp: 48, seg: 220, ph: R(0, 6.283) },
      ];
      break;
    case "city":
      parts.back = fxSkylineRow(rnd, 90, 200, H * 0.16, H * 0.34);
      parts.front = fxSkylineRow(rnd, 80, 190, H * 0.24, H * 0.44);
      break;
    default:
      parts.orbs = fxRange(5, () => ({ cx: R(0, W), cy: R(0, H), r: R(180, 400), hueOff: R(-70, 70), sx: R(0.15, 0.5), sy: R(0.1, 0.4), ph: R(0, 6.283) }));
  }
  sc.fxParts = parts;
  return parts;
}

function computeShotTransform(sc, progress) {
  const shot = sc.shot || "auto";
  if (shot === "auto") {
    if (sc.mediaId || !sc.fxTheme) return { scale: 1, dx: 0, dy: 0 };
    const theme = sc.fxTheme;
    if (theme === "stars" || theme === "mountains" || theme === "city") {
      return { scale: 1.12, dx: Math.sin(progress * Math.PI) * 12, dy: 0 };
    }
    return { scale: 1 + 0.1 * progress, dx: 0, dy: 0 };
  }
  switch (shot) {
    case "plan-large": return { scale: 1.08, dx: Math.sin(progress * Math.PI) * 10, dy: 0 };
    case "plan-moyen": return { scale: 1.28, dx: Math.sin(progress * Math.PI) * 8, dy: -8 };
    case "gros-plan": return { scale: 1.62, dx: Math.sin(progress * Math.PI) * 5, dy: -14 };
    case "plongee": return { scale: 1.2, dx: 0, dy: 30 + Math.sin(progress * Math.PI) * 10 };
    case "contre-plongee": return { scale: 1.2, dx: 0, dy: -30 - Math.sin(progress * Math.PI) * 10 };
    case "travelling": return { scale: 1.28, dx: (progress - 0.5) * W * 0.16, dy: 0 };
    case "zoom-avant": return { scale: 1 + 0.28 * progress, dx: 0, dy: 0 };
    default: return { scale: 1, dx: 0, dy: 0 };
  }
}

function animateFx(c, sc, localMs) {
  const parts = ensureFx(sc);
  const p = Math.min(1, Math.max(0, localMs / Math.max(1, sc.durationMs)));
  const t = localMs / 1000;
  const hue = (sc.hue || 220) % 360;
  switch (sc.fxTheme || "abstract") {
    case "sun": fxSun(c, sc, t, p, parts, hue); break;
    case "ocean": fxOcean(c, sc, t, p, parts, hue); break;
    case "rain": fxRain(c, sc, t, p, parts, hue); break;
    case "snow": fxSnow(c, sc, t, p, parts, hue); break;
    case "fire": fxFire(c, sc, t, p, parts, hue); break;
    case "forest": fxForest(c, sc, t, p, parts, hue); break;
    case "mountains": fxMountains(c, sc, t, p, parts, hue); break;
    case "stars": fxStars(c, sc, t, p, parts, hue); break;
    case "city": fxCity(c, sc, t, p, parts, hue); break;
    default: fxAbstract(c, sc, t, p, parts, hue); break;
  }
}

function fxSun(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 220) % 360}, 55%, ${Math.round(20 + 14 * p)}%)`);
  g.addColorStop(0.62, `hsl(${(hue + 28) % 360}, 80%, ${Math.round(50 + 8 * p)}%)`);
  g.addColorStop(1, `hsl(${(hue + 8) % 360}, 85%, 36%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const sx = W * (0.18 + 0.64 * p);
  const sy = H * 0.72 - Math.sin(p * Math.PI) * H * 0.42;
  const glow = c.createRadialGradient(sx, sy, 8, sx, sy, 360);
  glow.addColorStop(0, "hsla(45, 100%, 78%, 0.85)");
  glow.addColorStop(0.3, "hsla(42, 95%, 65%, 0.4)");
  glow.addColorStop(1, "hsla(40, 90%, 60%, 0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  c.save();
  c.translate(sx, sy);
  c.rotate(t * 0.05);
  c.fillStyle = "hsla(45, 100%, 82%, 0.07)";
  for (let i = 0; i < 12; i++) {
    c.rotate((Math.PI * 2) / 12);
    c.beginPath();
    c.moveTo(0, -56);
    c.lineTo(-16, -540);
    c.lineTo(16, -540);
    c.closePath();
    c.fill();
  }
  c.restore();

  c.fillStyle = "#fff3c4";
  c.beginPath();
  c.arc(sx, sy, 44, 0, Math.PI * 2);
  c.fill();

  const hasWater = /(mer|oc[eé]an|vague|plage|lac|eau|fleuve)/i.test(sc.prompt || "");
  if (hasWater) {
    const horizon = H * 0.74;
    const sea = c.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, `hsl(${(hue + 195) % 360}, 55%, 32%)`);
    sea.addColorStop(1, `hsl(${(hue + 215) % 360}, 60%, 10%)`);
    c.fillStyle = sea;
    c.fillRect(0, horizon, W, H - horizon);
    c.fillStyle = "hsla(45, 100%, 80%, 0.35)";
    for (let i = 0; i < 14; i++) {
      const yy = horizon + 10 + i * 11;
      const wob = Math.sin(t * 1.6 + i * 1.7) * (26 + i * 9);
      const ww = Math.max(26, 130 + i * 20 - i * i);
      c.fillRect(sx - ww / 2 + wob, yy, ww, 4);
    }
  } else {
    const horizon = H * 0.74;
    const haze = c.createLinearGradient(0, horizon - 120, 0, horizon + 40);
    haze.addColorStop(0, "hsla(35, 90%, 60%, 0)");
    haze.addColorStop(1, "hsla(35, 90%, 60%, 0.3)");
    c.fillStyle = haze;
    c.fillRect(0, horizon - 120, W, 160);
    for (const hill of parts.hills || []) {
      c.fillStyle = `hsl(${(hue + 255) % 360}, 40%, 10%)`;
      c.beginPath();
      c.moveTo(-10, H);
      for (let x = -10; x <= W + 10; x += 16) {
        const y = hill.y - hill.amp * Math.abs(Math.sin(x / hill.seg + hill.ph)) - 6 * Math.sin(x / 90 + t * 0.2);
        c.lineTo(x, y);
      }
      c.lineTo(W + 10, H);
      c.closePath();
      c.fill();
    }
  }
}

function fxOcean(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 205) % 360}, 45%, ${Math.round(13 + 8 * p)}%)`);
  g.addColorStop(0.52, `hsl(${(hue + 195) % 360}, 55%, 33%)`);
  g.addColorStop(1, `hsl(${(hue + 212) % 360}, 65%, 14%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const horizon = H * 0.52;
  const sunX = W * 0.5 + Math.sin(t * 0.1) * 46;
  const mg = c.createRadialGradient(sunX, horizon, 6, sunX, horizon, 320);
  mg.addColorStop(0, "hsla(46, 100%, 82%, 0.55)");
  mg.addColorStop(1, "hsla(46, 92%, 72%, 0)");
  c.fillStyle = mg;
  c.fillRect(0, 0, W, H);

  (parts.waves || []).forEach((wv, wi) => {
    const y = (x) => wv.baseY + Math.sin(x / (150 - wv.amp * 4) + wv.ph + t * (0.7 + wi * 0.25)) * wv.amp;
    c.fillStyle = `hsla(${(hue + 208) % 360}, 62%, ${12 + wi * 3}%, 0.9)`;
    c.beginPath();
    c.moveTo(0, H);
    c.lineTo(0, y(0));
    for (let x = 0; x <= W; x += 14) c.lineTo(x, y(x));
    c.lineTo(W, H);
    c.closePath();
    c.fill();
    c.strokeStyle = "hsla(190, 85%, 88%, 0.14)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, y(0));
    for (let x = 0; x <= W; x += 14) c.lineTo(x, y(x));
    c.stroke();
  });

  c.fillStyle = "hsla(46, 100%, 85%, 0.3)";
  for (let i = 0; i < 10; i++) {
    const yy = horizon + 8 + i * 16;
    const wob = Math.sin(t * 1.4 + i * 2.1) * (24 + i * 8);
    const ww = Math.max(24, 120 + i * 24 - i * i);
    c.fillRect(sunX - ww / 2 + wob, yy, ww, 4);
  }
}

function fxRain(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 218) % 360}, 22%, ${Math.round(10 + 5 * p)}%)`);
  g.addColorStop(1, `hsl(${(hue + 228) % 360}, 26%, 24%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  c.fillStyle = "hsla(222, 26%, 9%, 0.9)";
  for (const b of parts.silhouette || []) c.fillRect(b.x, H - b.h, b.w, b.h);

  const cycle = t % 9;
  if (cycle < 0.09 || (cycle > 0.17 && cycle < 0.23)) {
    c.fillStyle = "rgba(255,255,255,0.13)";
    c.fillRect(0, 0, W, H);
  }

  c.strokeStyle = "hsla(200, 72%, 82%, 0.38)";
  c.lineWidth = 1.4;
  c.beginPath();
  for (const d of parts.drops || []) {
    const y = (d.y + t * d.sp) % (H + d.len);
    c.moveTo(d.x - 4, y - d.len);
    c.lineTo(d.x + 4, y);
  }
  c.stroke();

  for (let i = 0; i < 8; i++) {
    const rp = (t * 0.65 + i / 8) % 1;
    const r = 4 + rp * 30;
    c.strokeStyle = `hsla(200, 60%, 82%, ${(0.28 * (1 - rp)).toFixed(3)})`;
    c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(W * ((i * 0.13 + 0.07) % 1), H * 0.94, r, r * 0.22, 0, 0, Math.PI * 2);
    c.stroke();
  }
}

function fxSnow(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 210) % 360}, 30%, ${Math.round(20 + 10 * p)}%)`);
  g.addColorStop(0.7, `hsl(${(hue + 215) % 360}, 24%, 42%)`);
  g.addColorStop(1, `hsl(${(hue + 220) % 360}, 22%, 30%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  c.fillStyle = "hsla(215, 25%, 34%, 0.7)";
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) c.lineTo(x, H * 0.62 - 40 * Math.sin(x / 260 + p));
  c.lineTo(W, H);
  c.closePath();
  c.fill();

  const fog = c.createLinearGradient(0, H * 0.2, 0, H);
  fog.addColorStop(0, "hsla(210, 30%, 95%, 0)");
  fog.addColorStop(1, "hsla(210, 30%, 95%, 0.28)");
  c.fillStyle = fog;
  c.fillRect(0, H * 0.2, W, H * 0.8);

  c.fillStyle = "hsla(210, 30%, 92%, 0.95)";
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 18) c.lineTo(x, H - 46 - 16 * Math.sin(x / 170 + t * 0.15));
  c.lineTo(W, H);
  c.closePath();
  c.fill();

  for (const f of parts.flakes || []) {
    const y = (f.y + t * f.sp) % (H + 12);
    const x = f.x + Math.sin(t * 0.7 + f.ph) * f.amp;
    c.fillStyle = `hsla(210, 20%, 98%, ${(0.45 + 0.4 * Math.sin(t + f.ph)).toFixed(3)})`;
    c.beginPath();
    c.arc(x, y, f.r, 0, Math.PI * 2);
    c.fill();
  }
}

function fxFire(c, sc, t, p, parts, hue) {
  c.fillStyle = "#0b0503";
  c.fillRect(0, 0, W, H);

  const puls = 0.72 + 0.28 * Math.sin(t * 6.3) * (0.55 + 0.45 * Math.sin(t * 2.1));
  const gx = W / 2, gy = H * 1.04;
  const glow = c.createRadialGradient(gx, gy, 10, gx, gy, 560);
  glow.addColorStop(0, `hsla(${18 + (hue % 12)}, 100%, 58%, ${(0.75 * puls).toFixed(3)})`);
  glow.addColorStop(0.45, `hsla(14, 95%, 45%, ${(0.4 * puls).toFixed(3)})`);
  glow.addColorStop(1, "hsla(10, 90%, 30%, 0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  c.fillStyle = "#080404";
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 14) c.lineTo(x, H - 88 - 30 * Math.abs(Math.sin(x / 150 + 1)) + 6 * Math.sin(t + x / 60));
  c.lineTo(W, H);
  c.closePath();
  c.fill();

  for (const e of parts.embers || []) {
    const y = H - ((e.y + t * e.sp) % (H + 60));
    const x = e.x + Math.sin(t * 1.3 + e.ph) * e.amp;
    const fade = Math.max(0, Math.min(1, y / (H * 0.85)));
    c.fillStyle = `hsla(${26 + 16 * Math.sin(e.ph)}, 100%, ${(55 + 12 * Math.sin(t * 7 + e.ph)).toFixed(1)}%, ${(0.85 * fade).toFixed(3)})`;
    c.beginPath();
    c.arc(x, y, e.r, 0, Math.PI * 2);
    c.fill();
  }
}

function fxForest(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 95) % 360}, 40%, ${Math.round(12 + 8 * p)}%)`);
  g.addColorStop(1, `hsl(${(hue + 115) % 360}, 45%, 24%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const rays = c.createLinearGradient(W * 0.2, 0, W * 0.8, H);
  rays.addColorStop(0, "hsla(60, 90%, 75%, 0.12)");
  rays.addColorStop(0.5, "hsla(60, 90%, 75%, 0.02)");
  rays.addColorStop(1, "hsla(60, 90%, 75%, 0)");
  c.fillStyle = rays;
  c.fillRect(0, 0, W, H);

  c.fillStyle = "hsla(120, 35%, 10%, 0.9)";
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 16) c.lineTo(x, H - 54 - 22 * Math.sin(x / 130 + 2));
  c.lineTo(W, H);
  c.closePath();
  c.fill();

  for (const tr of parts.trees || []) {
    const sway = 0.02 * Math.sin(t * 0.7 + tr.ph);
    c.save();
    c.translate(tr.x, H + 6);
    c.rotate(sway);
    c.fillStyle = "rgba(20, 14, 8, 0.9)";
    c.fillRect(-5, -tr.h * 0.3, 10, tr.h * 0.3);
    const tone = 16 + Math.round(9 * Math.sin(tr.ph));
    c.fillStyle = `hsl(${130 + 20 * Math.sin(tr.ph)}, 38%, ${tone}%)`;
    c.beginPath();
    c.moveTo(-tr.w / 2, 0);
    c.lineTo(0, -tr.h);
    c.lineTo(tr.w / 2, 0);
    c.closePath();
    c.fill();
    c.fillStyle = `hsl(${128 + 20 * Math.sin(tr.ph)}, 40%, ${tone - 5}%)`;
    c.beginPath();
    c.moveTo(-tr.w * 0.36, -tr.h * 0.42);
    c.lineTo(0, -tr.h * 0.78);
    c.lineTo(tr.w * 0.36, -tr.h * 0.42);
    c.closePath();
    c.fill();
    c.restore();
  }

  for (const f of parts.flies || []) {
    const x = f.x + Math.sin(t * f.sx + f.ph) * f.ax;
    const y = f.y + Math.cos(t * f.sy + f.ph) * f.ay;
    const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.2 + f.ph));
    const gg = c.createRadialGradient(x, y, 0, x, y, f.r * 5);
    gg.addColorStop(0, `hsla(70, 100%, 75%, ${(0.7 * a).toFixed(3)})`);
    gg.addColorStop(1, "hsla(70, 100%, 70%, 0)");
    c.fillStyle = gg;
    c.beginPath();
    c.arc(x, y, f.r * 5, 0, Math.PI * 2);
    c.fill();
  }
}

function fxMountains(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 210) % 360}, 45%, ${Math.round(16 + 10 * p)}%)`);
  g.addColorStop(0.8, `hsl(${(hue + 25) % 360}, 55%, 55%)`);
  g.addColorStop(1, `hsl(${(hue + 35) % 360}, 45%, 40%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const sg = c.createRadialGradient(W * 0.72, H * 0.3, 4, W * 0.72, H * 0.3, 260);
  sg.addColorStop(0, "hsla(50, 100%, 85%, 0.55)");
  sg.addColorStop(1, "hsla(50, 95%, 75%, 0)");
  c.fillStyle = sg;
  c.fillRect(0, 0, W, H);

  (parts.ridges || []).forEach((rg, i) => {
    const off = t * (4 + i * 7);
    c.fillStyle = `hsl(${(hue + 218) % 360}, 30%, ${[58, 38, 20][i]}%)`;
    c.beginPath();
    c.moveTo(-10, H);
    for (let x = -10; x <= W + 10; x += 12) {
      const wx = x + off;
      const y = rg.y - rg.amp * Math.abs(Math.sin(wx / rg.seg + rg.ph)) - rg.amp * 0.25 * Math.sin(wx / (rg.seg * 0.43) + rg.ph * 2);
      c.lineTo(x, y);
    }
    c.lineTo(W + 10, H);
    c.closePath();
    c.fill();
  });

  const mist = c.createLinearGradient(0, H * 0.52, 0, H * 0.72);
  mist.addColorStop(0, "hsla(210, 40%, 92%, 0)");
  mist.addColorStop(0.5, `hsla(210, 40%, 92%, ${(0.1 + 0.06 * Math.sin(t * 0.4)).toFixed(3)})`);
  mist.addColorStop(1, "hsla(210, 40%, 92%, 0)");
  c.fillStyle = mist;
  c.fillRect(0, H * 0.52, W, H * 0.2);
}

function fxStars(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 225) % 360}, 60%, ${Math.round(8 + 4 * p)}%)`);
  g.addColorStop(1, "hsl(235, 55%, 3%)");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  c.save();
  c.translate(W * 0.62, H * 0.34);
  c.rotate(-0.5);
  const band = c.createLinearGradient(0, -140, 0, 140);
  band.addColorStop(0, "hsla(220, 60%, 80%, 0)");
  band.addColorStop(0.5, "hsla(220, 60%, 82%, 0.1)");
  band.addColorStop(1, "hsla(220, 60%, 80%, 0)");
  c.fillStyle = band;
  c.fillRect(-W, -140, W * 2, 280);
  c.restore();

  for (const s of parts.stars || []) {
    const x = (s.x + t * 7 * s.depth) % W;
    const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1 + s.depth * 2) + s.ph));
    c.fillStyle = `hsla(45, 30%, 96%, ${a.toFixed(3)})`;
    c.beginPath();
    c.arc(x, s.y, s.r, 0, Math.PI * 2);
    c.fill();
  }

  const per = parts.shootAt || 5;
  const ph = t % per;
  if (ph < 0.7) {
    const k = ph / 0.7;
    const mx = W * 0.15 + k * 330;
    const my = H * 0.14 + k * 150;
    const tail = c.createLinearGradient(mx - 90, my - 42, mx, my);
    tail.addColorStop(0, "hsla(0, 0%, 100%, 0)");
    tail.addColorStop(1, `hsla(0, 0%, 100%, ${(0.9 * (1 - k) + 0.1).toFixed(3)})`);
    c.strokeStyle = tail;
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(mx - 90, my - 42);
    c.lineTo(mx, my);
    c.stroke();
  }

  c.fillStyle = "hsla(230, 45%, 12%, 0.9)";
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 18) c.lineTo(x, H - 60 - 34 * Math.abs(Math.sin(x / 210 + 1.3)));
  c.lineTo(W, H);
  c.closePath();
  c.fill();
}

function fxCity(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${(hue + 235) % 360}, 55%, ${Math.round(7 + 4 * p)}%)`);
  g.addColorStop(0.75, `hsl(${(hue + 260) % 360}, 45%, 20%)`);
  g.addColorStop(1, `hsl(${(hue + 300) % 360}, 40%, 14%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const mg = c.createRadialGradient(W * 0.78, H * 0.18, 6, W * 0.78, H * 0.18, 150);
  mg.addColorStop(0, "hsla(48, 60%, 92%, 0.8)");
  mg.addColorStop(0.4, "hsla(48, 60%, 92%, 0.18)");
  mg.addColorStop(1, "hsla(48, 60%, 92%, 0)");
  c.fillStyle = mg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = "hsla(48, 60%, 94%, 0.95)";
  c.beginPath();
  c.arc(W * 0.78, H * 0.18, 30, 0, Math.PI * 2);
  c.fill();

  const drawRow = (row, color) => {
    c.fillStyle = color;
    for (const b of row || []) c.fillRect(b.x, H - b.h, b.w, b.h);
    for (const b of row || []) {
      const cols = Math.max(1, Math.floor((b.w - 12) / 26));
      const rows = Math.max(1, Math.floor((b.h - 12) / 34));
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const lit = (i * 7 + j * 13 + Math.round(b.w)) % 5 < 3;
          if (!lit) continue;
          if (Math.sin(t * 0.6 + (i * 3 + j) * 1.7) <= -0.85) continue;
          c.fillStyle = `hsla(44, 95%, ${(58 + 14 * Math.sin(i + j + t * 0.3)).toFixed(1)}%, 0.85)`;
          c.fillRect(b.x + 8 + i * 26, H - b.h + 10 + j * 34, 8, 12);
        }
      }
    }
  };
  drawRow(parts.back, "hsl(232, 28%, 15%)");
  drawRow(parts.front, "hsl(234, 30%, 9%)");

  const glow = c.createLinearGradient(0, H * 0.55, 0, H);
  glow.addColorStop(0, "hsla(30, 90%, 60%, 0)");
  glow.addColorStop(1, "hsla(30, 90%, 55%, 0.18)");
  c.fillStyle = glow;
  c.fillRect(0, H * 0.55, W, H * 0.45);

  const tallest = (parts.front || []).reduce((mx, b) => (b.h > mx.h ? b : mx), { h: 0 });
  if (tallest.h > 0) {
    const bx = tallest.x + tallest.w / 2;
    const by = H - tallest.h - 10;
    c.fillStyle = `hsla(0, 90%, 60%, ${(0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 3.2))).toFixed(3)})`;
    c.beginPath();
    c.arc(bx, by, 3.5, 0, Math.PI * 2);
    c.fill();
  }
}

function fxAbstract(c, sc, t, p, parts, hue) {
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue}, 55%, ${Math.round(13 + 6 * p)}%)`);
  g.addColorStop(1, `hsl(${(hue + 70) % 360}, 55%, 8%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  c.save();
  c.globalCompositeOperation = "lighter";
  for (const o of parts.orbs || []) {
    const x = o.cx + Math.sin(t * o.sx + o.ph) * W * 0.22;
    const y = o.cy + Math.cos(t * o.sy + o.ph * 2) * H * 0.18;
    const rg = c.createRadialGradient(x, y, 10, x, y, o.r);
    rg.addColorStop(0, `hsla(${(hue + o.hueOff + 360) % 360}, 85%, 62%, 0.4)`);
    rg.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    c.fillStyle = rg;
    c.beginPath();
    c.arc(x, y, o.r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();

  c.strokeStyle = `hsla(${(hue + 40) % 360}, 60%, 70%, 0.12)`;
  c.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    for (let x = 0; x <= W; x += 20) {
      const y = H * (0.25 + i * 0.13) + 26 * Math.sin(x / 150 + t * 0.6 + i);
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
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
  textLabel.textContent = "Passage du script";
  const textarea = document.createElement("textarea");
  textarea.rows = 4;
  textarea.value = sc.text;
  textarea.oninput = () => { sc.text = textarea.value; refreshSceneCardText(); };
  textLabel.appendChild(textarea);
  textGroup.appendChild(textLabel);
  box.appendChild(textGroup);

  const isAnim = sc.fxTheme !== undefined || sc.prompt !== undefined;
  if (isAnim) {
    const promptGroup = document.createElement("div");
    promptGroup.className = "prop-group";
    const promptLabel = document.createElement("label");
    promptLabel.textContent = "Description visuelle / Prompt de génération";
    const promptTa = document.createElement("textarea");
    promptTa.rows = 3;
    promptTa.placeholder = "Ex. : coucher de soleil sur l'océan, vagues lentes";
    promptTa.value = sc.prompt || "";
    const themeHint = document.createElement("p");
    themeHint.className = "hint";
    themeHint.textContent = `Thème détecté : ${THEME_LABELS[sc.fxTheme] || sc.fxTheme}`;
    promptTa.oninput = () => {
      sc.prompt = promptTa.value;
      sc.hue = hueFor(sc.prompt || sc.text);
      sc.fxTheme = detectTheme(sc.prompt || sc.text);
      sc.fxParts = null;
      themeHint.textContent = `Thème détecté : ${THEME_LABELS[sc.fxTheme] || sc.fxTheme}`;
      previewCurrentSceneFrame();
    };
    promptTa.onblur = () => renderTimeline();
    promptLabel.appendChild(promptTa);
    promptGroup.appendChild(promptLabel);
    box.appendChild(promptGroup);

    const shotLabel = document.createElement("label");
    shotLabel.textContent = "Type de plan";
    const shotSel = document.createElement("select");
    SHOT_TYPES.forEach(([val, lab]) => {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = lab;
      if ((sc.shot || "auto") === val) o.selected = true;
      shotSel.appendChild(o);
    });
    shotSel.onchange = () => {
      sc.shot = shotSel.value;
      previewCurrentSceneFrame();
    };
    shotLabel.appendChild(shotSel);
    box.appendChild(shotLabel);

    box.appendChild(themeHint);
  }

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

  const shot = computeShotTransform(sc, progress);
  c.save();
  if (shot.scale !== 1 || shot.dx !== 0 || shot.dy !== 0) {
    c.translate(W / 2 + shot.dx, H / 2 + shot.dy);
    c.scale(shot.scale, shot.scale);
    c.translate(-W / 2, -H / 2);
  }

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
  } else if (sc.fxTheme) {
    animateFx(c, sc, localMs);
  } else if (sc.hue !== undefined) {
    drawGradientScene(c, sc, localMs);
  }
  c.restore();

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

const APP_VERSION = "7";

window.addEventListener("beforeunload", () => { if ("speechSynthesis" in window) synth.cancel(); });
document.fonts?.ready.then(() => previewCurrentSceneFrame());
previewCurrentSceneFrame();

window.addEventListener("error", (e) => {
  const el = document.getElementById("diag");
  if (!el) return;
  el.classList.remove("hidden", "faded");
  el.classList.add("diag-error");
  el.textContent = "⚠ Erreur : " + (e.message || "inconnue");
});

(function selfCheck() {
  const el = document.getElementById("diag");
  if (!el) return;
  el.classList.remove("hidden");
  el.textContent = `✓ Moteur chargé v${APP_VERSION} · canvas ${canvas.width}×${canvas.height}`;
  setTimeout(() => el.classList.add("faded"), 8000);
})();
