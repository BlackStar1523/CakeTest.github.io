/* ======= Cake Feedback – main.js (Phase 1 – MVP, SANS Cloudinary) ======= */

/* === 0) CONFIG === */
const CONFIG = {
  API_URL:
    "https://script.google.com/macros/s/AKfycbw6qu6FrM57cTXG0OyRiuWN4iuQ7km98h6QxKTy5-3hlPE952y371FVMwWxUc168nWf/exec",
  // URL de photo de test (temporaire, le temps de valider le flux)
  SAMPLE_PHOTO_URL:
    "https://res.cloudinary.com/dk0ioppgv/image/upload/v1755266890/cld-sample-4.jpg",
};

/* === 1) HELPERS === */
const $ = (sel, root = document) => root.querySelector(sel);

function toQuery(params) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

/*
async function postJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // si souci CORS: mets "text/plain"
    body: JSON.stringify(data),
  });
  return res.json();
}*/

async function postJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // <-- au lieu de application/json
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  console.log("createCake response:", json);
  return json;
}


async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function toast(msg) {
  alert(msg); // simple pour MVP
}

/* === 2) CRÉATION GÂTEAU (add-cake.html) ===
   IDs requis dans la page :
   - #formAddCake
   - #title (text)
   - #dateReal (date)
   - #publicLink (a)
   - #qr (div/canvas) [si tu ajoutes qrcode.js, sinon ignorer]
*/
async function handleAddCakeSubmit(e) {
  e.preventDefault();
  const title = $("#title").value.trim();
  const dateReal = $("#dateReal").value; // YYYY-MM-DD
  if (!title || !dateReal) {
    toast("Titre et date sont obligatoires.");
    return;
  }

  try {
    // Pas d'upload d'image pour ce test : on envoie une URL de photo de test
    const photoUrl = CONFIG.SAMPLE_PHOTO_URL;

    // createCake → Apps Script
    const url = `${CONFIG.API_URL}?action=createCake`;
    const res = await postJSON(url, {
      title,
      photoUrl,
      dateRealisation: dateReal,
    });
    if (!res.ok) throw new Error(res.error || "createCake a échoué");

    // Construire lien de feedback à partager
    const feedbackUrl = new URL(location.origin + location.pathname);
    feedbackUrl.pathname =
      feedbackUrl.pathname.replace(/[^/]*$/, "") + "feedback.html";
    feedbackUrl.search = "?" + toQuery({ cakeId: res.cakeId, t: Date.now() });

    // Afficher lien
    const a = $("#publicLink");
    if (a) {
      a.href = feedbackUrl.toString();
      a.textContent = feedbackUrl.toString();
      a.target = "_blank";
    }

    toast("Gâteau créé. Lien prêt à partager !");
    // QR (si tu inclus qrcodejs dans la page)
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

/* === 3) FORMULAIRE TESTEUR (feedback.html) ===
   IDs requis :
   - #formFeedback
   - #cakeId (hidden)  [ou récup via URL ?cakeId=...]
   - #taster (text, optionnel)
   - Notes: #taste, #texture, #pairing, #visuel, #overall  (inputs type=number 1..5)
   - Cases (flags) avec name="flag" (plusieurs checkbox)
   - #comments (textarea)
*/
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

  // Notes (1..5)
  const ratings = {
    taste: parseInt($("#taste").value, 10),
    texture: parseInt($("#texture").value, 10),
    pairing: parseInt($("#pairing").value, 10),
    visuel: parseInt($("#visuel").value, 10),
    overall: parseInt($("#overall").value, 10),
  };

  // Flags
  const flags = Array.from(
    document.querySelectorAll('input[name="flag"]:checked')
  ).map((el) => el.value);

  const comments = $("#comments") ? $("#comments").value : "";
  const submittedAt = new Date().toISOString();

  try {
    const url = `${CONFIG.API_URL}?action=addResponse`;
    const res = await postJSON(url, {
      cakeId,
      taster,
      ratings,
      flags,
      comments,
      submittedAt,
    });
    if (!res.ok) throw new Error(res.error || "addResponse a échoué");

    toast("Merci ! Votre avis a été enregistré.");
    $("#formFeedback").reset();
  } catch (err) {
    console.error(err);
    toast("Erreur : envoi impossible.");
  }
}

/* === 4) DASHBOARD (dashboard.html) ===
   IDs requis :
   - #cakeIdDash (input texte du cakeId ou select)
   - #btnLoad (bouton charger)
   - #avgGlobal, #avgTaste, #avgTexture, #avgPairing, #avgVisuel  (spans)
   - #responsesTbody (tbody du tableau)
   - #btnExport (bouton export CSV)
*/
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
  for (const it of items) {
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

async function loadDashboard() {
  const cakeId = $("#cakeIdDash").value.trim();
  if (!cakeId) {
    toast("Saisis un ID Gâteau.");
    return;
  }
  const url = `${CONFIG.API_URL}?action=listResponses&cakeId=${encodeURIComponent(
    cakeId
  )}`;
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
  setText(
    "#avgGlobal",
    moyenne([avgTaste, avgTexture, avgPairing, avgVisuel, avgOverall])
  );
}

function exportCSV() {
  const cakeId = $("#cakeIdDash").value.trim();
  if (!cakeId) {
    toast("Saisis un ID Gâteau.");
    return;
  }
  const url = `${CONFIG.API_URL}?action=exportCsv&cakeId=${encodeURIComponent(
    cakeId
  )}`;
  window.location.href = url;
}

/* === 5) BOOTSTRAP PAR PAGE === */
document.addEventListener("DOMContentLoaded", () => {
  // add-cake.html
  if ($("#formAddCake")) {
    $("#formAddCake").addEventListener("submit", handleAddCakeSubmit);
  }

  // feedback.html
  if ($("#formFeedback")) {
    if ($("#cakeId") && !$("#cakeId").value) {
      const id = getCakeIdFromURL();
      if (id) $("#cakeId").value = id;
    }
    $("#formFeedback").addEventListener("submit", handleFeedbackSubmit);
  }

  // dashboard.html
  if ($("#cakeIdDash")) {
    $("#btnLoad") && $("#btnLoad").addEventListener("click", loadDashboard);
    $("#btnExport") && $("#btnExport").addEventListener("click", exportCSV);
  }
});


