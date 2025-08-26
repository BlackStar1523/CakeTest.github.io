/* ======= Cake Feedback – main.js (Propre + Diagnostics) ======= */
/* Test
/* === 0) CONFIG + ENV/DEBUG === */
if (!window.CONFIG) {
  console.error("config.js introuvable ou chargé après main.js");
  window.CONFIG = {}; // évite un crash dur si l'ordre est mauvais
}
const CONFIG = Object.freeze({ ...(window.CONFIG) });
const DEBUG  = (CONFIG.ENV === "TEST");

/* === 1) HELPERS GÉNÉRAUX + DIAGNOSTIC === */
const $      = (sel, root = document) => root.querySelector(sel);
const now    = () => new Date().toISOString().split("T")[1].replace("Z", "");
const diagEl = () => document.getElementById("diag");

function diag(step, data) {
  if (!DEBUG) return; // rien en PROD
  const line = `[${now()}] ${step} ${data ? JSON.stringify(data, null, 2) : ""}`;
  const el = diagEl();
  if (el) el.textContent += line + "\n";
  console.log("[DIAG]", step, data ?? "");
}

function toast(msg) { alert(msg); }
function fail(code, msg, extra = {}) {
  const err = new Error(msg || code); err.code = code; Object.assign(err, extra); return err;
}
function toQuery(params) { return new URLSearchParams(params).toString(); }

async function postJSON(url, data) {
  diag("HTTP:POST", { url, data });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // évite preflight CORS
    body: JSON.stringify(data),
  });
  let json; try { json = await res.json(); } catch { json = { ok:false, error:"Réponse non-JSON", status:res.status }; }
  diag("HTTP:POST:RESP", json);
  return json;
}
async function getJSON(url) {
  diag("HTTP:GET", { url });
  const res = await fetch(url);
  let json; try { json = await res.json(); } catch { json = { ok:false, error:"Réponse non-JSON", status:res.status }; }
  diag("HTTP:GET:RESP", json);
  return json;
}

/* === 2) NOTES /10 AVEC DEMI-POINTS === */
function normalizeDecimal(str){ return String(str).replace(",", "."); }
function roundToHalf(n){ return Math.round(n * 2) / 2; }
function parseNote10(value){
  const n = parseFloat(normalizeDecimal(value));
  if (!isFinite(n)) return NaN;
  return roundToHalf(Math.min(10, Math.max(0, n)));
}
function computeOverall10({ taste, texture, pairing, visuel }){
  const vals = [taste, texture, pairing, visuel].filter((x)=>isFinite(x));
  if (vals.length !== 4) return NaN;
  return roundToHalf(vals.reduce((a,b)=>a+b,0)/4);
}

/* === 3) UPLOAD PHOTO (Cloudinary unsigned) === */
async function loadImageFile(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function compressImage(file, maxSide = CONFIG.MAX_IMG){
  const img = await loadImageFile(file);
  const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1);
  const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res)=>canvas.toBlob(res, "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

async function uploadToCloudinary(file){
  // 0) vérif config
  if (!CONFIG.CLOUDINARY_CLOUD_NAME) throw fail("CONFIG_MISSING", "Cloud name manquant");
  if (!CONFIG.CLOUDINARY_UPLOAD_PRESET) throw fail("CONFIG_MISSING", "Upload preset manquant");
  diag("CLD:START", { file: file?.name, size: file?.size });

  // 1) compression
  let compressed;
  try {
    compressed = await compressImage(file, CONFIG.MAX_IMG);
    diag("CLD:COMPRESSED", { name: compressed.name, size: compressed.size });
  } catch(e){
    diag("CLD:COMPRESS_FAIL", { message: e.message });
    throw fail("COMPRESS_FAIL", "Échec compression image", { original:e });
  }

  // 2) form + fetch (timeout)
  const form = new FormData();
  form.append("file", compressed);
  form.append("upload_preset", CONFIG.CLOUDINARY_UPLOAD_PRESET);

  const url = `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const ac = new AbortController(); const t = setTimeout(()=>ac.abort(), 30000);
  let res, data;
  try {
    diag("CLD:REQUEST", { url });
    res = await fetch(url, { method:"POST", body: form, signal: ac.signal });
    clearTimeout(t);
  } catch(e){
    clearTimeout(t);
    if (e.name === "AbortError") { diag("CLD:TIMEOUT"); throw fail("NETWORK_TIMEOUT","Upload expiré"); }
    diag("CLD:NETWORK_FAIL", { message: e.message });
    throw fail("NETWORK_FAIL","Échec réseau Cloudinary",{ original:e });
  }

  try { data = await res.json(); } catch { data = { error:"Réponse non-JSON" }; }
  diag("CLD:RESPONSE", { status: res.status, ok: res.ok, body: data });

  if (!res.ok || !data.secure_url){
    const hint =
      res.status === 401 ? "401 Unauthorized → preset non 'Unsigned' ou cloud name invalide."
    : res.status === 400 && /upload_preset/i.test(JSON.stringify(data)) ? "Preset introuvable (typo) ou désactivé."
    : res.status === 400 && /Missing required parameter - file/i.test(JSON.stringify(data)) ? "Paramètre 'file' manquant."
    : "Voir 'body' ci-dessus.";
    throw fail("CLOUDINARY_ERROR","Upload Cloudinary échoué",{ httpStatus:res.status, body:data, hint });
  }

  diag("CLD:SUCCESS", { url: data.secure_url, public_id: data.public_id });
  return data.secure_url;
}

/* === 4) CRÉATION GÂTEAU (add-cake.html) === */
async function handleAddCakeSubmit(e){
  e.preventDefault();
  const title = $("#title").value.trim();
  const dateReal = $("#dateReal").value;
  const file = $("#photo").files[0];
  if (!title || !dateReal || !file){ toast("Titre, date et photo requis."); return; }

  try {
    diag("ADD_CAKE:BEGIN", { title, dateReal });

    // 1) upload
    const photoUrl = await uploadToCloudinary(file);

    // 2) enregistrement Apps Script
    const res = await postJSON(`${CONFIG.API_URL}?action=createCake`, {
      title, photoUrl, dateRealisation: dateReal
    });
    if (!res.ok) throw fail("APPS_SCRIPT_ERROR", res.error || "createCake a échoué");
    diag("ADD_CAKE:CREATED", res);

    // 3) lien public feedback
    const feedbackUrl = new URL(location.origin + location.pathname);
    feedbackUrl.pathname = feedbackUrl.pathname.replace(/[^/]*$/, "") + "feedback.html";
    feedbackUrl.search = "?cakeId=" + encodeURIComponent(res.cakeId);

    const a = $("#publicLink");
    if (a){ a.href = feedbackUrl.toString(); a.textContent = feedbackUrl.toString(); a.target = "_blank"; }
    diag("ADD_CAKE:SUCCESS", { link: a?.href });

    toast("Gâteau créé. Lien prêt à partager !");
  } catch(err){
    diag("ADD_CAKE:ERROR", { code: err.code, message: err.message, hint: err.hint, extra: { status: err.httpStatus, body: err.body } });
    alert(
      `Erreur lors de la création.\n` +
      (err.code ? `Code: ${err.code}\n`:"") +
      (err.hint ? `Piste: ${err.hint}\n`:"") +
      (err.message || "")
    );
  }
}

/* === 5) FEEDBACK TESTEUR (feedback.html) === */
function getCakeIdFromURL(){ return new URL(location.href).searchParams.get("cakeId") || ""; }

async function loadCakeHeader(){
  const cakeId = $("#cakeId")?.value || getCakeIdFromURL();
  if (!cakeId) return;
  try{
    const { ok, ...data } = await getJSON(`${CONFIG.API_URL}?action=getCake&cakeId=${encodeURIComponent(cakeId)}`);
    if (!ok) return;
    $("#cakeTitle") && ($("#cakeTitle").textContent = data.title || "Gâteau");
    if ($("#cakePhoto") && data.photoUrl){ $("#cakePhoto").src = data.photoUrl; $("#cakePhoto").style.display = "block"; }
  }catch(e){ console.warn("getCake failed", e); }
}

async function handleFeedbackSubmit(e){
  e.preventDefault();
  const cakeId = $("#cakeId") ? $("#cakeId").value : getCakeIdFromURL();
  if (!cakeId){ toast("Lien invalide : cakeId manquant."); return; }
  const taster = $("#taster") ? $("#taster").value.trim() : "";

  const ratings = {
    taste: parseNote10($("#taste").value),
    texture: parseNote10($("#texture").value),
    pairing: parseNote10($("#pairing").value),
    visuel: parseNote10($("#visuel").value),
  };
  if (Object.values(ratings).some(v=>!isFinite(v))){
    toast("Merci de saisir des notes valides (0 à 10, pas de 0,5).");
    return;
  }

  const overall = computeOverall10(ratings);
  if (!isFinite(overall)){ toast("Impossible de calculer la note globale."); return; }
  if ($("#overall")) $("#overall").value = String(overall);

  const flags = Array.from(document.querySelectorAll('input[name="flag"]:checked')).map(el=>el.value);
  const comments = $("#comments") ? $("#comments").value : "";
  const submittedAt = new Date().toISOString();

  try{
    const res = await postJSON(`${CONFIG.API_URL}?action=addResponse`, {
      cakeId, taster, ratings:{...ratings, overall}, flags, comments, submittedAt
    });
    if (!res.ok) throw new Error(res.error || "addResponse a échoué");

    toast("Merci ! Votre avis a été enregistré.");
    $("#formFeedback").reset(); if ($("#overall")) $("#overall").value = "";
  }catch(err){ console.error(err); toast("Erreur : envoi impossible."); }
}

function wireLiveOverall(){
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
  fields.forEach(sel => { const el = $(sel); if (el) ["input","change","blur"].forEach(ev=>el.addEventListener(ev, recalc)); });
}

/* === 6) TABLE, MOYENNES & GRAPHIQUES (dashboard) === */
function moyenne(nums){ const arr = nums.filter(n=>Number.isFinite(n)); return arr.length? Math.round((arr.reduce((a,b)=>a+b,0)/arr.length)*100)/100 : 0; }
function setText(id, value){ const el = $(id); if (el) el.textContent = String(value); }
function renderResponsesTable(items){
  const tb = $("#responsesTbody"); if (!tb) return; tb.innerHTML = "";
  for (const it of (items||[])){
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
      <td>${it.submittedAt || ""}</td>`;
    tb.appendChild(tr);
  }
}

let charts = { avg:null, hist:null, flags:null };
function destroyCharts(){ Object.values(charts).forEach(ch => { if (ch && ch.destroy) ch.destroy(); }); charts = { avg:null, hist:null, flags:null }; }
function buildCharts(items){
  if (!items || !items.length || !window.Chart){ destroyCharts(); return; }
  const t = (k)=>items.map(it=>Number(it.ratings[k])||0);
  const avgTaste = moyenne(t("taste")), avgTexture = moyenne(t("texture")), avgPairing = moyenne(t("pairing")), avgVisuel = moyenne(t("visuel")), avgOverall = moyenne(t("overall"));

  const ctxAvg = document.getElementById("chartAverages")?.getContext("2d");
  if (ctxAvg){ charts.avg?.destroy?.(); charts.avg = new Chart(ctxAvg, {
      type:"bar",
      data:{ labels:["Goût","Texture","Garniture","Visuel","Globale"], datasets:[{ label:"Moyenne /10", data:[avgTaste,avgTexture,avgPairing,avgVisuel,avgOverall] }] },
      options:{ responsive:true, scales:{ y:{ beginAtZero:true, max:10 } } }
  });}

  const overalls = t("overall"), edges = Array.from({length:21}, (_,i)=>i*0.5), counts = edges.map(()=>0);
  overalls.forEach(v=>{ if (Number.isFinite(v)){ const idx = Math.round(v*2); counts[idx] = (counts[idx]||0)+1; }});
  const ctxHist = document.getElementById("chartHistogram")?.getContext("2d");
  if (ctxHist){ charts.hist?.destroy?.(); charts.hist = new Chart(ctxHist,{
      type:"bar",
      data:{ labels: edges.map(e=>e.toFixed(1)), datasets:[{ label:"Nombre de réponses", data:counts }]},
      options:{ responsive:true, plugins:{ legend:{ display:false }}, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
  });}

  const flagCounts = {}; items.forEach(it => (it.flags||[]).forEach(f => { if (f) flagCounts[f]=(flagCounts[f]||0)+1; }));
  const ctxFlags = document.getElementById("chartFlags")?.getContext("2d");
  if (ctxFlags){ charts.flags?.destroy?.(); charts.flags = new Chart(ctxFlags,{
      type:"bar",
      data:{ labels:Object.keys(flagCounts), datasets:[{ label:"Occurrences", data:Object.values(flagCounts) }]},
      options:{ responsive:true, plugins:{ legend:{ display:false }}, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
  });}
}

/* === 7) LISTE DES GÂTEAUX & PARTAGE (dashboard) === */
function buildFeedbackUrl(cakeId){
  const u = new URL(location.href);
  u.pathname = u.pathname.replace(/[^/]*$/, "") + "feedback.html";
  u.search = "?" + toQuery({ cakeId });
  return u.toString();
}
async function showShareBox(cakeId){
  const box = $("#shareBox"), a = $("#publicLinkDash"); if (!box || !a) return;
  const link = buildFeedbackUrl(cakeId);
  a.href = link; a.textContent = link; box.style.display = "block";
  if (window.QRCode && $("#qrDash")){ $("#qrDash").innerHTML = ""; new QRCode($("#qrDash"), { text:link, width:160, height:160 }); }
  $("#btnCopyLink")?.addEventListener("click", async ()=>{ try{ await navigator.clipboard.writeText(link); toast("Lien copié !"); }catch{ toast("Impossible de copier."); }});
  $("#btnWhatsApp")?.addEventListener("click", ()=>{ const txt = encodeURIComponent("Donne ton avis sur ce gâteau : " + link); window.open(`https://wa.me/?text=${txt}`, "_blank", "noopener"); });
}
async function fetchCakes({ q="", status="all" } = {}){
  const { ok, items, error } = await getJSON(`${CONFIG.API_URL}?action=listCakes&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  if (!ok){ toast("Erreur chargement des gâteaux : " + (error || "inconnue")); return []; }
  return items || [];
}
function populateCakeSelect(items){
  const sel = $("#cakeSelect"); if (!sel) return;
  sel.innerHTML = `<option value="">— Sélectionner un gâteau —</option>`;
  items.forEach(it => {
    const opt = document.createElement("option");
    const dateTxt = it.dateRealisation ? ` (${it.dateRealisation})` : "";
    opt.value = it.id; opt.textContent = `${it.title}${dateTxt}`;
    sel.appendChild(opt);
  });
  if ($("#shareBox")) $("#shareBox").style.display = "none";
}
async function refreshCakeList(){
  const q = $("#searchCake")?.value?.trim() || "";
  populateCakeSelect(await fetchCakes({ q, status:"all" }));
}

/* === 8) CHARGEMENT DASHBOARD === */
async function loadDashboard(){
  const cakeId = $("#cakeSelect")?.value?.trim() || $("#cakeIdDash")?.value?.trim() || "";
  if (!cakeId){ toast("Choisis un gâteau dans la liste."); return; }
  const { ok, items, error } = await getJSON(`${CONFIG.API_URL}?action=listResponses&cakeId=${encodeURIComponent(cakeId)}`);
  if (!ok){ toast("Erreur chargement : " + (error || "inconnue")); return; }
  renderResponsesTable(items || []);
  const t = (k)=>(items||[]).map(it=>Number(it.ratings[k])||0);
  const avgTaste=moyenne(t("taste")), avgTexture=moyenne(t("texture")), avgPairing=moyenne(t("pairing")), avgVisuel=moyenne(t("visuel")), avgOverall=moyenne(t("overall"));
  setText("#avgTaste", avgTaste); setText("#avgTexture", avgTexture); setText("#avgPairing", avgPairing); setText("#avgVisuel", avgVisuel);
  setText("#avgGlobal", moyenne([avgTaste,avgTexture,avgPairing,avgVisuel,avgOverall]));
  destroyCharts(); buildCharts(items);
  await showShareBox(cakeId);
}
function exportCSV(){
  const cakeId = $("#cakeSelect")?.value?.trim() || $("#cakeIdDash")?.value?.trim() || "";
  if (!cakeId){ toast("Choisis un gâteau d’abord."); return; }
  window.location.href = `${CONFIG.API_URL}?action=exportCsv&cakeId=${encodeURIComponent(cakeId)}`;
}

/* === 9) BOOTSTRAP PAR PAGE === */
document.addEventListener("DOMContentLoaded", () => {
  // add-cake.html
  if ($("#formAddCake")){
    $("#formAddCake").addEventListener("submit", handleAddCakeSubmit);
    const input = $("#photo"), prev = $("#preview");
    if (input && prev){ input.addEventListener("change", ()=>{ const f = input.files?.[0]; if (f) prev.src = URL.createObjectURL(f); }); }
  }
  // feedback.html
  if ($("#formFeedback")){
    if ($("#cakeId") && !$("#cakeId").value){ const id = getCakeIdFromURL(); if (id) $("#cakeId").value = id; }
    loadCakeHeader();
    wireLiveOverall();
    $("#formFeedback").addEventListener("submit", handleFeedbackSubmit);
  }
  // dashboard.html
  if ($("#cakeIdDash") || $("#cakeSelect")){
    $("#btnLoad")?.addEventListener("click", loadDashboard);
    $("#btnExport")?.addEventListener("click", exportCSV);
    if ($("#cakeSelect")){
      refreshCakeList();
      $("#searchCake")?.addEventListener("input", ()=>{ clearTimeout(window.__cakeSearchT); window.__cakeSearchT = setTimeout(refreshCakeList, 250); });
      $("#cakeSelect")?.addEventListener("change", ()=>{ const id = $("#cakeSelect").value; if (id) showShareBox(id); else $("#shareBox") && ($("#shareBox").style.display="none"); });
    }
  }
});


