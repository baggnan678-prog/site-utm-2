// ================================================================
// SUPABASE
// ================================================================
const SUPABASE_URL  = "https://koqypqncpaiwivbzdayd.supabase.co";
const SUPABASE_ANON = "sb_publishable_tJzBF2337BWiYQ-WZ5XvXQ_BR3jRS8j";
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);
let ADMIN_PASSWORD = "1596";

// ================================================================
// THÈME & FONDS
// ================================================================
let isDarkMode = false;
const bgUrls = { light: "", dark: "" };

function applyCurrentThemeBg() {
  const url = isDarkMode ? bgUrls.dark : bgUrls.light;
  document.body.style.backgroundImage = url ? `url("${url}")` : "";
}
function setBgUrl(theme, url) {
  bgUrls[theme] = url;
  if ((theme === "dark") === isDarkMode) applyCurrentThemeBg();
}
document.getElementById("themeBtn").addEventListener("click", () => {
  isDarkMode = !isDarkMode;
  document.body.setAttribute("data-theme", isDarkMode ? "dark" : "light");
  document.getElementById("themeLabel").textContent = isDarkMode ? "🌙 Thème Sombre" : "☀️ Thème Clair";
  applyCurrentThemeBg();
});

// ================================================================
// SETTINGS SUPABASE
// ================================================================
async function loadSettings() {
  const { data, error } = await db.from("settings").select("*");
  if (error || !data) return;
  const s = {};
  data.forEach(r => s[r.key] = r.value);
  if (s["admin_password"]) ADMIN_PASSWORD = s["admin_password"];
  ["light","dark"].forEach(t => {
    const k = `bg_${t}_current_path`;
    if (s[k]) setBgUrl(t, db.storage.from("backgrounds").getPublicUrl(s[k]).data.publicUrl);
  });
  if (!s["bg_light_current_path"] && s["bg_current_path"])
    setBgUrl("light", db.storage.from("backgrounds").getPublicUrl(s["bg_current_path"]).data.publicUrl);
}
async function upsertSetting(key, value) {
  const { error: ue } = await db.from("settings").update({ value }).eq("key", key);
  if (ue) await db.from("settings").insert({ key, value });
}

// ================================================================
// FAVORIS — localStorage
// ================================================================
const FAV_KEY = "utm_favorites";
function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }
  catch { return []; }
}
function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  updateFavBadge();
}
function isFavorite(id) { return getFavorites().some(f => f.id === id); }
function updateFavBadge() {
  document.getElementById("favCountBadge").textContent = getFavorites().length;
}

function toggleFavorite(doc) {
  let favs = getFavorites();
  const idx = favs.findIndex(f => f.id === doc.id);
  const adding = idx < 0;
  if (adding) favs.unshift(doc);
  else        favs.splice(idx, 1);
  saveFavorites(favs);
  showToast(adding ? "Ajouté aux favoris ! ⭐" : "Retiré des favoris.", adding ? "success" : "info");
  // Mettre à jour tous les btn-fav visibles
  document.querySelectorAll(`.btn-fav[data-id="${doc.id}"]`).forEach(b => {
    b.classList.toggle("faved", isFavorite(doc.id));
    b.title = isFavorite(doc.id) ? "Retirer des favoris" : "Ajouter aux favoris";
  });
  if (currentTab === "favorites") renderFavorites();
}

// ================================================================
// LIKES — Supabase + localStorage (anti-double)
// ================================================================
const LIKED_KEY = "utm_liked";
function getLikedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(LIKED_KEY)) || []); }
  catch { return new Set(); }
}
function persistLikedSet(s) { localStorage.setItem(LIKED_KEY, JSON.stringify([...s])); }
function hasLiked(id) { return getLikedSet().has(id); }

async function toggleLike(docId, currentCount) {
  const already = hasLiked(docId);
  const newCount = already ? Math.max(0, currentCount - 1) : currentCount + 1;
  // Optimistic UI
  document.querySelectorAll(`.btn-like[data-id="${docId}"]`).forEach(b => {
    b.classList.toggle("liked", !already);
    b.querySelector(".like-num").textContent = newCount;
    b.dataset.count = newCount;
  });
  const s = getLikedSet();
  already ? s.delete(docId) : s.add(docId);
  persistLikedSet(s);
  // Persistance Supabase
  const { error } = await db.from("documents").update({ likes: newCount }).eq("id", docId);
  if (error) {
    showToast("Erreur like : " + error.message, "error");
    // Rollback
    document.querySelectorAll(`.btn-like[data-id="${docId}"]`).forEach(b => {
      b.classList.toggle("liked", already);
      b.querySelector(".like-num").textContent = currentCount;
      b.dataset.count = currentCount;
    });
    already ? s.add(docId) : s.delete(docId);
    persistLikedSet(s);
  }
}

// ================================================================
// MODAL PREVIEW
// ================================================================
function openPreview(url, title) {
  const frame   = document.getElementById("previewFrame");
  const fallback= document.getElementById("previewFallback");
  document.getElementById("previewTitle").textContent = title;
  const ext = url.split("?")[0].split(".").pop().toLowerCase();
  const nativePreview = ["pdf","png","jpg","jpeg","gif","webp","svg","mp4","mp3","ogg","wav"];
  if (nativePreview.includes(ext)) {
    frame.src = url;
  } else {
    // Tentative Google Docs Viewer pour office
    frame.src = `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
  }
  frame.classList.remove("hidden");
  fallback.classList.add("hidden");
  document.getElementById("previewOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closePreview() {
  document.getElementById("previewOverlay").classList.add("hidden");
  document.getElementById("previewFrame").src = "";
  document.body.style.overflow = "";
}
document.getElementById("previewOverlay").addEventListener("click", function(e) {
  if (e.target === this) closePreview();
});

// ================================================================
// RENDU D'UNE CARTE DOCUMENT
// Sérialise le doc en data-attribute JSON pour éviter XSS dans onclick
// ================================================================
function buildDocCard(doc) {
  const liked  = hasLiked(doc.id);
  const faved  = isFavorite(doc.id);
  const count  = doc.likes || 0;

  const card = document.createElement("div");
  card.className = "doc-card";

  // Bouton like
  const btnLike = document.createElement("button");
  btnLike.className = "btn-like" + (liked ? " liked" : "");
  btnLike.dataset.id    = doc.id;
  btnLike.dataset.count = count;
  btnLike.title = liked ? "Je n'aime plus" : "J'aime";
  btnLike.innerHTML = `♥ <span class="like-num">${count}</span>`;
  btnLike.addEventListener("click", () => {
    const c = parseInt(btnLike.dataset.count, 10);
    toggleLike(doc.id, c);
  });

  // Bouton favori
  const btnFav = document.createElement("button");
  btnFav.className = "btn-fav" + (faved ? " faved" : "");
  btnFav.dataset.id = doc.id;
  btnFav.title = faved ? "Retirer des favoris" : "Ajouter aux favoris";
  btnFav.textContent = "⭐";
  btnFav.addEventListener("click", () => toggleFavorite(doc));

  // Bouton preview
  const btnPrev = document.createElement("button");
  btnPrev.className = "btn-preview";
  btnPrev.textContent = "👁 Aperçu";
  btnPrev.addEventListener("click", () => openPreview(doc.url, doc.module));

  // Lien télécharger
  const lnkDl = document.createElement("a");
  lnkDl.className = "btn-dl";
  lnkDl.href = doc.url;
  lnkDl.target = "_blank";
  lnkDl.download = "";
  lnkDl.innerHTML = "⬇ Télécharger";

  // Infos
  const info = document.createElement("div");
  info.className = "doc-info";
  info.innerHTML = `<strong>${doc.module}</strong><small>${doc.annee || ""} — ${doc.type} — ${doc.niveau || ""}</small>`;

  // Actions
  const actions = document.createElement("div");
  actions.className = "doc-actions";
  actions.append(btnLike, btnFav, btnPrev, lnkDl);

  card.append(info, actions);
  return card;
}

// ================================================================
// ONGLETS RECHERCHE / FAVORIS
// ================================================================
let currentTab = "search";
function switchTab(tab) {
  currentTab = tab;
  document.getElementById("tab-search").classList.toggle("active",    tab === "search");
  document.getElementById("tab-favorites").classList.toggle("active",  tab === "favorites");
  document.getElementById("search-tab-content").classList.toggle("hidden",     tab !== "search");
  document.getElementById("favorites-tab-content").classList.toggle("hidden",  tab !== "favorites");
  document.getElementById("searchResults").classList.toggle("hidden",          tab !== "search");
  if (tab === "favorites") renderFavorites();
}

// ================================================================
// PAGE FAVORIS
// ================================================================
function renderFavorites() {
  const container = document.getElementById("favorites-tab-content");
  const favs = getFavorites();
  container.innerHTML = "";
  if (favs.length === 0) {
    container.innerHTML = `<div class="empty-fav"><span>⭐</span>Aucun document en favori pour l'instant.<br><small>Cliquez sur ⭐ à côté d'un document pour l'ajouter.</small></div>`;
    return;
  }
  const h = document.createElement("h3");
  h.style.cssText = "text-align:left;margin-bottom:8px";
  h.textContent = `Mes favoris (${favs.length})`;
  container.appendChild(h);
  favs.forEach(doc => container.appendChild(buildDocCard(doc)));
}

// ================================================================
// RECHERCHE
// ================================================================
document.getElementById("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const moduleSearch = document.getElementById("searchModule").value.trim();
  if (moduleSearch === ADMIN_PASSWORD) {
    showPage("admin-page");
    loadLoginHistory(); loadAdminFiles(); loadAdminBgPreviews();
    return;
  }
  const filiere = document.getElementById("searchFiliere").value;
  const niveau  = document.getElementById("searchNiveau").value;
  const type    = document.getElementById("searchType").value;
  const annee   = document.getElementById("searchAnnee").value;
  const resList = document.getElementById("resultsList");
  resList.innerHTML = `<p style="text-align:center;opacity:.6">Recherche en cours...</p>`;

  let q = db.from("documents").select("*")
    .contains("filieres", [filiere]).eq("niveau", niveau).eq("type", type);
  if (annee)        q = q.eq("annee", annee);
  if (moduleSearch) q = q.ilike("module", `%${moduleSearch}%`);

  const { data, error } = await q.order("created_at", { ascending: false });
  resList.innerHTML = "";
  if (error) { resList.innerHTML = "Erreur : " + error.message; return; }
  if (!data || !data.length) {
    resList.innerHTML = `<p style="text-align:center;opacity:.6">Aucun document trouvé.</p>`; return;
  }
  data.forEach(doc => resList.appendChild(buildDocCard(doc)));
});

// ================================================================
// NAVIGATION
// ================================================================
function showPage(id) {
  ["login-page","search-page","admin-page"].forEach(p =>
    document.getElementById(p).classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
function logout()    { showPage("login-page"); }
function quitAdmin() { showPage("search-page"); loadUniqueYears(); }

// ================================================================
// LOGIN
// ================================================================
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom       = document.getElementById("nom").value.trim();
  const prenom    = document.getElementById("prenom").value.trim();
  const filiere   = document.getElementById("loginFiliere").value;
  const studentId = document.getElementById("studentId").value;
  if (studentId === ADMIN_PASSWORD) {
    showPage("admin-page"); loadLoginHistory(); loadAdminFiles(); loadAdminBgPreviews();
    showToast("Mode Administrateur activé.", "success"); return;
  }
  const { error } = await db.from("login_history").insert({ nom, prenom, filiere, student_id: studentId });
  if (error) { showToast("Erreur : " + error.message, "error"); return; }
  showPage("search-page"); loadUniqueYears(); updateFavBadge();
});

// ================================================================
// MOT DE PASSE ADMIN
// ================================================================
async function changePassword() {
  const actuel  = document.getElementById("pwdActuel").value;
  const nouveau = document.getElementById("pwdNouveau").value.trim();
  const confirm = document.getElementById("pwdConfirm").value.trim();
  if (actuel !== ADMIN_PASSWORD)    { showToast("Mot de passe actuel incorrect.", "error"); return; }
  if (!/^[0-9]{4}$/.test(nouveau)) { showToast("Exactement 4 chiffres requis.", "error"); return; }
  if (nouveau !== confirm)          { showToast("Les mots de passe ne correspondent pas.", "error"); return; }
  if (nouveau === ADMIN_PASSWORD)   { showToast("Identique à l'ancien.", "error"); return; }
  const { error } = await db.from("settings").update({ value: nouveau }).eq("key", "admin_password");
  if (error) { showToast("Erreur : " + error.message, "error"); return; }
  ADMIN_PASSWORD = nouveau;
  ["pwdActuel","pwdNouveau","pwdConfirm"].forEach(id => document.getElementById(id).value = "");
  showToast("Mot de passe mis à jour !", "success");
}

// ================================================================
// UPLOAD DOCUMENTS
// ================================================================
async function uploadFiles() {
  const files      = document.getElementById("fileInput").files;
  const filieres   = Array.from(document.getElementById("adminFilieres").selectedOptions).map(o => o.value);
  const niveau     = document.getElementById("adminNiveau").value;
  const type       = document.getElementById("adminType").value;
  const moduleName = document.getElementById("adminModule").value.trim();
  const annee      = document.getElementById("adminAnnee").value.trim();
  if (!files.length || !moduleName || !annee || !filieres.length) {
    showToast("Remplissez tous les critères.", "error"); return;
  }
  const bar  = document.getElementById("uploadProgress");
  const fill = document.getElementById("progressBarFill");
  bar.style.display = "block"; let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    fill.style.width = Math.round((i / files.length) * 100) + "%";
    fill.textContent = `Envoi ${i+1}/${files.length}...`;
    const { data: sd, error: se } = await db.storage.from("documents")
      .upload(`documents/${Date.now()}_${file.name}`, file, { upsert: false });
    if (se) { showToast(`Erreur "${file.name}": ${se.message}`, "error"); continue; }
    const url = db.storage.from("documents").getPublicUrl(sd.path).data.publicUrl;
    const { error: de } = await db.from("documents").insert({
      name: file.name, url, storage_path: sd.path,
      filieres, niveau, type, module: moduleName, annee, likes: 0
    });
    if (de) showToast(`Erreur BDD "${file.name}": ${de.message}`, "error");
    else ok++;
  }
  fill.style.width = "100%"; fill.textContent = "Terminé !";
  if (ok > 0) showToast(`${ok} fichier(s) uploadé(s) !`, "success");
  loadAdminFiles();
}

// ================================================================
// FICHIERS ADMIN
// ================================================================
async function loadAdminFiles() {
  const div = document.getElementById("adminFileList");
  div.innerHTML = "Chargement...";
  const { data, error } = await db.from("documents").select("*").order("created_at", { ascending: false });
  div.innerHTML = "";
  if (error) { div.innerHTML = "Erreur : " + error.message; return; }
  if (!data || !data.length) { div.innerHTML = "Aucun document."; return; }
  data.forEach(doc => {
    const d = document.createElement("div");
    d.className = "doc-item";
    d.innerHTML = `
      <div><strong>${doc.module}</strong><br><small>${doc.type} — ${doc.name} — ♥ ${doc.likes || 0}</small></div>
      <div class="doc-item-actions">
        <button onclick="editDoc('${doc.id}')" class="btn-sm">✏ Modifier</button>
        <button onclick="deleteDoc('${doc.id}','${doc.storage_path}')" class="btn-sm" style="background:#ef4444">🗑 Supprimer</button>
      </div>`;
    div.appendChild(d);
  });
}

async function deleteDoc(id, sp) {
  if (!confirm("Supprimer ce fichier ?")) return;
  const { data: doc, error: re } = await db.from("documents").select("*").eq("id", id).single();
  if (re || !doc) { showToast("Document introuvable.", "error"); return; }
  await db.from("deleted_documents").insert({
    original_id:doc.id, name:doc.name, url:doc.url, storage_path:doc.storage_path,
    filieres:doc.filieres, niveau:doc.niveau, type:doc.type, module:doc.module, annee:doc.annee
  });
  await db.from("documents").delete().eq("id", id);
  if (sp) await db.storage.from("documents").remove([sp]);
  showToast("Déplacé dans la corbeille.", "info"); loadAdminFiles();
}

async function editDoc(id) {
  const m = prompt("Nouveau nom du module ?");
  if (!m) return;
  const { error } = await db.from("documents").update({ module: m }).eq("id", id);
  if (error) showToast("Erreur : " + error.message, "error");
  else { showToast("Mis à jour.", "success"); loadAdminFiles(); }
}

// ================================================================
// CORBEILLE
// ================================================================
async function toggleDeleteHistory() {
  const modal = document.getElementById("trashModal");
  modal.classList.toggle("hidden");
  if (modal.classList.contains("hidden")) return;
  const list = document.getElementById("trashList");
  list.innerHTML = "Chargement...";
  const { data, error } = await db.from("deleted_documents")
    .select("*").order("deleted_at", { ascending: false }).limit(20);
  list.innerHTML = "";
  if (error) { list.innerHTML = "Erreur : " + error.message; return; }
  if (!data || !data.length) { list.innerHTML = "Corbeille vide."; return; }
  data.forEach(doc => {
    const d = document.createElement("div");
    d.className = "doc-item";
    d.innerHTML = `<span>${doc.name} <small>(Supprimé)</small></span>
      <button onclick="restoreDoc('${doc.id}')" class="btn-sm btn-success">Restaurer</button>`;
    list.appendChild(d);
  });
}

async function restoreDoc(trashId) {
  const { data: doc, error } = await db.from("deleted_documents").select("*").eq("id", trashId).single();
  if (error || !doc) { showToast("Introuvable.", "error"); return; }
  const { error: ie } = await db.from("documents").insert({
    name:doc.name, url:doc.url, storage_path:doc.storage_path,
    filieres:doc.filieres, niveau:doc.niveau, type:doc.type,
    module:doc.module, annee:doc.annee, likes:0
  });
  if (ie) { showToast("Erreur restauration : " + ie.message, "error"); return; }
  await db.from("deleted_documents").delete().eq("id", trashId);
  showToast("Document restauré.", "success");
  toggleDeleteHistory(); loadAdminFiles();
}

// ================================================================
// HISTORIQUE CONNEXIONS
// ================================================================
async function loadLoginHistory() {
  const el = document.getElementById("loginHistoryList");
  el.innerHTML = "Chargement...";
  const { data, error } = await db.from("login_history").select("*").order("created_at", { ascending: false });
  el.innerHTML = "";
  if (error) { el.innerHTML = "Erreur : " + error.message; return; }
  if (!data || !data.length) { el.innerHTML = "Aucune connexion enregistrée."; return; }
  data.forEach(e => {
    const p = document.createElement("div");
    p.style.cssText = "border-bottom:1px solid rgba(128,128,128,.2);padding:4px 0";
    p.textContent = `${new Date(e.created_at).toLocaleString("fr-FR")} — ${e.nom} ${e.prenom} (${e.filiere})`;
    el.appendChild(p);
  });
}

async function clearLoginHistory() {
  if (!confirm("Tout effacer ?")) return;
  const { error } = await db.from("login_history").delete().not("id","is",null);
  if (error) showToast("Erreur : " + error.message, "error");
  else { showToast("Historique effacé.", "success"); loadLoginHistory(); }
}

// ================================================================
// ANNÉES UNIQUES
// ================================================================
async function loadUniqueYears() {
  const sel = document.getElementById("searchAnnee");
  const { data } = await db.from("documents").select("annee");
  if (!data) return;
  const years = [...new Set(data.map(d => d.annee))].sort();
  sel.innerHTML = '<option value="">Toutes</option>';
  years.forEach(y => { const o = document.createElement("option"); o.value = o.textContent = y; sel.appendChild(o); });
}

// ================================================================
// ADMIN — FONDS D'ÉCRAN
// ================================================================
function switchBgTab(theme, btn) {
  document.querySelectorAll(".theme-tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".bg-theme-section").forEach(s => s.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("bg-section-" + theme).classList.add("active");
}
function previewNewBg(theme) {
  const file = document.getElementById(`bgInput-${theme}`).files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = e => { const p = document.getElementById(`bgNewPreview-${theme}`); p.src = e.target.result; p.style.display = "block"; };
  r.readAsDataURL(file);
}
async function loadAdminBgPreviews() {
  const { data, error } = await db.from("settings").select("*");
  if (error || !data) return;
  const s = {}; data.forEach(r => s[r.key] = r.value);
  ["light","dark"].forEach(theme => {
    const ck = `bg_${theme}_current_path`, pk = `bg_${theme}_previous_path`;
    if (s[ck]) {
      const url = db.storage.from("backgrounds").getPublicUrl(s[ck]).data.publicUrl;
      const el  = document.getElementById(`bgCurrentPreview-${theme}`);
      el.src = url; el.style.display = "block";
      document.getElementById(`bgCurrentBadge-${theme}`).textContent = "Personnalisé";
      document.getElementById(`bgCurrentInfo-${theme}`).textContent  = s[ck].split("/").pop();
    } else {
      document.getElementById(`bgCurrentBadge-${theme}`).textContent = "Par défaut";
      document.getElementById(`bgCurrentInfo-${theme}`).textContent  = "Image locale.";
    }
    if (s[pk]) {
      const url = db.storage.from("backgrounds").getPublicUrl(s[pk]).data.publicUrl;
      const el  = document.getElementById(`bgPrevPreview-${theme}`);
      el.src = url; el.style.display = "block";
      document.getElementById(`bgPrevBadge-${theme}`).textContent = "Disponible";
      document.getElementById(`bgPrevInfo-${theme}`).textContent  = s[pk].split("/").pop();
      document.getElementById(`btnRestoreBg-${theme}`).disabled   = false;
    } else {
      document.getElementById(`bgPrevBadge-${theme}`).textContent = "Aucun";
      document.getElementById(`btnRestoreBg-${theme}`).disabled   = true;
    }
  });
}
async function changeBackground(theme) {
  const file = document.getElementById(`bgInput-${theme}`).files[0];
  if (!file) { showToast("Sélectionnez une image.", "error"); return; }
  showToast("Upload en cours...", "info");
  const ck = `bg_${theme}_current_path`, pk = `bg_${theme}_previous_path`;
  const { data: sd } = await db.from("settings").select("*");
  const s = {}; if (sd) sd.forEach(r => s[r.key] = r.value);
  const { data: up, error: ue } = await db.storage.from("backgrounds")
    .upload(`bg_${theme}_${Date.now()}_${file.name}`, file, { upsert: false });
  if (ue) { showToast("Erreur upload : " + ue.message, "error"); return; }
  await upsertSetting(pk, s[ck] || "");
  await upsertSetting(ck, up.path);
  setBgUrl(theme, db.storage.from("backgrounds").getPublicUrl(up.path).data.publicUrl);
  await loadAdminBgPreviews();
  document.getElementById(`bgInput-${theme}`).value = "";
  document.getElementById(`bgNewPreview-${theme}`).style.display = "none";
  showToast(`Fond ${theme === "light" ? "clair" : "sombre"} changé !`, "success");
}
async function restoreBackground(theme) {
  const ck = `bg_${theme}_current_path`, pk = `bg_${theme}_previous_path`;
  const { data: sd } = await db.from("settings").select("*");
  if (!sd) return;
  const s = {}; sd.forEach(r => s[r.key] = r.value);
  const cur = s[ck] || "", prev = s[pk] || "";
  if (!prev) { showToast("Aucun fond précédent.", "error"); return; }
  await upsertSetting(ck, prev); await upsertSetting(pk, cur);
  setBgUrl(theme, db.storage.from("backgrounds").getPublicUrl(prev).data.publicUrl);
  await loadAdminBgPreviews();
  showToast(`Fond ${theme === "light" ? "clair" : "sombre"} restauré !`, "success");
}

// ================================================================
// TOAST
// ================================================================
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = `${type} show`;
  setTimeout(() => t.classList.remove("show"), 3500);
}

// ================================================================
// EXPOSITION GLOBALE
// ================================================================
Object.assign(window, {
  uploadFiles, editDoc, deleteDoc, toggleDeleteHistory, restoreDoc,
  clearLoginHistory, quitAdmin, logout, changeBackground, restoreBackground,
  changePassword, previewNewBg, switchBgTab, switchTab, closePreview
});

// ================================================================
// INIT
// ================================================================
loadSettings();
updateFavBadge();