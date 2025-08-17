/* ======= Cake Feedback – main.js (MVP) ======= */

/* === 0) CONFIG === */
const CONFIG = {
  API_URL:
    "https://script.google.com/macros/s/AKfycbw6qu6FrM57cTXG0OyRiuWN4iuQ7km98h6QxKTy5-3hlPE952y371FVMwWxUc168nWf/exec",
  // Photo temporaire, le temps de valider le flux (MVP sans upload)
  SAMPLE_PHOTO_URL:
    "https://res.cloudinary.com/dk0ioppgv/image/upload/v1755266890/cld-sample-4.jpg",
};

/* === 1) HELPERS === */
const $ = (sel, root = document) => root.querySelector(sel);

function toQuery(params) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

// POST en text/plain pour éviter le preflight CORS avec Apps Script
async function postJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  return json;
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
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
async function handleAddCakeSubmit(e) {
  e.preventDefault();
  const title = $("#title").value.trim();
  const dateReal = $("#dateReal").value;
  if (!title || !dateReal) {
    toast("Titre et date sont obligatoires.");
    return;
  }
  try {
    const photoUrl = CONFIG.SAMPLE_PHOTO_URL; // pas d'upload pour le MVP
    const url = `${CONFIG.API_URL}?action=createCake`;
    const res = await postJSON(url, { title, photoUrl, dateRealisation: dateReal });
    if (!res.ok) throw new Error(res.error || "createCake a échoué");

    // Construire l'URL publique vers feedback.html
    const feedbackUrl = new URL(location.origin + location.pathname);
    feedbackUrl.pathname =
      feedbackUrl.pathname.replace(/[^/]*$/, "") + "feedback.html";
    feedbackUrl.search = "?" + toQuery({ cakeId: res.cakeId, t: Date.now() });

    const a = $("#publicLink");
    if (a) {
      a.href = feedbackUrl.toString();
      a.textContent = feedbackUrl.toString();
      a.target = "_blank";
      a.rel = "noopener";
    }
    toast("Gâteau créé. Lien prêt à partager !");
    if (window.QRCode && $("#qr")) {
      $("#qr").innerHTML = "";
      new QRCode($("#qr"), {
        text: feedbackUrl.toString(),
        width: 160,
        height: 160,
      });
    }
  } catch (err) {
    console.error(err);
    toast("Erreur lors de la création du gâteau.");
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
  }

  // === feedback.html ===
  if ($("#formFeedback")) {
    if ($("#cakeId") && !$("#cakeId").value) {
      const id = getCakeIdFromURL();
      if (id) $("#cakeId").value = id;
    }
    wireLiveOverall(); // calcule la note globale automatiquement
    $("#formFeedback").addEventListener("submit", handleFeedbackSubmit);
  }

  // === dashboard.html ===
  if ($("#cakeIdDash")) {
    $("#btnLoad")?.addEventListener("click", loadDashboard);
    $("#btnExport")?.addEventListener("click", exportCSV);
  }

  // === dashboard.html (nouvelle UI avec liste) ===
  if ($("#cakeSelect")) {
    // 1) Charger la liste au démarrage
    refreshCakeList();

    // 2) Filtre avec petit debounce
    $("#searchCake")?.addEventListener("input", () => {
      clearTimeout(window.__cakeSearchT);
      window.__cakeSearchT = setTimeout(refreshCakeList, 250);
    });

    // 3) Boutons
    $("#btnRefreshCakes")?.addEventListener("click", refreshCakeList);
    $("#btnLoad")?.addEventListener("click", loadDashboard);
    $("#btnExport")?.addEventListener("click", exportCSV);

    // 4) Changement de gâteau → afficher lien public
    $("#cakeSelect")?.addEventListener("change", () => {
      const id = $("#cakeSelect").value;
      if (id) {
        showShareBox(id);
      } else if ($("#shareBox")) {
        $("#shareBox").style.display = "none";
      }
    });
  }
});

