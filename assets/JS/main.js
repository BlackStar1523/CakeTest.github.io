/* ======= Cake Feedback – main.js (Phase 1 – MVP) ======= */

/* === 0) CONFIG === */
const CONFIG = {
  API_URL:
    "https://script.google.com/macros/s/AKfycbw6qu6FrM57cTXG0OyRiuWN4iuQ7km98h6QxKTy5-3hlPE952y371FVMwWxUc168nWf/exec",
  CLOUDINARY_CLOUD_NAME: "dk0ioppgv",     // <-- remplace si besoin
  CLOUDINARY_UPLOAD_PRESET: "unsigned",    // <-- crée un preset 'unsigned' dans Cloudinary
  MAX_IMG: 1600,                           // redimension côté client (~px)
};

/* === 1) HELPERS === */
const $ = (sel, root = document) => root.querySelector(sel);

function toQuery(params) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

// Pour éviter certains ennuis CORS d’Apps Script, on peut envoyer 'text/plain'
async function postJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // si souci CORS: mets "text/plain"
    body: JSON.stringify(data),
  });
  return res.json();
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function toast(msg) {
  alert(msg); // simple pour MVP (tu pourras remplacer par un beau toast)
}

/* === 2) UPLOAD PHOTO (Cloudinary, compress + resize) === */
function loadImageFile(file) {
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

  // JPEG qualité 0.85 (équilibre)
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
  });
}

async function uploadToCloudinary(file) {
  const compressed = await compressImage(file, CONFIG.MAX_IMG);
  const form = new FormData();
  form.append("file", compressed);
  form.append("upload_preset", CONFIG.CLOUDINARY_UPLOAD_PRESET);

  const url = `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const res = await fetch(url, { method: "POST", body: form });
  const data = await res.json();

  if (!data.secure_url) {
    console.error("Cloudinary error:", data);
    throw new Error("Upload Cloudinary échoué");
  }
  return data.secure_url;
}

/* === 3) CRÉATION GÂTEAU (add-cake.html) ===
   IDs requis dans la page :
   - #formAddCake
   - #title (text)
   - #dateReal (date)
   - #photo (file)
   - #preview (img)  [optionnel]
   - #publicLink (a)
   - #qr (canvas)    [si tu ajoutes qrcode.js, sinon ignorer]
*/
async function handleAddCakeSubmit(e) {
  e.preventDefault();
  const title = $("#title").value.trim();
  const dateReal = $("#dateReal").value; // format HTML date YYYY-MM-DD
  const file = $("#photo").files[0];
  if (!title || !dateReal || !file) {
    toast("Titre, date et photo sont obligatoires.");
    return;
  }

  try {
    // 1) Upload photo → URL
    const photoUrl = await uploadToCloudinary(file);

    // 2) createCake → Apps Script
    const url = `${CONFIG.API_URL}?action=createCake`;
    const res = await postJSON(url, {
      title,
      photoUrl,
      dateRealisation: dateReal,
    });
    if (!res.ok) throw new Error(res.error || "createCake a échoué");

    // 3) Construire lien de feedback à partager
    const feedbackUrl = new URL(location.origin + location.pathname);
    // si le site est dans un sous-chemin, on cible explicitement feedback.html à la racine du repo
    // NOTE: sur GitHub Pages, remplace ci-dessous par ton chemin si besoin :
    feedbackUrl.pathname = feedbackUrl.pathname.replace(/[^/]*$/, "") + "feedback.html";
    feedbackUrl.search = "?" + toQuery({ cakeId: res.cakeId, t: Date.now() });

    // Afficher lien
    const a = $("#publicLink");
    if (a) {
      a.href = feedbackUrl.toString();
      a.textContent = feedbackUrl.toString();
      a.target = "_blank";
    }

    toast("Gâteau créé. Lien prêt à partager !");
    // 4) QR (si tu inclus qrcodejs dans la page)
    if (window.QRCode && $("#qr")) {
      $("#qr").innerHTML = "";
      new QRCode($("#qr"), { text: feedbackUrl.toString(), width: 160, height: 160 });
    }
  } catch (err) {
    console.error(err);
    toast("Erreur lors de la création du gâteau.");
  }
}

/* === 4) FORMULAIRE TESTEUR (feedback.html) ===
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
      ratings,
      flags,
      comments,
      submittedAt,
    });
    if (!res.ok) throw new Error(res.error || "addResponse a échoué");

    toast("Merci ! Votre avis a été enregistré.");
    // Option : réinitialiser le formulaire
    $("#formFeedback").reset();
  } catch (err) {
    console.error(err);
    toast("Erreur : envoi impossible.");
  }
}

/* === 5) DASHBOARD (dashboard.html) ===
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
}

function exportCSV() {
  const cakeId = $("#cakeIdDash").value.trim();
  if (!cakeId) {
    toast("Saisis un ID Gâteau.");
    return;
  }
  const url = `${CONFIG.API_URL}?action=exportCsv&cakeId=${encodeURIComponent(cakeId)}`;
  // simple redirection pour télécharger
  window.location.href = url;
}

/* === 6) BOOTSTRAP PAR PAGE === */
document.addEventListener("DOMContentLoaded", () => {
  // add-cake.html
  if ($("#formAddCake")) {
    $("#formAddCake").addEventListener("submit", handleAddCakeSubmit);
    // mini aperçu
    const input = $("#photo");
    const prev = $("#preview");
    if (input && prev) {
      input.addEventListener("change", () => {
        const f = input.files[0];
        if (f) prev.src = URL.createObjectURL(f);
      });
    }
  }

  // feedback.html
  if ($("#formFeedback")) {
    // si cakeId caché absent, on remplit depuis l’URL
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

