'use strict';
/**
 * Couche de données de l'application "Gestion de Stock Interne".
 * Stockage : un simple fichier JSON (aucune base natif à compiler).
 * Toutes les règles métier sont validées ici (côté processus principal).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let FILE = null;
let DATA = null;

/* ============================= Utilitaires ============================= */

function fail(msg) {
  const e = new Error(msg);
  e.metier = true;
  throw e;
}

const id = () => crypto.randomUUID();

function empty() {
  return {
    meta: { created: new Date().toISOString() },
    categories: [],
    articles: [],
    sources: [],
    departements: [],
    entrees: [],
    sorties: []
  };
}

function init(file) {
  FILE = file;
  if (fs.existsSync(file)) {
    try {
      DATA = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      DATA = empty();
    }
  } else {
    DATA = empty();
  }
  const base = empty();
  for (const k of Object.keys(base)) {
    if (!(k in DATA)) DATA[k] = base[k];
  }
  save();
  return FILE;
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DATA, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function filePath() {
  return FILE;
}

/* ============================= Stock ============================= */

/** Stock par article = somme des entrées - somme des sorties. */
function stockMap(excludeEntreeId = null, excludeSortieId = null) {
  const m = new Map();
  const bump = (aid, q) => m.set(aid, (m.get(aid) || 0) + q);
  for (const b of DATA.entrees) {
    if (b.id === excludeEntreeId) continue;
    for (const l of b.lignes) bump(l.articleId, l.quantite);
  }
  for (const b of DATA.sorties) {
    if (b.id === excludeSortieId) continue;
    for (const l of b.lignes) bump(l.articleId, -l.quantite);
  }
  return m;
}

/** Fusionne les lignes d'un bon par article (doublons additionnés). */
function mergeLignes(lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) fail('Le bon doit contenir au moins un article.');
  const merged = new Map();
  for (const l of lignes) {
    const art = DATA.articles.find(a => a.id === l.articleId);
    if (!art) fail('Un des articles sélectionnés n\'existe plus. Rechargez la page et réessayez.');
    const q = Number(l.quantite);
    if (!Number.isFinite(q) || q <= 0) fail(`Quantité invalide pour l'article « ${art.designation} » (doit être supérieur à 0).`);
    merged.set(art.id, (merged.get(art.id) || 0) + q);
  }
  return [...merged.entries()].map(([articleId, quantite]) => ({ articleId, quantite }));
}

function verifStockDisponible(merged, dispoMap) {
  for (const l of merged) {
    const art = DATA.articles.find(a => a.id === l.articleId);
    const dispo = dispoMap.get(art.id) || 0;
    if (l.quantite > dispo) {
      fail(`Stock insuffisant pour « ${art.designation} » : disponible ${dispo} ${art.unite || ''}, demandé ${l.quantite}.`.replace(/\s+/g, ' '));
    }
  }
}

/* ============================= Catégories ============================= */

function listCategories() {
  return [...DATA.categories].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function saveCategory(p) {
  const nom = String(p.nom || '').trim();
  if (!nom) fail('Le nom de la catégorie est obligatoire.');
  const doublon = DATA.categories.find(c => c.nom.toLowerCase() === nom.toLowerCase() && c.id !== p.id);
  if (doublon) fail(`La catégorie « ${nom} » existe déjà.`);
  if (p.id) {
    const cat = DATA.categories.find(c => c.id === p.id);
    if (!cat) fail('Catégorie introuvable.');
    cat.nom = nom;
  } else {
    DATA.categories.push({ id: id(), nom });
  }
  save();
  return listCategories();
}

function deleteCategory(catId) {
  const utilise = DATA.articles.some(a => a.categorieId === catId);
  if (utilise) fail('Impossible de supprimer : cette catégorie est utilisée par des articles.');
  DATA.categories = DATA.categories.filter(c => c.id !== catId);
  save();
  return listCategories();
}

/* ============================= Articles ============================= */

function listArticles() {
  const cats = new Map(DATA.categories.map(c => [c.id, c.nom]));
  return [...DATA.articles]
    .sort((a, b) => a.designation.localeCompare(b.designation, 'fr'))
    .map(a => ({ ...a, categorie: cats.get(a.categorieId) || '' }));
}

function validerArticle(p) {
  const designation = String(p.designation || '').trim();
  if (!designation) fail('La désignation de l\'article est obligatoire.');
  const code = String(p.code || '').trim();
  if (code) {
    const doublon = DATA.articles.find(a => a.code.toLowerCase() === code.toLowerCase() && a.id !== p.id);
    if (doublon) fail(`Le code « ${code} » est déjà utilisé par un autre article.`);
  }
  if (p.categorieId && !DATA.categories.some(c => c.id === p.categorieId)) fail('Catégorie invalide.');
  return { code, designation, categorieId: p.categorieId || '', unite: String(p.unite || '').trim(), seuil: Math.max(0, Number(p.seuil) || 0), notes: String(p.notes || '').trim() };
}

function saveArticle(p) {
  const champs = validerArticle(p);
  if (p.id) {
    const art = DATA.articles.find(a => a.id === p.id);
    if (!art) fail('Article introuvable.');
    Object.assign(art, champs);
  } else {
    DATA.articles.push({ id: id(), ...champs, createdAt: new Date().toISOString() });
  }
  save();
  return listArticles();
}

function deleteArticle(articleId) {
  const utilise = DATA.entrees.some(b => b.lignes.some(l => l.articleId === articleId))
    || DATA.sorties.some(b => b.lignes.some(l => l.articleId === articleId));
  if (utilise) fail('Impossible de supprimer : cet article est utilisé dans des bons d\'entrée/sortie.');
  DATA.articles = DATA.articles.filter(a => a.id !== articleId);
  save();
  return listArticles();
}

/** Stock actuel de tous les articles (+ filtres simples). */
function getStock(f = {}) {
  const sm = stockMap();
  const cats = new Map(DATA.categories.map(c => [c.id, c.nom]));
  let rows = DATA.articles.map(a => ({
    ...a,
    categorie: cats.get(a.categorieId) || '',
    stock: sm.get(a.id) || 0
  }));
  const q = String(f.search || '').trim().toLowerCase();
  if (q) rows = rows.filter(a => (a.designation + ' ' + (a.code || '')).toLowerCase().includes(q));
  if (f.categorieId) rows = rows.filter(a => a.categorieId === f.categorieId);
  if (f.categorie) rows = rows.filter(a => a.categorie === f.categorie);
  if (f.masquerStockZero) rows = rows.filter(a => a.stock > 0);
  return rows.sort((a, b) => a.designation.localeCompare(b.designation, 'fr'));
}

/* ============================= Sources (fournisseurs / marchés) ============================= */

function listSources(f = {}) {
  let rows = [...DATA.sources];
  if (f.type) rows = rows.filter(s => s.type === f.type);
  return rows.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function saveSource(p) {
  const nom = String(p.nom || '').trim();
  if (!nom) fail('Le nom est obligatoire.');
  const type = p.type === 'marche' ? 'marche' : 'fournisseur';
  if (p.id) {
    const s = DATA.sources.find(x => x.id === p.id);
    if (!s) fail('Source introuvable.');
    Object.assign(s, { nom, type, contact: String(p.contact || '').trim(), telephone: String(p.telephone || '').trim(), adresse: String(p.adresse || '').trim() });
  } else {
    DATA.sources.push({ id: id(), nom, type, contact: String(p.contact || '').trim(), telephone: String(p.telephone || '').trim(), adresse: String(p.adresse || '').trim(), createdAt: new Date().toISOString() });
  }
  save();
  return listSources();
}

function deleteSource(sourceId) {
  const utilise = DATA.entrees.some(b => b.sourceId === sourceId);
  if (utilise) fail('Impossible de supprimer : cette source est utilisée dans des bons de réception.');
  DATA.sources = DATA.sources.filter(s => s.id !== sourceId);
  save();
  return listSources();
}

/* ============================= Départements ============================= */

function listDepartements() {
  return [...DATA.departements].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function saveDepartement(p) {
  const nom = String(p.nom || '').trim();
  if (!nom) fail('Le nom du département est obligatoire.');
  if (p.id) {
    const d = DATA.departements.find(x => x.id === p.id);
    if (!d) fail('Département introuvable.');
    Object.assign(d, { nom, responsable: String(p.responsable || '').trim() });
  } else {
    DATA.departements.push({ id: id(), nom, responsable: String(p.responsable || '').trim(), createdAt: new Date().toISOString() });
  }
  save();
  return listDepartements();
}

function deleteDepartement(depId) {
  const utilise = DATA.sorties.some(b => b.departementId === depId);
  if (utilise) fail('Impossible de supprimer : ce département est utilisé dans des bons de distribution.');
  DATA.departements = DATA.departements.filter(d => d.id !== depId);
  save();
  return listDepartements();
}

/* ============================= Entrées (réceptions) ============================= */

function validerBon(p, champPartenaire) {
  const date = String(p.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('La date du bon est obligatoire.');
  const part = p[champPartenaire];
  if (!part) fail(champPartenaire === 'sourceId' ? 'La source (fournisseur ou marché) est obligatoire.' : 'Le département destinataire est obligatoire.');
  return date;
}

function lignesAvecInfos(lignes) {
  const arts = new Map(DATA.articles.map(a => [a.id, a]));
  return lignes.map(l => {
    const a = arts.get(l.articleId) || {};
    return { articleId: l.articleId, quantite: l.quantite, designation: a.designation || '(article supprimé)', code: a.code || '', unite: a.unite || '' };
  });
}

function listEntrees(f = {}) {
  let rows = [...DATA.entrees];
  if (f.sourceId) rows = rows.filter(b => b.sourceId === f.sourceId);
  if (f.from) rows = rows.filter(b => b.date >= f.from);
  if (f.to) rows = rows.filter(b => b.date <= f.to);
  const srcs = new Map(DATA.sources.map(s => [s.id, s]));
  return rows
    .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')))
    .map(b => {
      const lignes = lignesAvecInfos(b.lignes);
      const s = srcs.get(b.sourceId);
      return {
        id: b.id, date: b.date, reference: b.reference || '', notes: b.notes || '',
        sourceId: b.sourceId,
        sourceNom: s ? s.nom : '(source supprimée)',
        sourceType: s ? s.type : '',
        lignes, totalQte: lignes.reduce((t, l) => t + l.quantite, 0)
      };
    });
}

function saveEntree(p) {
  const date = validerBon(p, 'sourceId');
  if (!DATA.sources.some(s => s.id === p.sourceId)) fail('Source introuvable.');
  const lignes = mergeLignes(p.lignes);
  const rec = { date: date, sourceId: p.sourceId, reference: String(p.reference || '').trim(), notes: String(p.notes || '').trim(), lignes };
  if (p.id) {
    const bon = DATA.entrees.find(b => b.id === p.id);
    if (!bon) fail('Bon de réception introuvable.');
    // Contrôle : le stock après modification ne doit pas être négatif
    const sm = stockMap(null, null);
    const avant = new Map();
    for (const l of bon.lignes) avant.set(l.articleId, (avant.get(l.articleId) || 0) + l.quantite);
    for (const l of lignes) {
      const stockFutur = (sm.get(l.articleId) || 0) - (avant.get(l.articleId) || 0) + l.quantite;
      if (stockFutur < 0) {
        const art = DATA.articles.find(a => a.id === l.articleId);
        fail(`Modification impossible : le stock de « ${art ? art.designation : l.articleId} » deviendrait négatif (${stockFutur}).`);
      }
    }
    Object.assign(bon, rec);
  } else {
    DATA.entrees.push({ id: id(), ...rec, createdAt: new Date().toISOString() });
  }
  save();
  return listEntrees({ sourceId: p.sourceId });
}

function deleteEntree(entreeId) {
  const bon = DATA.entrees.find(b => b.id === entreeId);
  if (!bon) fail('Bon de réception introuvable.');
  // Après suppression, le stock ne doit pas devenir négatif
  const sm = stockMap(entreeId, null);
  for (const l of bon.lignes) {
    if ((sm.get(l.articleId) || 0) < 0) {
      const art = DATA.articles.find(a => a.id === l.articleId);
      fail(`Suppression impossible : des articles de ce bon ont déjà été distribués. Le stock de « ${art ? art.designation : ''} » deviendrait négatif.`);
    }
  }
  DATA.entrees = DATA.entrees.filter(b => b.id !== entreeId);
  save();
}

/* ============================= Sorties (distributions) ============================= */

function listSorties(f = {}) {
  let rows = [...DATA.sorties];
  if (f.departementId) rows = rows.filter(b => b.departementId === f.departementId);
  if (f.from) rows = rows.filter(b => b.date >= f.from);
  if (f.to) rows = rows.filter(b => b.date <= f.to);
  const deps = new Map(DATA.departements.map(d => [d.id, d]));
  return rows
    .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')))
    .map(b => {
      const lignes = lignesAvecInfos(b.lignes);
      const d = deps.get(b.departementId);
      return {
        id: b.id, date: b.date, type: b.type || 'distribution', reference: b.reference || '', notes: b.notes || '',
        departementId: b.departementId,
        departementNom: (b.type || 'distribution') === 'destruction' ? '' : (d ? d.nom : '(département supprimé)'),
        lignes, totalQte: lignes.reduce((t, l) => t + l.quantite, 0)
      };
    });
}

function saveSortie(p) {
  const type = p.type === 'destruction' ? 'destruction' : 'distribution';
  const estDestruction = type === 'destruction';
  const date = String(p.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('La date du bon est obligatoire.');
  let departementId = null;
  if (!estDestruction) {
    if (!p.departementId) fail('Le département destinataire est obligatoire.');
    if (!DATA.departements.some(d => d.id === p.departementId)) fail('Département introuvable.');
    departementId = p.departementId;
  }
  const lignes = mergeLignes(p.lignes);
  const rec = { date: date, type: type, departementId: departementId, reference: String(p.reference || '').trim(), notes: String(p.notes || '').trim(), lignes };
  if (p.id) {
    const bon = DATA.sorties.find(b => b.id === p.id);
    if (!bon) fail('Bon de distribution introuvable.');
    // Stock disponible sans ce bon, puis on applique les nouvelles lignes
    const dispo = stockMap(null, p.id);
    verifStockDisponible(lignes, dispo);
    Object.assign(bon, rec);
  } else {
    verifStockDisponible(lignes, stockMap());
    DATA.sorties.push({ id: id(), ...rec, createdAt: new Date().toISOString() });
  }
  save();
}

function deleteSortie(sortieId) {
  const bon = DATA.sorties.find(b => b.id === sortieId);
  if (!bon) fail('Bon de distribution introuvable.');
  DATA.sorties = DATA.sorties.filter(b => b.id !== sortieId);
  save();
}

/* ============================= Mouvements (journal) ============================= */

function getMouvements(f = {}) {
  const arts = new Map(DATA.articles.map(a => [a.id, a]));
  const srcs = new Map(DATA.sources.map(s => [s.id, s]));
  const deps = new Map(DATA.departements.map(d => [d.id, d]));
  const rows = [];
  if (!f.type || f.type === 'entree') {
    for (const b of DATA.entrees) {
      if (f.from && b.date < f.from) continue;
      if (f.to && b.date > f.to) continue;
      if (f.sourceId && b.sourceId !== f.sourceId) continue;
      const s = srcs.get(b.sourceId);
      for (const l of b.lignes) {
        if (f.articleId && l.articleId !== f.articleId) continue;
        const a = arts.get(l.articleId) || {};
        rows.push({ date: b.date, bonId: b.id, reference: b.reference || '', type: 'entree', nature: 'entree', partenaire: s ? s.nom : '', designation: a.designation || '', code: a.code || '', unite: a.unite || '', quantite: l.quantite, createdAt: b.createdAt || '' });
      }
    }
  }
  if (!f.type || f.type === 'sortie' || f.type === 'destruction') {
    for (const b of DATA.sorties) {
      const typeBon = b.type || 'distribution';
      if (f.type === 'sortie' && typeBon === 'destruction') continue;
      if (f.type === 'destruction' && typeBon !== 'destruction') continue;
      if (f.from && b.date < f.from) continue;
      if (f.to && b.date > f.to) continue;
      if (f.departementId && b.departementId !== f.departementId) continue;
      for (const l of b.lignes) {
        if (f.articleId && l.articleId !== f.articleId) continue;
        const a = arts.get(l.articleId) || {};
        rows.push({ date: b.date, bonId: b.id, reference: b.reference || '', type: 'sortie', nature: typeBon, partenaire: typeBon === 'destruction' ? 'Articles détruits (périmés / abîmés)' : (deps.get(b.departementId) ? deps.get(b.departementId).nom : ''), designation: a.designation || '', code: a.code || '', unite: a.unite || '', quantite: l.quantite, createdAt: b.createdAt || '' });
      }
    }
  }
  rows.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  return rows;
}

/* ============================= Statistiques ============================= */

function stats() {
  const sm = stockMap();
  const alerts = DATA.articles
    .filter(a => (sm.get(a.id) || 0) <= (a.seuil || 0))
    .map(a => ({ id: a.id, designation: a.designation, code: a.code || '', stock: sm.get(a.id) || 0, seuil: a.seuil || 0 }))
    .sort((a, b) => a.stock - b.stock);
  const maintenant = new Date();
  const moisCourant = maintenant.toISOString().slice(0, 7);
  const jourCourant = maintenant.toISOString().slice(0, 10);
  const sommeMois = (bons) => bons.filter(b => (b.date || '').startsWith(moisCourant)).reduce((t, b) => t + b.lignes.reduce((s, l) => s + l.quantite, 0), 0);
  const nbJour = (bons) => bons.filter(b => b.date === jourCourant).length;
  return {
    articles: DATA.articles.length,
    alertCount: alerts.length,
    alerts: alerts.slice(0, 10),
    entreesMois: sommeMois(DATA.entrees),
    sortiesMois: sommeMois(DATA.sorties.filter(b => (b.type || 'distribution') === 'distribution')),
    destructionsMois: sommeMois(DATA.sorties.filter(b => b.type === 'destruction')),
    entreesJour: nbJour(DATA.entrees),
    sortiesJour: nbJour(DATA.sorties),
    derniers: getMouvements().slice(0, 8)
  };
}

/* ============================= Rapports ============================= */

function rapportParDepartement(f = {}) {
  const rows = getMouvements({ ...f, type: 'sortie' }).filter(r => r.nature !== 'destruction');
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.partenaire)) map.set(r.partenaire, new Map());
    const parArt = map.get(r.partenaire);
    const cle = r.designation + '|' + r.unite;
    parArt.set(cle, { designation: r.designation, unite: r.unite, quantite: (parArt.get(cle) ? parArt.get(cle).quantite : 0) + r.quantite });
  }
  const out = [];
  for (const [departement, parArt] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
    let total = 0;
    for (const v of parArt.values()) { out.push({ departement, ...v }); total += v.quantite; }
    out.push({ departement, designation: '', unite: '', quantite: null, totalDepartement: true, total });
  }
  return { periode: { from: f.from || '', to: f.to || '' }, rows: out, totalQuantite: rows.reduce((t, r) => t + r.quantite, 0), nbBons: new Set(rows.map(r => r.bonId)).size };
}

function rapportParSource(f = {}) {
  const rows = getMouvements({ ...f, type: 'entree' });
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.partenaire)) map.set(r.partenaire, new Map());
    const parArt = map.get(r.partenaire);
    const cle = r.designation + '|' + r.unite;
    parArt.set(cle, { designation: r.designation, unite: r.unite, quantite: (parArt.get(cle) ? parArt.get(cle).quantite : 0) + r.quantite });
  }
  const out = [];
  for (const [source, parArt] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))) {
    let total = 0;
    for (const v of parArt.values()) { out.push({ source, ...v }); total += v.quantite; }
    out.push({ source, designation: '', unite: '', quantite: null, totalSource: true, total });
  }
  return { periode: { from: f.from || '', to: f.to || '' }, rows: out, totalQuantite: rows.reduce((t, r) => t + r.quantite, 0), nbBons: new Set(rows.map(r => r.bonId)).size };
}

/* ============================= Sauvegarde / restauration ============================= */

function backupTo(dest) {
  fs.copyFileSync(FILE, dest);
  return { filePath: dest };
}

function estValide(d) {
  return d && typeof d === 'object'
    && Array.isArray(d.articles) && Array.isArray(d.entrees) && Array.isArray(d.sorties);
}

function importFrom(data) {
  if (!estValide(data)) fail('Ce fichier n\'est pas une sauvegarde valide de l\'application.');
  DATA = empty();
  for (const k of Object.keys(empty())) if (k in data) DATA[k] = data[k];
  save();
  return { articles: DATA.articles.length, entrees: DATA.entrees.length, sorties: DATA.sorties.length };
}

function resetAll() {
  DATA = empty();
  save();
}

/* ============================= Données de démonstration ============================= */

function seedDemo() {
  if (DATA.articles.length > 0 || DATA.entrees.length > 0 || DATA.sorties.length > 0) {
    fail('Des données existent déjà. Utilisez « Réinitialiser » avant de charger la démonstration.');
  }
  const iso = (offsetJours) => {
    const d = new Date(); d.setDate(d.getDate() - offsetJours);
    return d.toISOString().slice(0, 10);
  };
  for (const nom of ['Papeterie', 'Électronique', 'Fournitures bureau', 'Hygiène']) {
    DATA.categories.push({ id: id(), nom });
  }
  const cats = DATA.categories;
  const srcs = [
    { id: id(), nom: 'Fournisseur TechnoPlus', type: 'fournisseur', contact: 'M. Salem', telephone: '71 000 000', adresse: 'Tunis' },
    { id: id(), nom: 'Marché central', type: 'marche', contact: '', telephone: '', adresse: 'Tunis' },
    { id: id(), nom: 'SETIPAP\', Fournitures', type: 'fournisseur', contact: 'Mme Amel', telephone: '71 111 111', adresse: 'Ariana' }
  ];
  DATA.sources.push(...srcs);
  const deps = [
    { id: id(), nom: 'Comptabilité', responsable: 'M. Karim' },
    { id: id(), nom: 'Ressources Humaines', responsable: 'Mme Nadia' },
    { id: id(), nom: 'Informatique', responsable: 'M. Adel' },
    { id: id(), nom: 'Logistique', responsable: 'M. Hichem' }
  ];
  DATA.departements.push(...deps);
  const arts = [
    { code: 'ART-001', designation: 'Ramette papier A4 (500 feuilles)', categorieId: cats[0].id, unite: 'ramette', seuil: 20 },
    { code: 'ART-002', designation: 'Stylo bleu', categorieId: cats[0].id, unite: 'pièce', seuil: 50 },
    { code: 'ART-003', designation: 'Cartouche toner HP 107A', categorieId: cats[2].id, unite: 'pièce', seuil: 4 },
    { code: 'ART-004', designation: 'Souris filaire USB', categorieId: cats[1].id, unite: 'pièce', seuil: 5 },
    { code: 'ART-005', designation: 'Clavier AZERTY USB', categorieId: cats[1].id, unite: 'pièce', seuil: 5 },
    { code: 'ART-006', designation: 'Savon liquide 5L', categorieId: cats[3].id, unite: 'bidon', seuil: 6 },
    { code: 'ART-007', designation: 'Gants jetables (boîte 100)', categorieId: cats[3].id, unite: 'boîte', seuil: 10 },
    { code: 'ART-008', designation: 'Câble HDMI 2m', categorieId: cats[1].id, unite: 'pièce', seuil: 5 }
  ].map(a => ({ id: id(), ...a, notes: '', createdAt: new Date().toISOString() }));
  DATA.articles.push(...arts);
  const ar = (code) => arts.find(a => a.code === code).id;
  DATA.entrees.push(
    { id: id(), date: iso(10), sourceId: srcs[0].id, reference: 'BR-001', notes: '', createdAt: new Date().toISOString(), lignes: [ { articleId: ar('ART-001'), quantite: 60 }, { articleId: ar('ART-002'), quantite: 300 }, { articleId: ar('ART-003'), quantite: 12 } ] },
    { id: id(), date: iso(8), sourceId: srcs[1].id, reference: 'BR-002', notes: 'Achat au marché', createdAt: new Date().toISOString(), lignes: [ { articleId: ar('ART-006'), quantite: 15 }, { articleId: ar('ART-007'), quantite: 25 } ] },
    { id: id(), date: iso(5), sourceId: srcs[2].id, reference: 'BR-003', notes: '', createdAt: new Date().toISOString(), lignes: [ { articleId: ar('ART-004'), quantite: 20 }, { articleId: ar('ART-005'), quantite: 20 }, { articleId: ar('ART-008'), quantite: 25 } ] }
  );
  DATA.sorties.push(
    { id: id(), date: iso(4), departementId: deps[2].id, reference: 'BD-001', notes: '', createdAt: new Date().toISOString(), lignes: [ { articleId: ar('ART-004'), quantite: 6 }, { articleId: ar('ART-005'), quantite: 6 }, { articleId: ar('ART-008'), quantite: 8 } ] },
    { id: id(), date: iso(3), departementId: deps[0].id, reference: 'BD-002', notes: '', createdAt: new Date().toISOString(), lignes: [ { articleId: ar('ART-001'), quantite: 25 }, { articleId: ar('ART-002'), quantite: 100 } ] },
    { id: id(), date: iso(1), departementId: deps[1].id, reference: 'BD-003', notes: '', createdAt: new Date().toISOString(), lignes: [ { articleId: ar('ART-006'), quantite: 2 }, { articleId: ar('ART-007'), quantite: 10 } ] }
  );
  save();
}

module.exports = {
  init, save, filePath, raw: () => DATA,
  listCategories, saveCategory, deleteCategory,
  listArticles, saveArticle, deleteArticle, getStock,
  listSources, saveSource, deleteSource,
  listDepartements, saveDepartement, deleteDepartement,
  listEntrees, saveEntree, deleteEntree,
  listSorties, saveSortie, deleteSortie,
  getMouvements, stats,
  rapportParDepartement, rapportParSource,
  backupTo, importFrom, resetAll, seedDemo
};
