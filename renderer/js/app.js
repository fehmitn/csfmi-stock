'use strict';
/* =====================================================================
   Gestion de Stock Interne — Interface (renderer)
   ===================================================================== */

/* ============================ Helpers ============================ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtQty(n) {
  return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function moisISO() { return todayISO().slice(0, 7); }

async function req(action, payload) {
  const r = await window.api.request(action, payload);
  if (!r.ok) { toast(r.error, 'error'); throw new Error(r.error); }
  return r.data;
}

function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

function modal(html) {
  const voile = document.createElement('div');
  voile.className = 'voile';
  voile.innerHTML = `<div class="boite">${html}</div>`;
  document.body.appendChild(voile);
  const fermer = () => voile.remove();
  voile.addEventListener('mousedown', e => { if (e.target === voile) fermer(); });
  document.addEventListener('keydown', function escFn(e) {
    if (e.key === 'Escape') { fermer(); document.removeEventListener('keydown', escFn); }
  });
  return { voile, fermer };
}

function confirmDlg(message, titre = 'Confirmation') {
  return new Promise(resolve => {
    const m = modal(`
      <div class="boite-t">${esc(titre)}<button class="btn-icon" id="cf-fermer">✕</button></div>
      <div class="boite-c"><p>${esc(message)}</p></div>
      <div class="boite-p">
        <button class="btn secondaire" id="cf-non">Annuler</button>
        <button class="btn danger" id="cf-oui">Confirmer</button>
      </div>`);
    m.voile.querySelector('#cf-oui').onclick = () => { m.fermer(); resolve(true); };
    m.voile.querySelector('#cf-non').onclick = () => { m.fermer(); resolve(false); };
    m.voile.querySelector('#cf-fermer').onclick = () => { m.fermer(); resolve(false); };
  });
}

function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function csvDepuisLignes(entetes, lignes) {
  const enc = v => {
    v = String(v ?? '');
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return [entetes.map(enc).join(';'), ...lignes.map(l => l.map(enc).join(';'))].join('\r\n');
}

async function exporterCsv(filename, entetes, lignes) {
  const r = await window.api.exportCsv({ filename, content: csvDepuisLignes(entetes, lignes) });
  if (r.filePath) toast('CSV exporté : ' + r.filePath);
}
async function exporterPdf(titre, filename, contenuInterne) {
  const r = await window.api.generatePdf({ title: titre, filename, html: contenuInterne });
  if (r && r.error) { toast(r.error, 'error'); return; }
  if (r && r.filePath) toast('PDF exporté : ' + r.filePath);
}

/* ============================ Introduction ============================ */

const NAV = [
  { id: 'dashboard', label: 'Tableau de bord', ic: '🏠' },
  { id: 'stock', label: 'Stock actuel', ic: '📦' },
  { id: 'articles', label: 'Articles', ic: '🗂️' },
  { id: 'entrees', label: 'Entrées (réceptions)', ic: '📥' },
  { id: 'sorties', label: 'Sorties (distributions)', ic: '📤' },
  { id: 'mouvements', label: 'Journal des mouvements', ic: '🕓' },
  { id: 'sources', label: 'Fournisseurs & marchés', ic: '🚚' },
  { id: 'departements', label: 'Départements', ic: '🏢' },
  { id: 'rapports', label: 'Rapports', ic: '🧾' },
  { id: 'parametres', label: 'Paramètres', ic: '⚙️' }
];

const TITRES = {
  dashboard: ['Tableau de bord', "Vue d'ensemble de l'activité du magasin"],
  stock: ['Stock actuel', 'Quantités disponibles en temps réel (entrées − sorties)'],
  articles: ['Articles', 'Catalogue des articles gérés par le magasin'],
  entrees: ['Entrées — Bons de réception', "Articles reçus des fournisseurs et des marchés"],
  sorties: ['Sorties — Bons de distribution', 'Articles distribués aux départements'],
  mouvements: ['Journal des mouvements', 'Historique complet des entrées et sorties'],
  sources: ['Fournisseurs & marchés', "Sources d'approvisionnement du magasin"],
  departements: ['Départements', 'Départements destinataires des distributions'],
  rapports: ['Rapports & impressions', 'États, exports PDF et CSV'],
  parametres: ['Paramètres', 'Sauvegarde, restauration et données'],
  entreeForm: ['Nouvelle réception', 'Enregistrer les articles reçus d\'un fournisseur ou d\'un marché'],
  sortieForm: ['Nouvelle distribution', 'Distribuer des articles à un département']
};

const state = {
  vue: 'dashboard',
  rechArticles: '',
  filtresStock: { search: '', categorieId: '', masquerStockZero: false },
  filtresMv: { type: '', from: '', articleId: '' },
  filtresEntrees: { sourceId: '', from: '', to: '' },
  filtresSorties: { departementId: '', from: '', to: '' },
  mvRows: [],
  lignesMouvements: []
};

const UNITE_SUGGEREES = ['pièce', 'boîte', 'carton', 'kg', 'litre', 'mètre', 'rouleau', 'sachet'];

function buildShell() {
  $('#app').innerHTML = `
    <div class="sidebar">
      <div class="logo">
        <h1>📦 Gestion de Stock</h1>
        <p>Application interne du magasin</p>
      </div>
      <nav id="nav">
        ${NAV.map(n => `<button data-vue="${n.id}"><span class="ic">${n.ic}</span>${esc(n.label)}</button>`).join('')}
      </nav>
      <div class="pied">Version 1.0.0<br>Stock local, aucune connexion requise</div>
    </div>
    <div class="main">
      <div class="topbar">
        <div><h2 id="titre-vue"></h2><div class="soustitre" id="soustitre-vue"></div></div>
        <div id="actions-top"></div>
      </div>
      <div class="contenu" id="contenu"></div>
    </div>`;
  $$('#nav button').forEach(b => b.onclick = () => go(b.dataset.vue));
  go('dashboard');
}

async function go(vue, ...args) {
  state.vue = vue;
  $$('#nav button').forEach(b => b.classList.toggle('actif', b.dataset.vue === vue));
  const [t, st] = TITRES[vue] || [vue, ''];
  $('#titre-vue').textContent = t;
  $('#soustitre-vue').textContent = st;
  $('#actions-top').innerHTML = '';
  const contenu = $('#contenu');
  contenu.innerHTML = '<p class="muted">Chargement…</p>';
  if (!VUES[vue]) {
    contenu.innerHTML = `<div class="carte"><p class="muted">Vue « ${esc(vue)} » introuvable.</p></div>`;
    return;
  }
  try {
    await VUES[vue](...args);
  } catch (e) {
    if (!contenu.children.length) contenu.innerHTML = `<div class="carte"><p class="muted">${esc(e.message)}</p></div>`;
  }
}

/* ============================ Vue : Tableau de bord ============================ */

async function vueDashboard() {
  const s = await req('stats');
  const contenu = $('#contenu');
  const alertesHtml = s.alerts.length
    ? `<table><thead><tr><th>Article</th><th>Stock</th><th>Seuil</th><th>Statut</th></tr></thead>
       <tbody>${s.alerts.map(a => `<tr>
         <td>${a.code ? esc(a.code) + ' — ' : ''}${esc(a.designation)}</td>
         <td class="num">${fmtQty(a.stock)}</td><td class="num">${fmtQty(a.seuil)}</td>
         <td>${a.stock <= 0 ? '<span class="badge rouge">Rupture</span>' : '<span class="badge orange">Stock bas</span>'}</td>
       </tr>`).join('')}</tbody></table>`
    : '<p class="muted">Aucun article en alerte. 👍</p>';

  const derniers = s.derniers.length
    ? `<table><thead><tr><th>Date</th><th>Type</th><th>Article</th><th class="num">Qté</th><th>Source / Département</th></tr></thead>
       <tbody>${s.derniers.map(m => `<tr>
         <td>${fmtDate(m.date)}</td>
         <td>${m.type === 'entree' ? '<span class="badge entree">↓ Entrée</span>' : (m.nature === 'destruction' ? '<span class="badge rouge">🧨 Destruction</span>' : '<span class="badge sortie">↑ Sortie</span>')}</td>
         <td>${esc(m.designation)}</td>
         <td class="num">${fmtQty(m.quantite)} ${esc(m.unite)}</td>
         <td>${esc(m.partenaire)}</td>
       </tr>`).join('')}</tbody></table>`
    : '<p class="muted">Aucun mouvement enregistré pour le moment.</p>';

  contenu.innerHTML = `
    <div class="grille c4">
      <div class="kpi cliquable" data-allera="articles"><div class="val">${s.articles}</div><div class="lbl">Articles référencés</div></div>
      <div class="kpi ${s.alertCount ? 'rouge' : 'vert'} cliquable" data-allera="stock"><div class="val">${s.alertCount}</div><div class="lbl">Articles en alerte de stock</div></div>
      <div class="kpi vert"><div class="val">${fmtQty(s.entreesMois)}</div><div class="lbl">Quantités reçues ce mois-ci</div></div>
      <div class="kpi"><div class="val">${fmtQty(s.sortiesMois)}</div><div class="lbl">Quantités distribuées ce mois-ci</div></div>
    </div>
    <div class="barre-haut">
      <div class="gauche">
        <button class="btn" data-act="go" data-arg="entreeForm">📥 Nouvelle réception</button>
        <button class="btn secondaire" data-act="go" data-arg="sortieForm">📤 Nouvelle distribution</button>
      </div>
      <div class="muted">Réceptions aujourd'hui : <b>${s.entreesJour}</b> · Distributions aujourd'hui : <b>${s.sortiesJour}</b>${s.destructionsMois ? ` · 🧨 Détruites ce mois-ci : <b>${fmtQty(s.destructionsMois)}</b>` : ''}</div>
    </div>
    <div class="carte"><h3>⚠️ Alertes de stock</h3>${alertesHtml}</div>
    <div class="carte"><h3>🕓 Derniers mouvements</h3>${derniers}</div>`;

  $$('[data-allera]').forEach(el => el.onclick = () => go(el.dataset.allera));
}

/* ============================ Vue : Stock actuel ============================ */

function statutBadge(stock, seuil) {
  if (stock <= 0) return '<span class="badge rouge">Rupture</span>';
  if (seuil > 0 && stock <= seuil) return '<span class="badge rouge">Stock bas</span>';
  if (seuil > 0 && stock <= seuil * 2) return '<span class="badge orange">A surveiller</span>';
  return '<span class="badge ok">OK</span>';
}

async function vueStock() {
  const [stock, cats] = await Promise.all([req('getStock', state.filtresStock), req('listCategories')]);
  const f = state.filtresStock;
  $('#contenu').innerHTML = `
    <div class="barre-haut">
      <div class="gauche">
        <input type="search" id="stk-rech" placeholder="🔍 Rechercher…" value="${esc(f.search)}" style="width:220px">
        <select id="stk-cat" style="width:180px">
          <option value="">Toutes les catégories</option>
          ${cats.map(c => `<option value="${c.id}" ${f.categorieId === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:6px;margin:0;font-weight:500">
          <input type="checkbox" id="stk-masque" ${f.masquerStockZero ? 'checked' : ''}> Masquer stock à 0
        </label>
      </div>
      <div class="gauche">
        <button class="btn secondaire petit" id="stk-csv">🧮 Export CSV</button>
        <button class="btn secondaire petit" id="stk-pdf">📄 Export PDF</button>
      </div>
    </div>
    <div class="efface"><table style="width:100%">
      <thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th>Unité</th><th class="num">Stock</th><th class="num">Seuil</th><th>Statut</th></tr></thead>
      <tbody id="stk-body"></tbody>
    </table></div>`;
  $('#stk-rech').oninput = e => { f.search = e.target.value; majStock(); };
  $('#stk-cat').onchange = e => { f.categorieId = e.target.value; majStock(); };
  $('#stk-masque').onchange = e => { f.masquerStockZero = e.target.checked; majStock(); };
  $('#stk-csv').onclick = () => exportStockCsv();
  $('#stk-pdf').onclick = () => exportStockPdf();
  majStock();
}

async function majStock() {
  const rows = await req('getStock', state.filtresStock);
  state.stockCourant = rows;
  $('#stk-body').innerHTML = rows.length
    ? rows.map(a => `<tr>
        <td>${esc(a.code || '—')}</td>
        <td>${esc(a.designation)}</td>
        <td>${esc(a.categorie || '—')}</td>
        <td>${esc(a.unite || '—')}</td>
        <td class="num"><b>${fmtQty(a.stock)}</b></td>
        <td class="num">${fmtQty(a.seuil)}</td>
        <td>${statutBadge(a.stock, a.seuil)}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="vide">Aucun article. Créez vos articles dans le menu « Articles ».</td></tr>';
}

function exportStockCsv() {
  const rows = state.stockCourant || [];
  exporterCsv(`etat-stock-${todayISO()}.csv`,
    ['Code', 'Désignation', 'Catégorie', 'Unité', 'Stock', 'Seuil'],
    rows.map(a => [a.code, a.designation, a.categorie, a.unite, a.stock, a.seuil]));
}
function exportStockPdf() {
  const rows = state.stockCourant || [];
  const html = `<table><thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th>Unité</th><th class="num">Stock</th><th class="num">Seuil</th></tr></thead>
    <tbody>${rows.map(a => `<tr><td>${esc(a.code || '')}</td><td>${esc(a.designation)}</td><td>${esc(a.categorie)}</td><td>${esc(a.unite)}</td><td class="num">${fmtQty(a.stock)}</td><td class="num">${fmtQty(a.seuil)}</td></tr>`).join('')}
    </tbody></table><p class="sans">${rows.length} article(s)</p>`;
  exporterPdf('État du stock', `etat-stock-${todayISO()}.pdf`, html);
}

/* ============================ Vue : Articles ============================ */

async function vueArticles() {
  const articles = await req('listArticles');
  state.articlesCache = articles;
  $('#contenu').innerHTML = `
    <div class="barre-haut">
      <div class="gauche">
        <input type="search" id="ar-rech" placeholder="🔍 Rechercher un article…" value="${esc(state.rechArticles)}" style="width:240px">
        <button class="btn secondaire" data-act="gererCategories">🏷️ Catégories</button>
      </div>
      <button class="btn" data-act="modalArticle">＋ Nouvel article</button>
    </div>
    <div class="efface"><table style="width:100%">
      <thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th>Unité</th><th class="num">Seuil d'alerte</th><th class="actions">Actions</th></tr></thead>
      <tbody id="ar-body"></tbody>
    </table></div>`;
  $('#ar-rech').oninput = e => { state.rechArticles = e.target.value; majArticles(); };
  majArticles();
}

function majArticles() {
  const q = state.rechArticles.toLowerCase();
  const rows = state.articlesCache.filter(a => !q || (a.designation + ' ' + (a.code || '')).toLowerCase().includes(q));
  $('#ar-body').innerHTML = rows.length
    ? rows.map(a => `<tr>
        <td>${esc(a.code || '—')}</td>
        <td><b>${esc(a.designation)}</b></td>
        <td>${a.categorieId ? esc(a.categorie || '') : '<span class="muted">—</span>'}</td>
        <td>${esc(a.unite || '—')}</td>
        <td class="num">${fmtQty(a.seuil)}</td>
        <td class="actions">
          <button class="btn-icon" title="Modifier" data-act="modalArticle" data-arg="${a.id}">✏️</button>
          <button class="btn-icon danger" title="Supprimer" data-act="supprimerArticle" data-arg="${a.id}">🗑️</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="vide">Aucun article. Cliquez sur « Nouvel article » pour commencer.</td></tr>';
}

async function modalArticle(idArticle) {
  const cats = await req('listCategories');
  const art = idArticle ? state.articlesCache.find(a => a.id === idArticle) : null;
  const m = modal(`
    <div class="boite-t">${art ? 'Modifier l\'article' : 'Nouvel article'}<button class="btn-icon" id="m-fermer">✕</button></div>
    <div class="boite-c">
      <div class="champ2">
        <div class="champ"><label>Code (optionnel)</label><input type="text" id="ar-code" value="${esc(art?.code || '')}" placeholder="ex : ART-001"></div>
        <div class="champ"><label>Catégorie</label>
          <select id="ar-cat">
            <option value="">— Aucune —</option>
            ${cats.map(c => `<option value="${c.id}" ${art?.categorieId === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="champ"><label>Désignation *</label><input type="text" id="ar-desig" value="${esc(art?.designation || '')}" placeholder="ex : Ramette papier A4"></div>
      <div class="champ2">
        <div class="champ"><label>Unité de mesure</label><input type="text" id="ar-unite" value="${esc(art?.unite || '')}" list="unites">
          <datalist id="unites">${UNITE_SUGGEREES.map(u => `<option value="${u}">`).join('')}</datalist>
        </div>
        <div class="champ"><label>Seuil d'alerte (stock bas)</label><input type="number" id="ar-seuil" min="0" step="1" value="${art?.seuil ?? 0}"></div>
      </div>
      <div class="champ"><label>Notes (optionnel)</label><textarea id="ar-notes" rows="2">${esc(art?.notes || '')}</textarea></div>
      <p class="muted">Le stock est calculé automatiquement à partir des entrées et des sorties ; il ne se modifie pas directement.</p>
    </div>
    <div class="boite-p">
      <button class="btn secondaire" id="m-annuler">Annuler</button>
      <button class="btn" id="m-enregistrer">💾 Enregistrer</button>
    </div>`);
  const fermer = () => m.fermer();
  m.voile.querySelector('#m-fermer').onclick = fermer;
  m.voile.querySelector('#m-annuler').onclick = fermer;
  m.voile.querySelector('#m-enregistrer').onclick = async () => {
    const b = m.voile;
    try {
      await req('saveArticle', {
        id: art?.id,
        code: b.querySelector('#ar-code').value,
        designation: b.querySelector('#ar-desig').value,
        categorieId: b.querySelector('#ar-cat').value,
        unite: b.querySelector('#ar-unite').value,
        seuil: b.querySelector('#ar-seuil').value,
        notes: b.querySelector('#ar-notes').value
      });
      toast(art ? 'Article modifié.' : 'Article créé.');
      fermer();
      go('articles');
    } catch (e) { /* toast déjà affiché */ }
  };
}

async function supprimerArticle(id) {
  const art = state.articlesCache.find(a => a.id === id);
  if (!(await confirmDlg(`Supprimer l'article « ${art?.designation} » ? Cette action est définitive.`, 'Supprimer un article'))) return;
  try {
    await req('deleteArticle', { id });
    toast('Article supprimé.');
    go('articles');
  } catch (e) { /* message serveur dans le toast */ }
}

/* ---------- Catégories ---------- */

function gererCategories() {
  req('listCategories').then(cats => {
    const m = modal(`
      <div class="boite-t">Gérer les catégories<button class="btn-icon" id="c-fermer">✕</button></div>
      <div class="boite-c">
        <div style="display:flex;gap:8px">
          <input type="text" id="cat-nom" placeholder="Nouvelle catégorie…" style="flex:1">
          <button class="btn petit" id="cat-ajout">＋ Ajouter</button>
        </div>
        <div class="liste-cats" id="cat-liste"></div>
      </div>`);
    m.voile.querySelector('#c-fermer').onclick = m.fermer;
    const maj = (liste) => {
      m.voile.querySelector('#cat-liste').innerHTML = liste.map(c => `
        <div class="ligne-cat" data-id="${c.id}">
          <span>${esc(c.nom)}</span>
          <span>
            <button class="btn-icon danger" title="Supprimer" data-act="supprCat" data-arg="${c.id}">🗑️</button>
          </span>
        </div>`).join('') || '<p class="muted">Aucune catégorie.</p>';
    };
    maj(liste);
    m.voile.querySelector('#cat-ajout').onclick = async () => {
      try { maj(await req('saveCategory', { nom: m.voile.querySelector('#cat-nom').value })); m.voile.querySelector('#cat-nom').value = ''; }
      catch (e) { }
    };
  });
}

async function supprCat(id) {
  try {
    await req('deleteCategory', { id });
    toast('Catégorie supprimée.');
    gererCategories();
  } catch (e) { }
}

/* ============================ Vue : Sources ============================ */

async function vueSources() {
  const sources = await req('listSources');
  $('#contenu').innerHTML = `
    <div class="barre-haut">
      <div class="gauche muted">Fournisseurs et marchés d'où le magasin reçoit les articles.</div>
      <button class="btn" data-act="modalSource">＋ Nouvelle source</button>
    </div>
    <div class="efface"><table style="width:100%">
      <thead><tr><th>Nom</th><th>Type</th><th>Contact</th><th>Téléphone</th><th>Adresse</th><th class="actions">Actions</th></tr></thead>
      <tbody>${sources.length
      ? sources.map(s => `<tr>
          <td><b>${esc(s.nom)}</b></td>
          <td><span class="badge ${s.type}">${s.type === 'fournisseur' ? 'Fournisseur' : 'Marché'}</span></td>
          <td>${esc(s.contact || '—')}</td><td>${esc(s.telephone || '—')}</td><td>${esc(s.adresse || '—')}</td>
          <td class="actions">
            <button class="btn-icon" data-act="modalSource" data-arg="${s.id}">✏️</button>
            <button class="btn-icon danger" data-act="supprimerSource" data-arg="${s.id}">🗑️</button>
          </td></tr>`).join('')
      : '<tr><td colspan="6" class="vide">Aucune source enregistrée.</td></tr>'}
      </tbody></table></div>`;
  state.sourcesCache = sources;
}

function modalSource(idSource) {
  const s = (state.sourcesCache || []).find(x => x.id === idSource);
  const m = modal(`
    <div class="boite-t">${s ? 'Modifier la source' : 'Nouvelle source'}<button class="btn-icon" id="s-fermer">✕</button></div>
    <div class="boite-c">
      <div class="champ2">
        <div class="champ"><label>Nom *</label><input type="text" id="s-nom" value="${esc(s?.nom || '')}"></div>
        <div class="champ"><label>Type *</label>
          <select id="s-type">
            <option value="fournisseur" ${s?.type === 'fournisseur' || !s ? 'selected' : ''}>Fournisseur</option>
            <option value="marche" ${s?.type === 'marche' ? 'selected' : ''}>Marché</option>
          </select>
        </div>
      </div>
      <div class="champ2">
        <div class="champ"><label>Contact</label><input type="text" id="s-contact" value="${esc(s?.contact || '')}"></div>
        <div class="champ"><label>Téléphone</label><input type="text" id="s-tel" value="${esc(s?.telephone || '')}"></div>
      </div>
      <div class="champ"><label>Adresse</label><input type="text" id="s-adresse" value="${esc(s?.adresse || '')}"></div>
    </div>
    <div class="boite-p">
      <button class="btn secondaire" id="s-annuler">Annuler</button>
      <button class="btn" id="s-ok">💾 Enregistrer</button>
    </div>`);
  m.voile.querySelector('#s-fermer').onclick = m.fermer;
  m.voile.querySelector('#s-annuler').onclick = m.fermer;
  m.voile.querySelector('#s-ok').onclick = async () => {
    const b = m.voile;
    try {
      await req('saveSource', {
        id: s?.id, nom: b.querySelector('#s-nom').value, type: b.querySelector('#s-type').value,
        contact: b.querySelector('#s-contact').value, telephone: b.querySelector('#s-tel').value,
        adresse: b.querySelector('#s-adresse').value
      });
      toast('Source enregistrée.');
      m.fermer();
      go('sources');
    } catch (e) { }
  };
}

async function supprimerSource(id) {
  if (!(await confirmDlg('Supprimer cette source ?', 'Supprimer'))) return;
  try { await req('deleteSource', { id }); toast('Source supprimée.'); go('sources'); } catch (e) { }
}

/* ============================ Vue : Départements ============================ */

async function vueDepartements() {
  const deps = await req('listDepartements');
  state.depsCache = deps;
  $('#contenu').innerHTML = `
    <div class="barre-haut">
      <div class="gauche muted">Départements de l'entreprise auxquels le magasin distribue les articles.</div>
      <button class="btn" data-act="modalDepartement">＋ Nouveau département</button>
    </div>
    <div class="efface"><table style="width:100%">
      <thead><tr><th>Nom</th><th>Responsable</th><th class="actions">Actions</th></tr></thead>
      <tbody>${deps.length
      ? deps.map(d => `<tr>
          <td><b>${esc(d.nom)}</b></td><td>${esc(d.responsable || '—')}</td>
          <td class="actions">
            <button class="btn-icon" data-act="modalDepartement" data-arg="${d.id}">✏️</button>
            <button class="btn-icon danger" data-act="supprimerDepartement" data-arg="${d.id}">🗑️</button>
          </td></tr>`).join('')
      : '<tr><td colspan="3" class="vide">Aucun département enregistré.</td></tr>'}
      </tbody></table></div>`;
}

function modalDepartement(idDep) {
  const d = (state.depsCache || []).find(x => x.id === idDep);
  const m = modal(`
    <div class="boite-t">${d ? 'Modifier le département' : 'Nouveau département'}<button class="btn-icon" id="d-fermer">✕</button></div>
    <div class="boite-c">
      <div class="champ"><label>Nom *</label><input type="text" id="d-nom" value="${esc(d?.nom || '')}" placeholder="ex : Comptabilité"></div>
      <div class="champ"><label>Responsable</label><input type="text" id="d-resp" value="${esc(d?.responsable || '')}"></div>
    </div>
    <div class="boite-p">
      <button class="btn secondaire" id="d-annuler">Annuler</button>
      <button class="btn" id="d-ok">💾 Enregistrer</button>
    </div>`);
  m.voile.querySelector('#d-fermer').onclick = m.fermer;
  m.voile.querySelector('#d-annuler').onclick = m.fermer;
  m.voile.querySelector('#d-ok').onclick = async () => {
    const b = m.voile;
    try {
      await req('saveDepartement', { id: d?.id, nom: b.querySelector('#d-nom').value, responsable: b.querySelector('#d-resp').value });
      toast('Département enregistré.');
      m.fermer();
      go('departements');
    } catch (e) { }
  };
}

async function supprimerDepartement(id) {
  if (!(await confirmDlg('Supprimer ce département ?', 'Supprimer'))) return;
  try { await req('deleteDepartement', { id }); toast('Département supprimé.'); go('departements'); } catch (e) { }
}

/* ============================ Bons : formulaire commun ============================ */

let bonCtx = null; // { mode: 'entree'|'sortie', articles, stockById, bon (si modif) }

function ligneBonHtml(l) {
  const { mode, articles, stockById } = bonCtx;
  const avecStock = mode === 'sortie';
  const opts = articles.map(a => {
    const dispo = avecStock ? ` (dispo : ${fmtQty(stockById[a.id] || 0)})` : '';
    return `<option value="${a.id}" ${l.articleId === a.id ? 'selected' : ''}>${esc(a.code ? a.code + ' — ' : '')}${esc(a.designation)}${esc(dispo)}</option>`;
  }).join('');
  return `<tr>
    <td style="width:55%">
      <select class="ligne-article"><option value="">— Choisir un article —</option>${opts}</select>
    </td>
    <td><input type="number" class="ligne-qty" min="0" step="0.01" placeholder="Qté" value="${l.quantite ?? ''}"></td>
    ${avecStock ? '<td class="ligne-dispo muted"></td>' : ''}
    <td style="width:40px"><button class="btn-icon danger" data-act="removeTr">✕</button></td>
  </tr>`;
}

function majDispoLigne(select) {
  const tr = select.closest('tr');
  const cell = tr.querySelector('.ligne-dispo');
  if (cell && bonCtx?.stockById) {
    const val = bonCtx.stockById[select.value] || 0;
    cell.textContent = select.value ? `dispo : ${fmtQty(val)}` : '';
  }
}

async function vueEntreeForm(id) { await formBon('entree', id || null); }
async function vueSortieForm(id) { await formBon('sortie', id || null); }

async function formBon(mode, idBon) {
  const articles = await req('listArticles');
  let bon = null, partenaires = [], stockById = {};
  if (mode === 'entree') {
    partenaires = await req('listSources');
    if (idBon) bon = (await req('listEntrees')).find(b => b.id === idBon) || null;
  } else {
    partenaires = await req('listDepartements');
    const stock = await req('getStock');
    stockById = Object.fromEntries(stock.map(a => [a.id, a.stock]));
    if (idBon) bon = (await req('listSorties')).find(b => b.id === idBon) || null;
  }
  bonCtx = { mode, articles, stockById, bon };

  const avecStock = mode === 'sortie';
  const labelPartenaire = mode === 'entree' ? 'Source (fournisseur / marché) *' : 'Département destinataire *';
  const nomPartenaire = mode === 'entree' ? 'sourceId' : 'departementId';
  const titre = bon ? `Modifier le bon — ${mode === 'entree' ? 'réception' : 'distribution'}` : (mode === 'entree' ? '📥 Nouvelle réception' : '📤 Nouvelle distribution');

  const lignesInit = bon ? bon.lignes.map(l => ({ articleId: l.articleId, quantite: l.quantite })) : [{}];

  $('#contenu').innerHTML = `
    <button class="retour" data-act="go" data-arg="${mode}s">← Retour à la liste</button>
    <div class="carte form-bon">
      <h3>${titre}</h3>
      <div class="entete-bon">
        <div class="champ"><label>Date *</label><input type="date" id="b-date" value="${esc(bon?.date || todayISO())}"></div>
        <div class="champ" id="b-zone-part"><label>${labelPartenaire}</label>
          <select id="b-part">
            <option value="">— Choisir —</option>
            ${partenaires.map(p => `<option value="${p.id}" ${bon && bon[nomPartenaire] === p.id ? 'selected' : ''}>${esc(p.nom)}</option>`).join('')}
          </select>
        </div>
        <div class="champ"><label>Référence du bon</label><input type="text" id="b-ref" value="${esc(bon?.reference || '')}" placeholder="ex : BR-2024-001"></div>
        <div class="champ"><label>Notes</label><input type="text" id="b-notes" value="${esc(bon?.notes || '')}"></div>
        ${mode === 'sortie' ? `
        <div class="champ" style="grid-column:1/-1">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;color:var(--texte);cursor:pointer;margin:0">
            <input type="checkbox" id="b-dest" ${bon?.type === 'destruction' ? 'checked' : ''}>
            🧨 Destruction d'articles (périmés, abîmés, hors service…)
          </label>
          <div class="muted" id="b-dest-note" style="margin-top:4px">Cochez si les articles sont <b>détruits physiquement</b> et retirés du stock sans être remis à un département.</div>
        </div>` : ''}
      </div>
      <div class="carte lignes" style="margin:14px 0 0;padding:14px">
        <h3>Articles ${mode === 'entree' ? 'reçus' : 'distribués'}</h3>
        <table style="width:100%"><thead><tr>
          <th style="width:55%">Article</th><th>Quantité ${mode === 'entree' ? 'reçue' : 'distribuée'}</th>${avecStock ? '<th>Disponible</th>' : ''}<th></th>
        </tr></thead><tbody id="bl"></tbody></table>
        <button class="btn secondaire petit" id="b-ajout" style="margin-top:10px">＋ Ajouter une ligne</button>
        ${avecStock ? '<p class="muted" style="margin-top:8px">La quantité distribuée ne peut pas dépasser le stock disponible — la vérification est faite à l\'enregistrement.</p>' : ''}
      </div>
      <div class="actions-bon">
        <button class="btn secondaire" data-act="go" data-arg="${mode}s">Annuler</button>
        <button class="btn" id="b-enregistrer">💾 Enregistrer le bon</button>
      </div>
    </div>`;

  const tbody = $('#bl');
  const ajouterLigne = (l = {}) => {
    tbody.insertAdjacentHTML('beforeend', ligneBonHtml(l));
    const tr = tbody.lastElementChild;
    const sel = tr.querySelector('.ligne-article');
    if (avecStock) majDispoLigne(sel);
    sel.onchange = () => { if (avecStock) majDispoLigne(sel); };
  };
  lignesInit.forEach(ajouterLigne);
  $('#b-ajout').onclick = () => ajouterLigne();
  const cbDest = $('#b-dest');
  if (cbDest) {
    const majDest = () => { $('#b-zone-part').style.display = cbDest.checked ? 'none' : ''; };
    cbDest.onchange = majDest;
    majDest();
  }
  $('#b-enregistrer').onclick = () => enregistrerBon();
}

async function enregistrerBon() {
  const { mode, bon } = bonCtx;
  const lignes = $$('#bl tr').map(tr => {
    const articleId = tr.querySelector('.ligne-article').value;
    const quantite = tr.querySelector('.ligne-qty').value;
    return articleId ? { articleId, quantite: Number(quantite) || 0 } : null;
  }).filter(Boolean);
  if (!lignes.length) { toast('Ajoutez au moins un article au bon.', 'error'); return; }
  const destruction = mode === 'sortie' && !!$('#b-dest')?.checked;
  const payload = {
    id: bon?.id,
    date: $('#b-date').value,
    reference: $('#b-ref').value,
    notes: $('#b-notes').value,
    lignes
  };
  if (mode === 'entree') payload.sourceId = $('#b-part').value;
  else {
    payload.type = destruction ? 'destruction' : 'distribution';
    payload.departementId = destruction ? '' : $('#b-part').value;
  }
  try {
    await req(mode === 'entree' ? 'saveEntree' : 'saveSortie', payload);
    toast(bon ? 'Bon modifié.' : destruction ? 'Destruction enregistrée. Stock mis à jour.' : 'Bon enregistré. Stock mis à jour.', 'success');
    go(mode + 's');
  } catch (e) { }
}

/* ============================ Vue : Entrées ============================ */

async function vueEntrees() {
  const [sources, bons] = await Promise.all([req('listSources'), req('listEntrees', state.filtresEntrees)]);
  const f = state.filtresEntrees;
  $('#contenu').innerHTML = `
    <div class="barre-haut">
      <div class="gauche">
        <select id="e-cat" style="width:220px">
          <option value="">Toutes les sources</option>
          ${sources.map(s => `<option value="${s.id}" ${f.sourceId === s.id ? 'selected' : ''}>${esc(s.nom)}</option>`).join('')}
        </select>
        <input type="date" id="e-from" value="${esc(f.from)}"> <span class="muted">→</span> <input type="date" id="e-to" value="${esc(f.to)}">
      </div>
      <button class="btn" data-act="go" data-arg="entreeForm">📥 Nouvelle réception</button>
    </div>
    <div class="efface"><table style="width:100%">
      <thead><tr><th>Date</th><th>Référence</th><th>Source</th><th>Articles</th><th class="num">Qté totale</th><th class="actions">Actions</th></tr></thead>
      <tbody id="e-body"></tbody></table></div>`;
  $('#e-cat').onchange = e => { f.sourceId = e.target.value; majListEntrees(); };
  $('#e-from').onchange = e => { f.from = e.target.value; majListEntrees(); };
  $('#e-to').onchange = e => { f.to = e.target.value; majListEntrees(); };
  majListEntrees();
}

async function majListEntrees() {
  const bons = await req('listEntrees', state.filtresEntrees);
  $('#e-body').innerHTML = bons.length
    ? bons.map(b => `<tr>
        <td>${fmtDate(b.date)}</td>
        <td>${esc(b.reference || '—')}</td>
        <td>${esc(b.sourceNom)}</td>
        <td class="muted">${b.lignes.map(l => esc(l.designation)).join(', ')}</td>
        <td class="num"><b>${fmtQty(b.totalQte)}</b></td>
        <td class="actions">
          <button class="btn-icon" title="Détails" data-act="detailEntree" data-arg="${b.id}">👁️</button>
          <button class="btn-icon" title="Modifier" data-act="go" data-arg="entreeForm" data-arg2="${b.id}">✏️</button>
          <button class="btn-icon danger" title="Supprimer" data-act="supprimerEntree" data-arg="${b.id}">🗑️</button>
        </td></tr>`).join('')
    : '<tr><td colspan="6" class="vide">Aucune réception pour ces critères.</td></tr>';
}

function detailEntree(id) {
  req('listEntrees', state.filtresEntrees).then(liste => {
    const bon = liste.find(x => x.id === id);
    if (!bon) return;
    modal(`
      <div class="boite-t">Bon de réception ${esc(bon.reference || '')}<button class="btn-icon" data-act="closeModal">✕</button></div>
      <div class="boite-c detail-bon">
        <dl>
          <dt>Date</dt><dd>${fmtDate(bon.date)}</dd>
          <dt>Source</dt><dd>${esc(bon.sourceNom)} ${bon.sourceType ? `<span class="badge ${bon.sourceType}">${bon.sourceType === 'fournisseur' ? 'Fournisseur' : 'Marché'}</span>` : ''}</dd>
          ${bon.notes ? `<dt>Notes</dt><dd>${esc(bon.notes)}</dd>` : ''}
        </dl>
        <table style="width:100%"><thead><tr><th>Article</th><th class="num">Quantité reçue</th></tr></thead>
        <tbody>${bon.lignes.map(l => `<tr><td>${l.code ? esc(l.code) + ' — ' : ''}${esc(l.designation)}</td><td class="num">${fmtQty(l.quantite)} ${esc(l.unite)}</td></tr>`).join('')}</tbody></table>
      </div>`);
  });
}

async function supprimerEntree(id) {
  if (!(await confirmDlg('Supprimer ce bon de réception ? Le stock des articles concernés sera ajusté.', 'Supprimer le bon'))) return;
  try { await req('deleteEntree', { id }); toast('Bon supprimé, stock ajusté.'); go('entrees'); } catch (e) { }
}

/* ============================ Vue : Sorties ============================ */

async function vueSorties() {
  const [deps, bons] = await Promise.all([req('listDepartements'), req('listSorties', state.filtresSorties)]);
  const f = state.filtresSorties;
  $('#contenu').innerHTML = `
    <div class="barre-haut">
      <div class="gauche">
        <select id="s-cat" style="width:220px">
          <option value="">Tous les départements</option>
          ${deps.map(d => `<option value="${d.id}" ${f.departementId === d.id ? 'selected' : ''}>${esc(d.nom)}</option>`).join('')}
        </select>
        <input type="date" id="s-from" value="${esc(f.from)}"> <span class="muted">→</span> <input type="date" id="s-to" value="${esc(f.to)}">
      </div>
      <button class="btn" data-act="go" data-arg="sortieForm">📤 Nouvelle distribution</button>
    </div>
    <div class="efface"><table style="width:100%">
      <thead><tr><th>Date</th><th>Référence</th><th>Destinataire</th><th>Articles</th><th class="num">Qté totale</th><th class="actions">Actions</th></tr></thead>
      <tbody id="s-body"></tbody></table></div>`;
  $('#s-cat').onchange = e => { f.departementId = e.target.value; majListSorties(); };
  $('#s-from').onchange = e => { f.from = e.target.value; majListSorties(); };
  $('#s-to').onchange = e => { f.to = e.target.value; majListSorties(); };
  majListSorties();
}

async function majListSorties() {
  const bons = await req('listSorties', state.filtresSorties);
  $('#s-body').innerHTML = bons.length
    ? bons.map(b => `<tr>
        <td>${fmtDate(b.date)}</td>
        <td>${esc(b.reference || '—')}</td>
        <td>${b.type === 'destruction' ? '<span class="badge rouge">🧨 Destruction</span>' : esc(b.departementNom)}</td>
        <td class="muted">${b.lignes.map(l => esc(l.designation)).join(', ')}</td>
        <td class="num"><b>${fmtQty(b.totalQte)}</b></td>
        <td class="actions">
          <button class="btn-icon" title="Détails" data-act="detailSortie" data-arg="${b.id}">👁️</button>
          <button class="btn-icon" title="Modifier" data-act="go" data-arg="sortieForm" data-arg2="${b.id}">✏️</button>
          <button class="btn-icon danger" title="Supprimer" data-act="supprimerSortie" data-arg="${b.id}">🗑️</button>
        </td></tr>`).join('')
    : '<tr><td colspan="6" class="vide">Aucune distribution pour ces critères.</td></tr>';
}

function detailSortie(id) {
  req('listSorties', state.filtresSorties).then(liste => {
    const bon = liste.find(x => x.id === id);
    if (!bon) return;
    modal(`
      <div class="boite-t">Bon de distribution ${esc(bon.reference || '')}<button class="btn-icon" data-act="closeModal">✕</button></div>
      <div class="boite-c detail-bon">
        <dl>
          <dt>Date</dt><dd>${fmtDate(bon.date)}</dd>
          <dt>Destinataire</dt><dd>${bon.type === 'destruction' ? '<span class="badge rouge">🧨 Destruction</span> Articles retirés du stock' : esc(bon.departementNom)}</dd>
          ${bon.notes ? `<dt>Notes</dt><dd>${esc(bon.notes)}</dd>` : ''}
        </dl>
        <table style="width:100%"><thead><tr><th>Article</th><th class="num">Quantité distribuée</th></tr></thead>
        <tbody>${bon.lignes.map(l => `<tr><td>${l.code ? esc(l.code) + ' — ' : ''}${esc(l.designation)}</td><td class="num">${fmtQty(l.quantite)} ${esc(l.unite)}</td></tr>`).join('')}</tbody></table>
      </div>`);
  });
}

async function supprimerSortie(id) {
  if (!(await confirmDlg('Supprimer ce bon de distribution ? Le stock des articles concernés sera remis en magasin.', 'Supprimer le bon'))) return;
  try { await req('deleteSortie', { id }); toast('Bon supprimé, stock ajusté.'); go('sorties'); } catch (e) { }
}

/* ============================ Vue : Mouvements ============================ */

async function vueMouvements() {
  const articles = await req('listArticles');
  $('#contenu').innerHTML = `
    <div class="barre-haut">
      <div class="gauche">
        <select id="mv-type" style="width:170px">
          <option value="">Entrées + sorties</option>
          <option value="entree" ${state.filtresMv.type === 'entree' ? 'selected' : ''}>Entrées uniquement</option>
          <option value="sortie" ${state.filtresMv.type === 'sortie' ? 'selected' : ''}>Sorties uniquement</option>
          <option value="destruction" ${state.filtresMv.type === 'destruction' ? 'selected' : ''}>Destructions uniquement</option>
        </select>
        <select id="mv-article" style="width:230px">
          <option value="">Tous les articles</option>
          ${articles.map(a => `<option value="${a.id}" ${state.filtresMv.articleId === a.id ? 'selected' : ''}>${esc(a.designation)}</option>`).join('')}
        </select>
        <input type="date" id="mv-from" value="${esc(state.filtresMv.from)}">
      </div>
      <div class="gauche">
        <button class="btn secondaire petit" id="mv-csv">🧮 Export CSV</button>
        <button class="btn secondaire petit" id="mv-pdf">📄 Export PDF</button>
      </div>
    </div>
    <div class="efface"><table style="width:100%">
      <thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Article</th><th class="num">Quantité</th><th>Source / Département</th></tr></thead>
      <tbody id="mv-body"></tbody></table></div>`;
  $('#mv-type').onchange = e => { state.filtresMv.type = e.target.value; majMv(); };
  $('#mv-article').onchange = e => { state.filtresMv.articleId = e.target.value; majMv(); };
  $('#mv-from').onchange = e => { state.filtresMv.from = e.target.value; majMv(); };
  $('#mv-csv').onclick = () => exporterCsv(`mouvements-${todayISO()}.csv`,
    ['Date', 'Type', 'Référence', 'Article', 'Quantité', 'Unité', 'Source/Département'],
    state.lignesMouvements.map(m => [fmtDate(m.date), m.type === 'entree' ? 'Entrée' : (m.nature === 'destruction' ? 'Destruction' : 'Sortie'), m.reference, m.designation, m.quantite, m.unite, m.partenaire]));
  $('#mv-pdf').onclick = () => exporterPdf('Journal des mouvements', `mouvements-${todayISO()}.pdf`, htmlTableMv(state.lignesMouvements));
  majMv();
}

function htmlTableMv(rows) {
  return `<table><thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Article</th><th class="num">Quantité</th><th>Source / Département</th></tr></thead>
    <tbody>${rows.map(m => `<tr><td>${fmtDate(m.date)}</td>
      <td><b style="color:${m.type === 'entree' ? '#16a34a' : (m.nature === 'destruction' ? '#dc2626' : '#2563eb')}">${m.type === 'entree' ? '↓ Entrée' : (m.nature === 'destruction' ? '🧨 Destruction' : '↑ Sortie')}</b></td>
      <td>${esc(m.reference)}</td><td>${esc(m.code ? m.code + ' — ' : '')}${esc(m.designation)}</td>
      <td class="num">${fmtQty(m.quantite)} ${esc(m.unite)}</td><td>${esc(m.partenaire)}</td></tr>`).join('')}
    </tbody></table><p class="sans">${rows.length} mouvement(s)</p>`;
}

async function majMv() {
  const f = state.filtresMv;
  const rows = await req('getMouvements', { from: f.from || '', to: '', type: f.type || '', articleId: f.articleId || '' });
  state.lignesMouvements = rows;
  $('#mv-body').innerHTML = rows.length
    ? rows.map(m => `<tr>
        <td>${fmtDate(m.date)}</td>
        <td>${m.type === 'entree' ? '<span class="badge entree">↓ Entrée</span>' : (m.nature === 'destruction' ? '<span class="badge rouge">🧨 Destruction</span>' : '<span class="badge sortie">↑ Sortie</span>')}</td>
        <td>${esc(m.reference || '—')}</td>
        <td>${m.code ? esc(m.code) + ' — ' : ''}${esc(m.designation)}</td>
        <td class="num"><b>${fmtQty(m.quantite)}</b> ${esc(m.unite)}</td>
        <td>${esc(m.partenaire)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="vide">Aucun mouvement pour ces critères.</td></tr>';
}

/* ============================ Vue : Rapports ============================ */

const RAPPORTS = [
  { id: 'stock', label: 'État du stock actuel', periode: false },
  { id: 'departements', label: 'Consommation par département (sorties)', periode: true },
  { id: 'sources', label: 'Réceptions par source (entrées)', periode: true },
  { id: 'mouvements', label: 'Journal des mouvements', periode: true, filtreArticle: true }
];

async function vueRapports() {
  const articles = await req('listArticles');
  state.rapport = null;
  $('#contenu').innerHTML = `
    <div class="carte">
      <h3>Paramètres du rapport</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div><label>Type de rapport</label>
          <select id="rap-type">${RAPPORTS.map(r => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select>
        </div>
        <div id="rap-zone-periode" style="display:none">
          <label>Période (date de début → date de fin)</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="date" id="rap-from"><span class="muted">→</span><input type="date" id="rap-to">
          </div>
        </div>
        <div id="rap-zone-article" style="display:none">
          <label>Article</label>
          <select id="rap-article" style="width:220px"><option value="">Tous les articles</option>
            ${articles.map(a => `<option value="${a.id}">${esc(a.designation)}</option>`).join('')}
          </select>
        </div>
        <button class="btn" id="rap-gen">▶ Générer</button>
      </div>
    </div>
    <div id="rap-resultat"><p class="muted">Choisissez un rapport puis cliquez sur « Générer ».</p></div>`;
  $('#rap-type').onchange = majZonesRapport;
  majZonesRapport();
  $('#rap-gen').onclick = genererRapport;
}

function majZonesRapport() {
  const r = RAPPORTS.find(x => x.id === $('#rap-type').value);
  $('#rap-zone-periode').style.display = r.periode ? '' : 'none';
  $('#rap-zone-article').style.display = r.filtreArticle ? '' : 'none';
}

async function genererRapport() {
  const type = $('#rap-type').value;
  const from = $('#rap-from').value || '';
  const to = $('#rap-to').value || '';
  let data;
  if (type === 'stock') {
    const rows = await req('getStock', {});
    data = {
      titre: 'État du stock actuel',
      csv: `etat-stock-${todayISO()}.csv`,
      pdf: `etat-stock-${todayISO()}.pdf`,
      entetes: ['Code', 'Désignation', 'Catégorie', 'Unité', 'Stock', "Seuil d'alerte"],
      lignesCsv: rows.map(a => [a.code, a.designation, a.categorie, a.unite, a.stock, a.seuil]),
      corps: tableauRapport(['Code', 'Désignation', 'Catégorie', 'Unité', 'Stock', "Seuil d'alerte"],
        rows.map(a => ({ cells: [a.code || '', a.designation, a.categorie || '—', a.unite || '—', fmtQty(a.stock), fmtQty(a.seuil)], droit: [4, 5] })),
        [4, 5]),
      note: `${rows.length} article(s) — stock = entrées cumulées − sorties cumulées.`
    };
  } else if (type === 'departements') {
    if (!from || !to) { toast('Indiquez la période (dates de début et de fin).', 'error'); return; }
    const r = await req('rapportParDepartement', { from, to });
    data = {
      titre: 'Consommation par département ' + entetesRapportPeriode(from, to),
      csv: `consommation-departements-${from}_${to}.csv`,
      pdf: `consommation-departements-${from}_${to}.pdf`,
      entetes: ['Département', 'Article', 'Unité', 'Quantité'],
      lignesCsv: r.rows.map(x => [x.departement, x.designation, x.unite, x.quantite ?? `Total : ${x.total}`]),
      corps: tableauRapportGroupe(['Département', 'Article', 'Unité', 'Quantité'], r.rows),
      note: `${r.nbBons} bon(s) · ${fmtQty(r.totalQuantite)} unités distribuées.`
    };
  } else if (type === 'sources') {
    if (!from || !to) { toast('Indiquez la période (dates de début et de fin).', 'error'); return; }
    const r = await req('rapportParSource', { from, to });
    data = {
      titre: 'Réceptions par source ' + entetesRapportPeriode(from, to),
      csv: `receptions-sources-${from}_${to}.csv`,
      pdf: `receptions-sources-${from}_${to}.pdf`,
      entetes: ['Source', 'Article', 'Unité', 'Quantité reçue'],
      lignesCsv: r.rows.map(x => [x.source, x.designation, x.unite, x.quantite ?? `Total : ${x.total}`]),
      corps: tableauRapportGroupe(['Source', 'Article', 'Unité', 'Quantité reçue'], r.rows),
      note: `${r.nbBons} bon(s) · ${fmtQty(r.totalQuantite)} unités reçues.`
    };
  } else if (type === 'mouvements') {
    const articleId = $('#rap-article').value;
    const rows = await req('getMouvements', { from, to, type: '', articleId });
    data = {
      titre: 'Journal des mouvements ' + entetesRapportPeriode(from, to),
      csv: `mouvements-${todayISO()}.csv`,
      pdf: `mouvements-${todayISO()}.pdf`,
      entetes: ['Date', 'Type', 'Référence', 'Article', 'Quantité', 'Unité', 'Source/Département'],
      lignesCsv: rows.map(m => [fmtDate(m.date), m.type === 'entree' ? 'Entrée' : (m.nature === 'destruction' ? 'Destruction' : 'Sortie'), m.reference, m.designation, m.quantite, m.unite, m.partenaire]),
      corps: tableauRapport(['Date', 'Type', 'Référence', 'Article', 'Quantité', 'Unité', 'Source/Département'],
        rows.map(m => ({
          cells: [fmtDate(m.date), m.type === 'entree' ? '↓ Entrée' : (m.nature === 'destruction' ? '🧨 Destruction' : '↑ Sortie'), m.reference || '', (m.code ? m.code + ' — ' : '') + m.designation, fmtQty(m.quantite), m.unite || '', m.partenaire],
          droit: [4, 5]
        })),
        [4, 5]),
      note: `${rows.length} mouvement(s).`
    };
  } else return;
  state.rapport = data;
  afficherRapport(data);
}

function tableauRapport(entetes, lignes, colsDroits = []) {
  return `<table style="width:100%"><thead><tr>${entetes.map((h, i) => `<th class="${colsDroits.includes(i) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${lignes.map(l => `<tr>${l.cells.map((c, i) => `<td class="${(l.droit || []).includes(i) ? 'num' : ''}">${esc(c) || '&nbsp;'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function tableauRapportGroupe(entetes, rows) {
  return `<table style="width:100%"><thead><tr>${entetes.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(x => x.quantite === null
    ? `<tr class="grp"><td>${esc(x.departement || x.source)}</td><td colspan="2" style="text-align:right">Total</td><td class="num">${fmtQty(x.total)}</td></tr>`
    : `<tr><td>${esc(x.departement || x.source)}</td><td>${esc(x.designation)}</td><td>${esc(x.unite)}</td><td class="num">${fmtQty(x.quantite)}</td></tr>`).join('')}
    </tbody></table>`;
}

function entetesRapportPeriode(from, to) {
  return from && to ? `(du ${fmtDate(from)} au ${fmtDate(to)})` : '';
}

function afficherRapport(data) {
  $('#rap-resultat').innerHTML = `
    <div class="carte">
      <h3>${esc(data.titre)}</h3>
      <div style="overflow-x:auto">${data.corps}</div>
      <div class="totaux-rapport">${esc(data.note)}</div>
      <div class="barre-haut" style="margin-top:14px;justify-content:flex-start">
        <button class="btn secondaire petit" id="rap-csv">🧮 Exporter CSV</button>
        <button class="btn petit" id="rap-pdf">📄 Exporter PDF</button>
      </div>
    </div>`;
  $('#rap-csv').onclick = () => exporterCsv(data.csv, data.entetes, data.lignesCsv);
  $('#rap-pdf').onclick = () => exporterPdf(data.titre, data.pdf, data.corps + `<p class="sans">${esc(data.note)}</p>`);
}

/* ============================ Vue : Paramètres ============================ */

async function vueParametres() {
  const info = await req('getAppInfo');
  $('#contenu').innerHTML = `
    <div class="carte">
      <h3>💾 Données</h3>
      <p class="muted" style="margin-bottom:6px">Les données sont stockées localement dans ce fichier :</p>
      <p style="font-family:Consolas,monospace;font-size:12px;background:var(--bg);padding:10px;border-radius:8px;word-break:break-all">${esc(info.dbPath)}</p>
      <div class="barre-haut" style="margin-top:14px;justify-content:flex-start">
        <button class="btn secondaire" id="p-sauvegarder">💾 Sauvegarder les données</button>
        <button class="btn secondaire" id="p-restaurer">♻️ Restaurer une sauvegarde</button>
      </div>
      <p class="muted">Faites une sauvegarde régulière (par ex. chaque fin de semaine) sur une clé USB ou le réseau de l'entreprise.</p>
    </div>
    <div class="carte">
      <h3>🧪 Outils</h3>
      <div class="barre-haut" style="margin:0;justify-content:flex-start">
        <button class="btn secondaire" id="p-demo">Charger des données de démonstration</button>
        <button class="btn danger" id="p-reset">Tout réinitialiser</button>
      </div>
      <p class="muted" style="margin-top:10px">La démonstration ne peut se charger que si aucune donnée n'existe encore.</p>
    </div>
    <div class="carte">
      <h3>ℹ️ À propos</h3>
      <p class="muted">Gestion de Stock Interne — version ${esc(info.version)}<br>
      Reçoit des articles provenant de fournisseurs et de marchés, les distribue aux départements de l'entreprise.<br>
      Aucun achat, aucune vente : uniquement les mouvements internes du magasin.</p>
    </div>`;
  $('#p-sauvegarder').onclick = async () => {
    try {
      const r = await req('backup');
      if (r && r.filePath) toast('Sauvegarde enregistrée : ' + r.filePath);
    } catch (e) { }
  };
  $('#p-restaurer').onclick = async () => {
    if (!(await confirmDlg('Restaurer une sauvegarde ? Les données actuelles seront REMPLACÉES ?', 'Restaurer'))) return;
    try {
      const r = await req('restore');
      if (r && !r.canceled) { toast(`Restauration terminée : ${r.articles} articles, ${r.entrees} réceptions, ${r.sorties} distributions.`); go('dashboard'); }
    } catch (e) { }
  };
  $('#p-demo').onclick = async () => {
    if (!(await confirmDlg('Charger des données de démonstration (articles, départements, bons) ?', 'Démonstration'))) return;
    try {
      await req('seedDemo');
      toast('Données de démonstration chargées.'); go('dashboard');
    } catch (e) { }
  };
  $('#p-reset').onclick = async () => {
    if (!(await confirmDlg('⚠️ ATTENTION : toutes les données (articles, bons, départements…) seront définitivement supprimées. Continuer ?', 'Réinitialiser'))) return;
    if (!(await confirmDlg('Confirmez une seconde fois : voulez-vous vraiment tout effacer ?', 'Réinitialiser'))) return;
    try { await req('resetAll'); toast('Données réinitialisées.'); go('dashboard'); } catch (e) { }
  };
}

/* ============================ Registre des vues ============================ */

const VUES = {
  dashboard: vueDashboard,
  stock: vueStock,
  articles: vueArticles,
  entrees: vueEntrees,
  sorties: vueSorties,
  entreeForm: vueEntreeForm,
  sortieForm: vueSortieForm,
  mouvements: vueMouvements,
  sources: vueSources,
  departements: vueDepartements,
  rapports: vueRapports,
  parametres: vueParametres
};

/* ============================ Répartiteur d'actions ============================
   Les boutons dynamically-générés portent des attributs data-act / data-arg
   (au lieu d'un onclick inline, bloqué par la politique de sécurité CSP).
   Un seul écouteur global traite tous les clics. */

const UI_ACTS = {
  go: (_el, vue, id) => go(vue, id),
  modalArticle: (_el, id) => modalArticle(id),
  supprimerArticle: (_el, id) => supprimerArticle(id),
  gererCategories: () => gererCategories(),
  supprCat: (_el, id) => supprCat(id),
  modalSource: (_el, id) => modalSource(id),
  supprimerSource: (_el, id) => supprimerSource(id),
  modalDepartement: (_el, id) => modalDepartement(id),
  supprimerDepartement: (_el, id) => supprimerDepartement(id),
  detailEntree: (_el, id) => detailEntree(id),
  supprimerEntree: (_el, id) => supprimerEntree(id),
  detailSortie: (_el, id) => detailSortie(id),
  supprimerSortie: (_el, id) => supprimerSortie(id),
  removeTr: (el) => el.closest('tr')?.remove(),
  closeModal: (el) => el.closest('.voile')?.remove()
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = UI_ACTS[el.dataset.act];
  if (!fn) return;
  const { act, arg, arg2 } = el.dataset;
  if (arg2 !== undefined) fn(el, arg, arg2);
  else if (arg !== undefined) fn(el, arg);
  else fn(el);
});

window.addEventListener('DOMContentLoaded', buildShell);
