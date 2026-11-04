'use strict';
/**
 * Couche de données de l'application "Gestion de Stock Interne".
 * Base : SQLite (via sql.js, le moteur SQLite compilé en WebAssembly).
 * - Fichier .db lisible avec n'importe quel outil SQLite
 * - Aucune compilation native nécessaire
 * - Écritures atomiques (fichier temporaire + renommage)
 * Toutes les règles métier restent validées ici (processus principal).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

let SQLLIB = null;   // module sql.js initialisé
let DB = null;       // base SQLite en cours
let FILE = null;     // chemin du fichier .db

/* ============================= Utilitaires ============================= */

function fail(msg) {
  const e = new Error(msg);
  e.metier = true;
  throw e;
}

const id = () => crypto.randomUUID();

function nim(s) { return String(s ?? '').normalize('NFC').trim(); }

/** Exécute une requête et renvoie les lignes en objets. */
function all(sql, params = []) {
  const stmt = DB.prepare(sql);
  try {
    stmt.bind(params.map(p => (p === undefined ? null : p)));
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

function run(sql, params = []) {
  DB.run(sql, params.map(p => (p === undefined ? null : p)));
}

const cnt = table => get(`SELECT COUNT(*) AS n FROM ${table}`).n;

/** Persistance : exporte la base et écrase le fichier de façon atomique. */
function save() {
  const data = Buffer.from(DB.export());
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, FILE);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_nom ON categories (nom COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  code TEXT DEFAULT '',
  designation TEXT NOT NULL,
  categorieId TEXT DEFAULT '',
  unite TEXT DEFAULT '',
  seuil REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  createdAt TEXT
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  type TEXT NOT NULL,
  contact TEXT DEFAULT '',
  telephone TEXT DEFAULT '',
  adresse TEXT DEFAULT '',
  createdAt TEXT
);
CREATE TABLE IF NOT EXISTS departements (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  responsable TEXT DEFAULT '',
  createdAt TEXT
);
CREATE TABLE IF NOT EXISTS entrees (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  sourceId TEXT,
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  createdAt TEXT
);
CREATE TABLE IF NOT EXISTS entrees_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bonId TEXT NOT NULL,
  articleId TEXT NOT NULL,
  quantite REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sorties (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'distribution',
  departementId TEXT,
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  createdAt TEXT
);
CREATE TABLE IF NOT EXISTS sorties_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bonId TEXT NOT NULL,
  articleId TEXT NOT NULL,
  quantite REAL NOT NULL
);
`;

/** Initialisation asynchrone (sql.js charge son runtime en WebAssembly). */
async function init(file) {
  FILE = file;
  if (!SQLLIB) {
    SQLLIB = await initSqlJs({
      locateFile: f => path.join(path.dirname(require.resolve('sql.js')), f)
    });
  }
  if (fs.existsSync(file)) {
    DB = new SQLLIB.Database(fs.readFileSync(file));
  } else {
    DB = new SQLLIB.Database();
    DB.run(SCHEMA);
    save();
  }
  // Remise à zéro : on supprime l'ancien fichier JSON (format précédent) s'il existe
  const ancien = FILE.replace(/\.(db|sqlite)$/i, '.json');
  try { if (fs.existsSync(ancien)) fs.unlinkSync(ancien); } catch (e) { /* non bloquant */ }
  return FILE;
}

function filePath() {
  return FILE;
}

/* ============================= Stock ============================= */

const STOCK = `(COALESCE((SELECT SUM(l2.quantite) FROM entrees_lignes l2 WHERE l2.articleId = a.id), 0)
              - COALESCE((SELECT SUM(k2.quantite) FROM sorties_lignes k2 WHERE k2.articleId = a.id), 0))`;

function articleById(articleId) {
  return get('SELECT * FROM articles WHERE id = ?', [articleId]);
}

/** Fusionne les lignes d'un bon par article (doublons additionnés) + validations. */
function mergeLignes(lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) fail('Le bon doit contenir au moins un article.');
  const merged = new Map();
  for (const l of lignes) {
    const art = articleById(l.articleId);
    if (!art) fail('Un des articles sélectionnés n\'existe plus. Rechargez la page et réessayez.');
    const q = Number(l.quantite);
    if (!Number.isFinite(q) || q <= 0) fail(`Quantité invalide pour l'article « ${art.designation} » (doit être supérieur à 0).`);
    merged.set(art.id, (merged.get(art.id) || 0) + q);
  }
  return [...merged.entries()].map(([articleId, quantite]) => ({ articleId, quantite }));
}

function verifStockDisponible(merged, allowance) {
  // allowance : Map articleId -> quantité disponible
  for (const l of merged) {
    const art = articleById(l.articleId);
    const dispo = allowance.get(l.articleId) || 0;
    if (l.quantite > dispo) {
      fail(`Stock insuffisant pour « ${art.designation} » : disponible ${dispo} ${art.unite || ''}, demandé ${l.quantite}.`.replace(/\s+/g, ' '));
    }
  }
}

function stockMap(majorationSortieId = null) {
  // Stock par article, en tolérant éventuellement un bon de sortie non compté
  const m = new Map();
  for (const r of all(`SELECT a.id AS id, ${STOCK} + CASE WHEN ? IS NOT NULL THEN COALESCE((SELECT quantite FROM sorties_lignes WHERE bonId = ? AND articleId = a.id), 0) ELSE 0 END AS stock FROM articles a`, [majorationSortieId, majorationSortieId])) {
    m.set(r.id, r.stock);
  }
  return m;
}

/* ============================= Catégories ============================= */

function listCategories() {
  return all('SELECT id, nom FROM categories ORDER BY nom');
}

function saveCategory(p) {
  const nom = nim(p.nom);
  if (!nom) fail('Le nom de la catégorie est obligatoire.');
  const doublon = get('SELECT id FROM categories WHERE nom = ? COLLATE NOCASE AND id != ?', [nom, p.id || '']);
  if (doublon) fail(`La catégorie « ${nom} » existe déjà.`);
  if (p.id) {
    if (!get('SELECT id FROM categories WHERE id = ?', [p.id])) fail('Catégorie introuvable.');
    run('UPDATE categories SET nom = ? WHERE id = ?', [nom, p.id]);
  } else {
    run('INSERT INTO categories (id, nom) VALUES (?, ?)', [id(), nom]);
  }
  save();
  return listCategories();
}

function deleteCategory(catId) {
  const utilise = get('SELECT COUNT(*) AS n FROM articles WHERE categorieId = ?', [catId]).n;
  if (utilise) fail('Impossible de supprimer : cette catégorie est utilisée par des articles.');
  run('DELETE FROM categories WHERE id = ?', [catId]);
  save();
  return listCategories();
}

/* ============================= Articles ============================= */

function listArticles() {
  return all(`SELECT a.id, a.code, a.designation, a.categorieId, a.unite, a.seuil, a.notes, a.createdAt,
              COALESCE(c.nom, '') AS categorie
              FROM articles a LEFT JOIN categories c ON c.id = a.categorieId
              ORDER BY a.designation`);
}

function validerArticle(p) {
  const designation = nim(p.designation);
  if (!designation) fail('La désignation de l\'article est obligatoire.');
  const code = nim(p.code);
  if (code) {
    const doublon = get('SELECT id FROM articles WHERE code = ? COLLATE NOCASE AND id != ?', [code, p.id || '']);
    if (doublon) fail(`Le code « ${code} » est déjà utilisé par un autre article.`);
  }
  if (p.categorieId && !get('SELECT id FROM categories WHERE id = ?', [p.categorieId])) fail('Catégorie invalide.');
  return {
    code, designation,
    categorieId: p.categorieId || '',
    unite: nim(p.unite),
    seuil: Math.max(0, Number(p.seuil) || 0),
    notes: nim(p.notes)
  };
}

function saveArticle(p) {
  const c = validerArticle(p);
  if (p.id) {
    if (!articleById(p.id)) fail('Article introuvable.');
    run('UPDATE articles SET code=?, designation=?, categorieId=?, unite=?, seuil=?, notes=? WHERE id=?',
      [c.code, c.designation, c.categorieId, c.unite, c.seuil, c.notes, p.id]);
  } else {
    run('INSERT INTO articles (id, code, designation, categorieId, unite, seuil, notes, createdAt) VALUES (?,?,?,?,?,?,?,?)',
      [id(), c.code, c.designation, c.categorieId, c.unite, c.seuil, c.notes, new Date().toISOString()]);
  }
  save();
  return listArticles();
}

function deleteArticle(articleId) {
  const utilise = get(`SELECT
     (SELECT COUNT(*) FROM entrees_lignes WHERE articleId = ?)
     + (SELECT COUNT(*) FROM sorties_lignes WHERE articleId = ?) AS n`,
    [articleId, articleId]).n;
  if (utilise) fail('Impossible de supprimer : cet article est utilisé dans des bons d\'entrée/sortie.');
  run('DELETE FROM articles WHERE id = ?', [articleId]);
  save();
  return listArticles();
}

/** Stock actuel de tous les articles (+ filtres simples). */
function getStock(f = {}) {
  let sql = `SELECT a.id, a.code, a.designation, a.categorieId, a.unite, a.seuil, a.notes, a.createdAt,
             COALESCE(c.nom, '') AS categorie, ${STOCK} AS stock
             FROM articles a LEFT JOIN categories c ON c.id = a.categorieId WHERE 1=1`;
  const params = [];
  const q = nim(f.search).toLowerCase();
  if (q) { sql += ' AND (lower(a.designation) LIKE ? OR lower(a.code) LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
  if (f.categorieId) { sql += ' AND a.categorieId = ?'; params.push(f.categorieId); }
  if (f.masquerStockZero) sql += ` AND ${STOCK} > 0`;
  sql += ' ORDER BY a.designation';
  return all(sql, params);
}

/* ============================= Import Excel d'articles ============================= */

/** Import en masse d'articles depuis un fichier Excel (via main). */
function importArticles(rows) {
  let importes = 0, categoriesCreees = 0;
  const erreurs = [];
  const catCache = new Map(all('SELECT id, nom FROM categories').map(c => [c.nom.toLowerCase(), c.id]));
  for (const r of (rows || [])) {
    try {
      const designation = nim(r.designation);
      if (!designation) throw new Error('Désignation manquante');
      const code = nim(r.code);
      if (code && get('SELECT id FROM articles WHERE code = ? COLLATE NOCASE', [code])) {
        throw new Error(`Code « ${code} » déjà utilisé`);
      }
      let categorieId = '';
      const catNom = nim(r.categorie);
      if (catNom) {
        if (catCache.has(catNom.toLowerCase())) categorieId = catCache.get(catNom.toLowerCase());
        else {
          categorieId = id();
          run('INSERT INTO categories (id, nom) VALUES (?, ?)', [categorieId, catNom]);
          catCache.set(catNom.toLowerCase(), categorieId);
          categoriesCreees++;
        }
      }
      run('INSERT INTO articles (id, code, designation, categorieId, unite, seuil, notes, createdAt) VALUES (?,?,?,?,?,?,?,?)',
        [id(), code, designation, categorieId, nim(r.unite), Math.max(0, Number(r.seuil) || 0), '', new Date().toISOString()]);
      importes++;
    } catch (e) {
      erreurs.push({ ligne: r.ligne, designation: r.designation || '', motif: e.message });
    }
  }
  save();
  return { importes, categoriesCreees, erreurs };
}

/* ============================= Sources (fournisseurs / marchés) ============================= */

function listSources(f = {}) {
  let rows = all('SELECT * FROM sources ORDER BY nom');
  if (f.type) rows = rows.filter(s => s.type === f.type);
  return rows;
}

function saveSource(p) {
  const nom = nim(p.nom);
  if (!nom) fail('Le nom est obligatoire.');
  const type = p.type === 'marche' ? 'marche' : 'fournisseur';
  if (p.id) {
    if (!get('SELECT id FROM sources WHERE id = ?', [p.id])) fail('Source introuvable.');
    run('UPDATE sources SET nom=?, type=?, contact=?, telephone=?, adresse=? WHERE id=?',
      [nom, type, nim(p.contact), nim(p.telephone), nim(p.adresse), p.id]);
  } else {
    run('INSERT INTO sources (id, nom, type, contact, telephone, adresse, createdAt) VALUES (?,?,?,?,?,?,?)',
      [id(), nom, type, nim(p.contact), nim(p.telephone), nim(p.adresse), new Date().toISOString()]);
  }
  save();
  return listSources();
}

function deleteSource(sourceId) {
  const utilise = get('SELECT COUNT(*) AS n FROM entrees WHERE sourceId = ?', [sourceId]).n;
  if (utilise) fail('Impossible de supprimer : cette source est utilisée dans des bons de réception.');
  run('DELETE FROM sources WHERE id = ?', [sourceId]);
  save();
  return listSources();
}

/* ============================= Départements ============================= */

function listDepartements() {
  return all('SELECT * FROM departements ORDER BY nom');
}

function saveDepartement(p) {
  const nom = nim(p.nom);
  if (!nom) fail('Le nom du département est obligatoire.');
  if (p.id) {
    if (!get('SELECT id FROM departements WHERE id = ?', [p.id])) fail('Département introuvable.');
    run('UPDATE departements SET nom=?, responsable=? WHERE id=?', [nom, nim(p.responsable), p.id]);
  } else {
    run('INSERT INTO departements (id, nom, responsable, createdAt) VALUES (?,?,?,?)',
      [id(), nom, nim(p.responsable), new Date().toISOString()]);
  }
  save();
  return listDepartements();
}

function deleteDepartement(depId) {
  const utilise = get("SELECT COUNT(*) AS n FROM sorties WHERE departementId = ? AND type = 'distribution'", [depId]).n;
  if (utilise) fail('Impossible de supprimer : ce département est utilisé dans des bons de distribution.');
  run('DELETE FROM departements WHERE id = ?', [depId]);
  save();
  return listDepartements();
}

/* ============================= Entrées (réceptions) ============================= */

function lignesAvecInfos(bonId, table) {
  return all(`SELECT l.articleId, l.quantite, a.designation, a.code, a.unite
              FROM ${table} l LEFT JOIN articles a ON a.id = l.articleId
              WHERE l.bonId = ? ORDER BY l.id`, [bonId]);
}

function listEntrees(f = {}) {
  let sql = `SELECT b.id, b.date, b.reference, b.notes, b.sourceId,
             COALESCE(s.nom, '(source supprimée)') AS sourceNom,
             COALESCE(s.type, '') AS sourceType
             FROM entrees b LEFT JOIN sources s ON s.id = b.sourceId WHERE 1=1`;
  const params = [];
  if (f.sourceId) { sql += ' AND b.sourceId = ?'; params.push(f.sourceId); }
  if (f.from) { sql += ' AND b.date >= ?'; params.push(f.from); }
  if (f.to) { sql += ' AND b.date <= ?'; params.push(f.to); }
  sql += ' ORDER BY b.date DESC, b.createdAt DESC';
  const bons = all(sql, params);
  return bons.map(b => {
    const lignes = lignesAvecInfos(b.id, 'entrees_lignes');
    return { ...b, lignes, totalQte: lignes.reduce((t, l) => t + l.quantite, 0) };
  });
}

function saveEntree(p) {
  const date = nim(p.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('La date du bon est obligatoire.');
  if (!p.sourceId) fail('La source (fournisseur ou marché) est obligatoire.');
  if (!get('SELECT id FROM sources WHERE id = ?', [p.sourceId])) fail('Source introuvable.');
  const lignes = mergeLignes(p.lignes);
  if (p.id) {
    const bon = get('SELECT * FROM entrees WHERE id = ?', [p.id]);
    if (!bon) fail('Bon de réception introuvable.');
    // Le stock après modification ne doit pas être négatif
    for (const l of lignes) {
      const ancienQ = (get('SELECT SUM(quantite) AS n FROM entrees_lignes WHERE bonId = ? AND articleId = ?', [p.id, l.articleId]).n || 0);
      const stockFutur = (get(`SELECT ${STOCK} AS s FROM articles a WHERE a.id = ?`, [l.articleId]).s || 0) - ancienQ + l.quantite;
      if (stockFutur < 0) {
        const art = articleById(l.articleId);
        fail(`Modification impossible : le stock de « ${art.designation} » deviendrait négatif (${stockFutur}).`);
      }
    }
    run('DELETE FROM entrees_lignes WHERE bonId = ?', [p.id]);
    run('UPDATE entrees SET date=?, sourceId=?, reference=?, notes=? WHERE id=?',
      [date, p.sourceId, nim(p.reference), nim(p.notes), p.id]);
    for (const l of lignes) run('INSERT INTO entrees_lignes (bonId, articleId, quantite) VALUES (?,?,?)', [p.id, l.articleId, l.quantite]);
  } else {
    const bonId = id();
    run('INSERT INTO entrees (id, date, sourceId, reference, notes, createdAt) VALUES (?,?,?,?,?,?)',
      [bonId, date, p.sourceId, nim(p.reference), nim(p.notes), new Date().toISOString()]);
    for (const l of lignes) run('INSERT INTO entrees_lignes (bonId, articleId, quantite) VALUES (?,?,?)', [bonId, l.articleId, l.quantite]);
  }
  save();
  return listEntrees({ sourceId: p.sourceId });
}

function deleteEntree(entreeId) {
  const bon = get('SELECT * FROM entrees WHERE id = ?', [entreeId]);
  if (!bon) fail('Bon de réception introuvable.');
  // Après suppression, le stock ne doit pas devenir négatif
  const lignes = lignesAvecInfos(entreeId, 'entrees_lignes');
  for (const l of lignes) {
    const stock = get(`SELECT ${STOCK} AS s FROM articles a WHERE a.id = ?`, [l.articleId]);
    if (stock && stock.s - l.quantite < 0) {
      fail(`Suppression impossible : des articles de ce bon ont déjà été distribués. Le stock de « ${l.designation} » deviendrait négatif.`);
    }
  }
  run('DELETE FROM entrees_lignes WHERE bonId = ?', [entreeId]);
  run('DELETE FROM entrees WHERE id = ?', [entreeId]);
  save();
}

/* ============================= Sorties (distributions / destructions) ============================= */

function listSorties(f = {}) {
  let sql = `SELECT b.id, b.date, b.type, b.reference, b.notes, b.departementId,
             CASE WHEN b.type = 'destruction' THEN '' ELSE COALESCE(d.nom, '(département supprimé)') END AS departementNom
             FROM sorties b LEFT JOIN departements d ON d.id = b.departementId WHERE 1=1`;
  const params = [];
  if (f.departementId) { sql += ' AND b.departementId = ?'; params.push(f.departementId); }
  if (f.type) { sql += ' AND b.type = ?'; params.push(f.type); }
  if (f.from) { sql += ' AND b.date >= ?'; params.push(f.from); }
  if (f.to) { sql += ' AND b.date <= ?'; params.push(f.to); }
  sql += ' ORDER BY b.date DESC, b.createdAt DESC';
  const bons = all(sql, params);
  return bons.map(b => {
    const lignes = lignesAvecInfos(b.id, 'sorties_lignes');
    return { ...b, lignes, totalQte: lignes.reduce((t, l) => t + l.quantite, 0) };
  });
}

function saveSortie(p) {
  const type = p.type === 'destruction' ? 'destruction' : 'distribution';
  const date = nim(p.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('La date du bon est obligatoire.');
  let departementId = null;
  if (type !== 'destruction') {
    if (!p.departementId) fail('Le département destinataire est obligatoire.');
    if (!get('SELECT id FROM departements WHERE id = ?', [p.departementId])) fail('Département introuvable.');
    departementId = p.departementId;
  }
  const lignes = mergeLignes(p.lignes);
  if (p.id) {
    const bon = get('SELECT * FROM sorties WHERE id = ?', [p.id]);
    if (!bon) fail('Bon de distribution introuvable.');
    // Stock disponible sans ce bon, puis on applique les nouvelles lignes
    verifStockDisponible(lignes, stockMap(p.id));
    run('DELETE FROM sorties_lignes WHERE bonId = ?', [p.id]);
    run('UPDATE sorties SET date=?, type=?, departementId=?, reference=?, notes=? WHERE id=?',
      [date, type, departementId, nim(p.reference), nim(p.notes), p.id]);
    for (const l of lignes) run('INSERT INTO sorties_lignes (bonId, articleId, quantite) VALUES (?,?,?)', [p.id, l.articleId, l.quantite]);
  } else {
    verifStockDisponible(lignes, stockMap(null));
    const bonId = id();
    run('INSERT INTO sorties (id, date, type, departementId, reference, notes, createdAt) VALUES (?,?,?,?,?,?,?)',
      [bonId, date, type, departementId, nim(p.reference), nim(p.notes), new Date().toISOString()]);
    for (const l of lignes) run('INSERT INTO sorties_lignes (bonId, articleId, quantite) VALUES (?,?,?)', [bonId, l.articleId, l.quantite]);
  }
  save();
}

function deleteSortie(sortieId) {
  const bon = get('SELECT * FROM sorties WHERE id = ?', [sortieId]);
  if (!bon) fail('Bon de distribution introuvable.');
  run('DELETE FROM sorties_lignes WHERE bonId = ?', [sortieId]);
  run('DELETE FROM sorties WHERE id = ?', [sortieId]);
  save();
}

/* ============================= Mouvements (journal) ============================= */

function getMouvements(f = {}) {
  const rows = [];
  if (!f.type || f.type === 'entree') {
    let sql = `SELECT b.id AS bonId, b.date, b.reference, b.createdAt,
               COALESCE(s.nom, '') AS partenaire,
               l.articleId, l.quantite, a.designation, a.code, a.unite
               FROM entrees b
               LEFT JOIN sources s ON s.id = b.sourceId
               LEFT JOIN entrees_lignes l ON l.bonId = b.id
               LEFT JOIN articles a ON a.id = l.articleId
               WHERE 1=1`;
    const params = [];
    if (f.from) { sql += ' AND b.date >= ?'; params.push(f.from); }
    if (f.to) { sql += ' AND b.date <= ?'; params.push(f.to); }
    if (f.sourceId) { sql += ' AND b.sourceId = ?'; params.push(f.sourceId); }
    if (f.articleId) { sql += ' AND l.articleId = ?'; params.push(f.articleId); }
    for (const r of all(sql, params)) {
      rows.push({ ...r, type: 'entree', nature: 'entree' });
    }
  }
  if (!f.type || f.type === 'sortie' || f.type === 'destruction') {
    let sql = `SELECT b.id AS bonId, b.date, b.reference, b.createdAt, b.type,
               CASE WHEN b.type = 'destruction' THEN 'Articles détruits (périmés / abîmés)'
                    ELSE COALESCE(d.nom, '') END AS partenaire,
               l.articleId, l.quantite, a.designation, a.code, a.unite
               FROM sorties b
               LEFT JOIN departements d ON d.id = b.departementId
               LEFT JOIN sorties_lignes l ON l.bonId = b.id
               LEFT JOIN articles a ON a.id = l.articleId
               WHERE 1=1`;
    const params = [];
    if (f.from) { sql += ' AND b.date >= ?'; params.push(f.from); }
    if (f.to) { sql += ' AND b.date <= ?'; params.push(f.to); }
    if (f.departementId) { sql += ' AND b.departementId = ?'; params.push(f.departementId); }
    if (f.articleId) { sql += ' AND l.articleId = ?'; params.push(f.articleId); }
    sql += ' ORDER BY b.date DESC';
    for (const r of all(sql, params)) {
      if (f.type === 'sortie' && r.type === 'destruction') continue;
      if (f.type === 'destruction' && r.type !== 'destruction') continue;
      rows.push({ ...r, type: 'sortie', nature: r.type });
    }
  }
  rows.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  return rows;
}

/* ============================= Statistiques ============================= */

function stats() {
  const maintenant = new Date();
  const mois = maintenant.toISOString().slice(0, 7);
  const jour = maintenant.toISOString().slice(0, 10);
  const alerts = all(`SELECT a.id, a.designation, a.code, a.seuil, ${STOCK} AS stock
                      FROM articles a WHERE ${STOCK} <= a.seuil ORDER BY stock ASC`);
  return {
    articles: cnt('articles'),
    alertCount: alerts.length,
    alerts: alerts.slice(0, 10),
    entreesMois: Number(get(`SELECT COALESCE(SUM(l.quantite),0) AS n FROM entrees b JOIN entrees_lignes l ON l.bonId = b.id WHERE substr(b.date,1,7) = ?`, [mois]).n) || 0,
    sortiesMois: Number(get(`SELECT COALESCE(SUM(l.quantite),0) AS n FROM sorties b JOIN sorties_lignes l ON l.bonId = b.id WHERE substr(b.date,1,7) = ? AND b.type = 'distribution'`, [mois]).n) || 0,
    destructionsMois: Number(get(`SELECT COALESCE(SUM(l.quantite),0) AS n FROM sorties b JOIN sorties_lignes l ON l.bonId = b.id WHERE substr(b.date,1,7) = ? AND b.type = 'destruction'`, [mois]).n) || 0,
    entreesJour: get('SELECT COUNT(*) AS n FROM entrees WHERE date = ?', [jour]).n,
    sortiesJour: get('SELECT COUNT(*) AS n FROM sorties WHERE date = ?', [jour]).n,
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
  return { rows: out, totalQuantite: rows.reduce((t, r) => t + r.quantite, 0), nbBons: new Set(rows.map(r => r.bonId)).size };
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
  return { rows: out, totalQuantite: rows.reduce((t, r) => t + r.quantite, 0), nbBons: new Set(rows.map(r => r.bonId)).size };
}

/* ============================= Sauvegarde / restauration ============================= */

function estSqlite(bytes) {
  return bytes.length > 16 && bytes.slice(0, 16).toString('utf8') === 'SQLite format 3\0';
}

function backupTo(dest) {
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.writeFileSync(dest, Buffer.from(DB.export()));
  return { filePath: dest };
}

function restoreFrom(srcPath) {
  const bytes = fs.readFileSync(srcPath);
  if (!estSqlite(bytes)) fail('Ce fichier n\'est pas une base de données SQLite valide de l\'application.');
  try {
    DB = new SQLLIB.Database(bytes);
    all("SELECT COUNT(*) AS n FROM articles"); // test de lecture
  } catch (e) {
    fail('Fichier illisible ou corrompu. La base actuelle reste inchangée.');
  }
  save();
  return { articles: cnt('articles'), entrees: cnt('entrees'), sorties: cnt('sorties') };
}

function resetAll() {
  for (const t of ['entrees_lignes', 'sorties_lignes', 'entrees', 'sorties', 'articles', 'categories', 'sources', 'departements']) {
    run('DELETE FROM ' + t);
  }
  save();
}

/* ============================= Données de démonstration ============================= */

function seedDemo() {
  if (cnt('articles') > 0 || cnt('entrees') > 0 || cnt('sorties') > 0) {
    fail('Des données existent déjà. Utilisez « Réinitialiser » avant de charger la démonstration.');
  }
  const iso = (offsetJours) => {
    const d = new Date(); d.setDate(d.getDate() - offsetJours);
    return d.toISOString().slice(0, 10);
  };
  for (const nom of ['Papeterie', 'Électronique', 'Fournitures bureau', 'Hygiène']) {
    run('INSERT INTO categories (id, nom) VALUES (?, ?)', [id(), nom]);
  }
  const cats = listCategories();
  const srcs = [
    { nom: 'Fournisseur TechnoPlus', type: 'fournisseur', contact: 'M. Salem', telephone: '71 000 000', adresse: 'Tunis' },
    { nom: 'Marché central', type: 'marche', contact: '', telephone: '', adresse: 'Tunis' },
    { nom: "SETIPAP', Fournitures", type: 'fournisseur', contact: 'Mme Amel', telephone: '71 111 111', adresse: 'Ariana' }
  ];
  for (const s of srcs) {
    const sid = id();
    run('INSERT INTO sources (id, nom, type, contact, telephone, adresse, createdAt) VALUES (?,?,?,?,?,?,?)',
      [sid, s.nom, s.type, s.contact, s.telephone, s.adresse, new Date().toISOString()]);
    s.id = sid;
  }
  const deps = [
    { nom: 'Comptabilité', responsable: 'M. Karim' },
    { nom: 'Ressources Humaines', responsable: 'Mme Nadia' },
    { nom: 'Informatique', responsable: 'M. Adel' },
    { nom: 'Logistique', responsable: 'M. Hichem' }
  ];
  for (const d of deps) {
    const cid = id();
    run('INSERT INTO departements (id, nom, responsable, createdAt) VALUES (?,?,?,?)', [cid, d.nom, d.responsable, new Date().toISOString()]);
    d.id = cid;
  }
  const artsDefs = [
    { code: 'ART-001', designation: 'Ramette papier A4 (500 feuilles)', cat: 'Papeterie', unite: 'ramette', seuil: 20 },
    { code: 'ART-002', designation: 'Stylo bleu', cat: 'Papeterie', unite: 'pièce', seuil: 50 },
    { code: 'ART-003', designation: 'Cartouche toner HP 107A', cat: 'Fournitures bureau', unite: 'pièce', seuil: 4 },
    { code: 'ART-004', designation: 'Souris filaire USB', cat: 'Électronique', unite: 'pièce', seuil: 5 },
    { code: 'ART-005', designation: 'Clavier AZERTY USB', cat: 'Électronique', unite: 'pièce', seuil: 5 },
    { code: 'ART-006', designation: 'Savon liquide 5L', cat: 'Hygiène', unite: 'bidon', seuil: 6 },
    { code: 'ART-007', designation: 'Gants jetables (boîte 100)', cat: 'Hygiène', unite: 'boîte', seuil: 10 },
    { code: 'ART-008', designation: 'Câble HDMI 2m', cat: 'Électronique', unite: 'pièce', seuil: 5 }
  ];
  for (const a of artsDefs) {
    const aid = id();
    run('INSERT INTO articles (id, code, designation, categorieId, unite, seuil, notes, createdAt) VALUES (?,?,?,?,?,?,?,?)',
      [aid, a.code, a.designation, cats.find(c => c.nom === a.cat).id, a.unite, a.seuil, '', new Date().toISOString()]);
    a.id = aid;
  }
  const ar = code => artsDefs.find(a => a.code === code).id;
  const lignes = (table, bonId, items) => {
    for (const it of items) run(`INSERT INTO ${table} (bonId, articleId, quantite) VALUES (?,?,?)`, [bonId, it[0], it[1]]);
  };
  let bid = id();
  run('INSERT INTO entrees (id, date, sourceId, reference, notes, createdAt) VALUES (?,?,?,?,?,?)', [bid, iso(10), srcs[0].id, 'BR-001', '', new Date().toISOString()]);
  lignes('entrees_lignes', bid, [[ar('ART-001'), 60], [ar('ART-002'), 300], [ar('ART-003'), 12]]);
  bid = id();
  run('INSERT INTO entrees (id, date, sourceId, reference, notes, createdAt) VALUES (?,?,?,?,?,?)', [bid, iso(8), srcs[1].id, 'BR-002', 'Achat au marché', new Date().toISOString()]);
  lignes('entrees_lignes', bid, [[ar('ART-006'), 15], [ar('ART-007'), 25]]);
  bid = id();
  run('INSERT INTO entrees (id, date, sourceId, reference, notes, createdAt) VALUES (?,?,?,?,?,?)', [bid, iso(5), srcs[2].id, 'BR-003', '', new Date().toISOString()]);
  lignes('entrees_lignes', bid, [[ar('ART-004'), 20], [ar('ART-005'), 20], [ar('ART-008'), 25]]);
  bid = id();
  run('INSERT INTO sorties (id, date, type, departementId, reference, notes, createdAt) VALUES (?,?,?,?,?,?,?)', [bid, iso(4), 'distribution', deps[2].id, 'BD-001', '', new Date().toISOString()]);
  lignes('sorties_lignes', bid, [[ar('ART-004'), 6], [ar('ART-005'), 6], [ar('ART-008'), 8]]);
  bid = id();
  run('INSERT INTO sorties (id, date, type, departementId, reference, notes, createdAt) VALUES (?,?,?,?,?,?,?)', [bid, iso(3), 'distribution', deps[0].id, 'BD-002', '', new Date().toISOString()]);
  lignes('sorties_lignes', bid, [[ar('ART-001'), 25], [ar('ART-002'), 100]]);
  bid = id();
  run('INSERT INTO sorties (id, date, type, departementId, reference, notes, createdAt) VALUES (?,?,?,?,?,?,?)', [bid, iso(2), 'distribution', deps[1].id, 'BD-003', '', new Date().toISOString()]);
  lignes('sorties_lignes', bid, [[ar('ART-006'), 2], [ar('ART-007'), 10]]);
  bid = id();
  run("INSERT INTO sorties (id, date, type, departementId, reference, notes, createdAt) VALUES (?,?, 'destruction', ?, ?, ?, ?)", [bid, iso(1), null, 'BD-D1', 'Stylos périmés (encre séchée)', new Date().toISOString()]);
  lignes('sorties_lignes', bid, [[ar('ART-002'), 15]]);
  save();
}

module.exports = {
  init, save, filePath,
  listCategories, saveCategory, deleteCategory,
  listArticles, saveArticle, deleteArticle, getStock, importArticles,
  listSources, saveSource, deleteSource,
  listDepartements, saveDepartement, deleteDepartement,
  listEntrees, saveEntree, deleteEntree,
  listSorties, saveSortie, deleteSortie,
  getMouvements, stats,
  rapportParDepartement, rapportParSource,
  backupTo, restoreFrom, resetAll, seedDemo
};
