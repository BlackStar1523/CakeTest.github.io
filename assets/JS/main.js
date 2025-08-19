/* ======= Cake Feedback – main.js (MVP) ======= */

/* === 0) CONFIG === */
const CONFIG = {
  API_URL:
    "https://script.google.com/macros/s/AKfycbw6qu6FrM57cTXG0OyRiuWN4iuQ7km98h6QxKTy5-3hlPE952y371FVMwWxUc168nWf/exec",
  
  // Photo temporaire, le temps de valider le flux (MVP sans upload)
  SAMPLE_PHOTO_URL:
    "https://res.cloudinary.com/dk0ioppgv/image/upload/v1755266890/cld-sample-4.jpg",
};
const DEBUG = true;
const log = (...args) => { if (DEBUG) console.log("[CakeDiag]", ...args); };
const showDiag = (o) => { const el = document.getElementById("diag"); if (el) el.textContent += (typeof o==='string'?o:JSON.stringify(o,null,2)) + "\n"; };

/* === 1) HELPERS === */
const $ = (sel, root = document) => root.querySelector(sel);
const CLOUD_NAME = "dk0ioppgv";   // <- ton cloud name
const UPLOAD_PRESET = "Cake Test"; // <- le preset que tu as créé


function toQuery(params) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

// POST en text/plain pour éviter le preflight CORS avec Apps Script
async function postJSON(url, data) {
  log("POST", url, data);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(data),
  });
  let json = null;
  try { json = await res.json(); } catch { json = { ok:false, error:"Réponse non-JSON", status:res.status }; }
  log("POST response", json);
  showDiag({ POST:url, response:json });
  return json;
}
async function getJSON(url) {
  log("GET", url);
  const res = await fetch(url);
  let json = null;
  try { json = await res.json(); } catch { json = { ok:false, error:"Réponse non-JSON", status:res.status }; }
  log("GET response", json);
  showDiag({ GET:url, response:json });
  return json;
}

function toast(msg) {
  alert(msg);
}

/* === 2) NOTES /10 AVEC DEMI-POINTS === */
function normalizeDecimal(str) {
  return String(str).replace(",", ".");
}
function roundToHalf(n) {
  return Math.round(n * 2) / 2;
}
function parseNote10(value) {
  const n = parseFloat(normalizeDecimal(value));
  if (!isFinite(n)) return NaN;
  const clamped = Math.min(10, Math.max(0, n));
  return roundToHalf(clamped);
}
function computeOverall10({ taste, texture, pairing, visuel }) {
  const vals = [taste, texture, pairing, visuel].filter((x) => isFinite(x));
  if (vals.length !== 4) return NaN;
  const avg = vals.reduce((a, b) => a + b, 0) / 4;
  return roundToHalf(avg);
}

/* === 3) CRÉATION GÂTEAU (add-cake.html) ===
   IDs requis :
   - #formAddCake, #title, #dateReal
   - #publicLink (affichage du lien)
   - #qr (optionnel si lib qrcodejs)
*/

async function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function compressImage(file, maxSide = CONFIG.MAX_IMG) {
  const img = await loadImageFile(file);
  const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

async function uploadToCloudinary(file) {
  // debug : vérifie qu'on a bien les valeurs
  console.log("[CLD] cloud:", CONFIG.CLOUDINARY_CLOUD_NAME, "preset:", CONFIG.CLOUDINARY_UPLOAD_PRESET);

  // 1) compression
  const compressed = await compressImage(file, CONFIG.MAX_IMG);

  // 2) formulaire d'upload
  const form = new FormData();
  form.append("file", compressed);
  form.append("upload_preset", CONFIG.CLOUDINARY_UPLOAD_PRESET);

  // 3) appel Cloudinary
  const url = `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const res = await fetch(url, { method: "POST", body: form });

  // 4) parse une seule fois (PAS de redeclaration)
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: "Cloudinary non-JSON", status: res.status };
  }
  console.log("[CLD] response:", data);
  if (!data.secure_url) {
    console.error("Cloudinary error:", data);
    throw new Error("Upload Cloudinary échoué" + (data.error ? `: ${data.error.message || data.error}` : ""));
  }

  // 5) URL publique
  return data.secure_url;
}


async function handleAddCakeSubmit(e) {
  e.preventDefault();
  const title = $("#title").value.trim();
  const dateReal = $("#dateReal").value;
  const file = $("#photo")?.files?.[0];

  if (!title || !dateReal || !file) {
    toast("Titre, date et photo sont obligatoires.");
    return;
  }

  try {
  // 1) Upload
  showDiag("== Début upload Cloudinary ==");
  const photoUrl = await uploadToCloudinary(file);
  showDiag("URL photo: " + photoUrl);

  // 2) createCake
  showDiag("== Appel createCake ==");
  const res = await postJSON(`${CONFIG.API_URL}?action=createCake`, {
    title, photoUrl, dateRealisation: dateReal,
  });
  if (!res.ok) {
    throw new Error("createCake a échoué: " + (res.error || "unknown"));
  }

  // 3) Lien feedback
  const feedbackUrl = new URL(location.origin + location.pathname);
  feedbackUrl.pathname = feedbackUrl.pathname.replace(/[^/]*$/, "") + "feedback.html";
  feedbackUrl.search = "?" + toQuery({ cakeId: res.cakeId, t: Date.now() });

  const a = $("#publicLink");
    if (a) { a.href = feedbackUrl.toString(); a.textContent = feedbackUrl.toString(); a.target="_blank"; a.rel="noopener"; }
    toast("Gâteau créé. Lien prêt à partager !");
    showDiag("OK: " + feedbackUrl.toString());
    } catch (err) {
  console.error(err);
  showDiag("ERREUR: " + (err.message || err));
  toast("Erreur lors de la création du gâteau.");
  }

}

async function loadCakeHeader() {
  const cakeId = $("#cakeId")?.value || getCakeIdFromURL();
  if (!cakeId) return;
  try {
    const { ok, ...data } = await getJSON(
      `${CONFIG.API_URL}?action=getCake&cakeId=${encodeURIComponent(cakeId)}`
    );
    if (!ok) return;
    $("#cakeTitle") && ($("#cakeTitle").textContent = data.title || "Gâteau");
    if ($("#cakePhoto") && data.photoUrl) {
      $("#cakePhoto").src = data.photoUrl;
      $("#cakePhoto").style.display = "block";
    }
  } catch (e) {
    console.warn("getCake failed", e);
  }
}


/* === 4) FEEDBACK TESTEUR (feedback.html) === */
function getCakeIdFromURL() {
  const u = new URL(location.href);
  return u.searchParams.get("cakeId") || "";
}

async function handleFeedbackSubmit(e) {
  e.preventDefault();
  const cakeId = $("#cakeId") ? $("#cakeId").value : getCakeIdFromURL();
  if (!cakeId) {
    toast("Lien invalide : cakeId manquant.");
    return;
  }
  const taster = $("#taster") ? $("#taster").value.trim() : "";

  const ratings = {
    taste: parseNote10($("#taste").value),
    texture: parseNote10($("#texture").value),
    pairing: parseNote10($("#pairing").value),
    visuel: parseNote10($("#visuel").value),
  };
  if (Object.values(ratings).some((v) => !isFinite(v))) {
    toast("Merci de saisir des notes valides (0 à 10, pas de 0,5).");
    return;
  }

  const overall = computeOverall10(ratings);
  if (!isFinite(overall)) {
    toast("Impossible de calculer la note globale.");
    return;
  }
  if ($("#overall")) $("#overall").value = String(overall);

  const flags = Array.from(document.querySelectorAll('input[name="flag"]:checked')).map(
    (el) => el.value
  );
  const comments = $("#comments") ? $("#comments").value : "";
  const submittedAt = new Date().toISOString();

  try {
    const url = `${CONFIG.API_URL}?action=addResponse`;
    const res = await postJSON(url, {
      cakeId,
      taster,
      ratings: { ...ratings, overall },
      flags,
      comments,
      submittedAt,
    });
    if (!res.ok) throw new Error(res.error || "addResponse a échoué");

    toast("Merci ! Votre avis a été enregistré.");
    $("#formFeedback").reset();
    if ($("#overall")) $("#overall").value = "";
  } catch (err) {
    console.error(err);
    toast("Erreur : envoi impossible.");
  }
}

// calcul live de la globale
function wireLiveOverall() {
  const fields = ["#taste", "#texture", "#pairing", "#visuel"];
  const recalc = () => {
    const ratings = {
      taste: parseNote10($("#taste")?.value),
      texture: parseNote10($("#texture")?.value),
      pairing: parseNote10($("#pairing")?.value),
      visuel: parseNote10($("#visuel")?.value),
    };
    const overall = computeOverall10(ratings);
    if (isFinite(overall) && $("#overall")) $("#overall").value = String(overall);
  };
  fields.forEach((sel) => {
    const el = $(sel);
    if (el) ["input", "change", "blur"].forEach((ev) => el.addEventListener(ev, recalc));
  });
}

/* === 5) TABLE & MOYENNES (dashboard) === */
function moyenne(nums) {
  const arr = nums.filter((n) => Number.isFinite(n));
  if (!arr.length) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}
function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value);
}
function renderResponsesTable(items) {
  const tb = $("#responsesTbody");
  if (!tb) return;
  tb.innerHTML = "";
  for (const it of (items || [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.taster || ""}</td>
      <td>${it.ratings.taste}</td>
      <td>${it.ratings.texture}</td>
      <td>${it.ratings.pairing}</td>
      <td>${it.ratings.visuel}</td>
      <td>${it.ratings.overall}</td>
      <td>${(it.flags || []).join(", ")}</td>
      <td>${it.comments || ""}</td>
      <td>${it.submittedAt || ""}</td>
    `;
    tb.appendChild(tr);
  }
}

/* === 6) CHARTS (dashboard) === */
let charts = { avg: null, hist: null, flags: null };
function destroyCharts() {
  Object.values(charts).forEach((ch) => { if (ch && ch.destroy) ch.destroy(); });
  charts = { avg: null, hist: null, flags: null };
}
function buildCharts(items) {
  if (!items || !items.length || !window.Chart) {
    destroyCharts();
    return;
  }
  const t = (k) => items.map((it) => Number(it.ratings[k]) || 0);
  const avgTaste = moyenne(t("taste"));
  const avgTexture = moyenne(t("texture"));
  const avgPairing = moyenne(t("pairing"));
  const avgVisuel = moyenne(t("visuel"));
  const avgOverall = moyenne(t("overall"));

  // Moyennes
  const ctxAvg = document.getElementById("chartAverages")?.getContext("2d");
  if (ctxAvg) {
    if (charts.avg) charts.avg.destroy();
    charts.avg = new Chart(ctxAvg, {
      type: "bar",
      data: {
        labels: ["Goût", "Texture", "Garniture", "Visuel", "Globale"],
        datasets: [{ label: "Moyenne /10", data: [avgTaste, avgTexture, avgPairing, avgVisuel, avgOverall] }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true, max: 10 } } }
    });
  }

  // Histogramme des globales (bins de 0.5)
  const overalls = t("overall");
  const edges = Array.from({ length: 21 }, (_, i) => i * 0.5); // 0..10
  const counts = edges.map(() => 0);
  overalls.forEach((v) => {
    if (!Number.isFinite(v)) return;
    const idx = Math.round(v * 2);
    counts[idx] = (counts[idx] || 0) + 1;
  });
  const labelsHist = edges.map((e) => e.toFixed(1));
  const ctxHist = document.getElementById("chartHistogram")?.getContext("2d");
  if (ctxHist) {
    if (charts.hist) charts.hist.destroy();
    charts.hist = new Chart(ctxHist, {
      type: "bar",
      data: { labels: labelsHist, datasets: [{ label: "Nombre de réponses", data: counts }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  // Flags
  const flagCounts = {};
  items.forEach((it) => (it.flags || []).forEach((f) => { if (f) flagCounts[f] = (flagCounts[f] || 0) + 1; }));
  const flagLabels = Object.keys(flagCounts);
  const flagValues = flagLabels.map((k) => flagCounts[k]);
  const ctxFlags = document.getElementById("chartFlags")?.getContext("2d");
  if (ctxFlags) {
    if (charts.flags) charts.flags.destroy();
    charts.flags = new Chart(ctxFlags, {
      type: "bar",
      data: { labels: flagLabels, datasets: [{ label: "Occurences", data: flagValues }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }
}

/* === 7) LISTE DES GÂTEAUX (dashboard) === */

// Construit l'URL vers feedback.html pour un cakeId, robuste sur GitHub Pages
function buildFeedbackUrl(cakeId) {
  const u = new URL(location.href);
  const basePath = u.pathname.replace(/[^/]*$/, "");
  u.pathname = basePath + "feedback.html";
  u.search = "?" + toQuery({ cakeId });
  return u.toString();
}

async function showShareBox(cakeId) {
  const box = $("#shareBox");
  const a = $("#publicLinkDash");
  if (!box || !a) return;

  const link = buildFeedbackUrl(cakeId);
  a.href = link;
  a.textContent = link;
  box.style.display = "block";

  // (debug visuel)
  console.log("Lien public généré:", link);

  if (window.QRCode && $("#qrDash")) {
    $("#qrDash").innerHTML = "";
    new QRCode($("#qrDash"), { text: link, width: 160, height: 160 });
  }

  $("#btnCopyLink")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Lien copié !");
    } catch {
      toast("Impossible de copier. Sélectionne et copie manuellement.");
    }
  });

  $("#btnWhatsApp")?.addEventListener("click", () => {
    const txt = encodeURIComponent("Donne ton avis sur ce gâteau : " + link);
    window.open(`https://wa.me/?text=${txt}`, "_blank", "noopener");
  });
}


async function fetchCakes({ q = "", status = "all" } = {}) {
  const url = `${CONFIG.API_URL}?action=listCakes&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`;
  const { ok, items, error } = await getJSON(url);
  if (!ok) {
    toast("Erreur chargement des gâteaux : " + (error || "inconnue"));
    return [];
  }
  return items || [];
}
function populateCakeSelect(items) {
  const sel = $("#cakeSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Sélectionner un gâteau —</option>`;
  items.forEach((it) => {
    const opt = document.createElement("option");
    const dateTxt = it.dateRealisation ? ` (${it.dateRealisation})` : "";
    opt.value = it.id;                       // <-- la valeur est l'ID
    opt.textContent = `${it.title}${dateTxt}`; // <-- le texte montre titre + date
    sel.appendChild(opt);
  });
  // ne rien afficher si aucun gâteau choisi
  if ($("#shareBox")) $("#shareBox").style.display = "none";
}

async function refreshCakeList() {
  const q = $("#searchCake")?.value?.trim() || "";
  const items = await fetchCakes({ q, status: "all" });
  populateCakeSelect(items);
}

/* === 8) CHARGEMENT DASHBOARD === */
async function loadDashboard() {
  const cakeId =
    $("#cakeSelect")?.value?.trim() ||
    $("#cakeIdDash")?.value?.trim() || ""; // compat ancien champ
  if (!cakeId) {
    toast("Choisis un gâteau dans la liste.");
    return;
  }
  const url = `${CONFIG.API_URL}?action=listResponses&cakeId=${encodeURIComponent(cakeId)}`;
  const { ok, items, error } = await getJSON(url);
  if (!ok) {
    toast("Erreur chargement : " + (error || "inconnue"));
    return;
  }
  renderResponsesTable(items || []);
  const t = (k) => (items || []).map((it) => Number(it.ratings[k]) || 0);
  const avgTaste = moyenne(t("taste"));
  const avgTexture = moyenne(t("texture"));
  const avgPairing = moyenne(t("pairing"));
  const avgVisuel = moyenne(t("visuel"));
  const avgOverall = moyenne(t("overall"));

  setText("#avgTaste", avgTaste);
  setText("#avgTexture", avgTexture);
  setText("#avgPairing", avgPairing);
  setText("#avgVisuel", avgVisuel);
  setText("#avgGlobal", moyenne([avgTaste, avgTexture, avgPairing, avgVisuel, avgOverall]));

  destroyCharts();
  buildCharts(items);

  // >>> NOUVEAU : afficher le lien public + QR + partage
  await showShareBox(cakeId);
}

function exportCSV() {
  const cakeId =
    $("#cakeSelect")?.value?.trim() ||
    $("#cakeIdDash")?.value?.trim() || "";
  if (!cakeId) {
    toast("Choisis un gâteau d’abord.");
    return;
  }
  const url = `${CONFIG.API_URL}?action=exportCsv&cakeId=${encodeURIComponent(cakeId)}`;
  window.location.href = url;
}

/* === 9) BOOTSTRAP PAR PAGE === */
document.addEventListener("DOMContentLoaded", () => {
  // === add-cake.html ===
  if ($("#formAddCake")) {
    $("#formAddCake").addEventListener("submit", handleAddCakeSubmit);

    // aperçu photo avant upload
    const input = $("#photo"), prev = $("#preview");
    if (input && prev) {
      input.addEventListener("change", () => {
        const f = input.files?.[0];
        if (f) prev.src = URL.createObjectURL(f);
      });
    }
  }

  // === feedback.html ===
  if ($("#formFeedback")) {
    if ($("#cakeId") && !$("#cakeId").value) {
      const id = getCakeIdFromURL();
      if (id) $("#cakeId").value = id;
    }

    loadCakeHeader(); // <- affiche titre + photo
    wireLiveOverall();
    $("#formFeedback").addEventListener("submit", handleFeedbackSubmit);
  }

  // === dashboard.html ===
  if ($("#cakeIdDash") || $("#cakeSelect")) {
    $("#btnLoad") && $("#btnLoad").addEventListener("click", loadDashboard);
    $("#btnExport") && $("#btnExport").addEventListener("click", exportCSV);

    // si on a la liste des gâteaux avec recherche
    if ($("#cakeSelect")) {
      refreshCakeList();
      $("#searchCake")?.addEventListener("input", () => {
        clearTimeout(window.__cakeSearchT);
        window.__cakeSearchT = setTimeout(refreshCakeList, 250);
      });
      $("#cakeSelect")?.addEventListener("change", () => {
        const id = $("#cakeSelect").value;
        if (id) showShareBox(id);
      });
    }
  }
});

