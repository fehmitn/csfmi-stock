'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const db = require('./lib/db');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 640,
    title: 'Gestion de Stock Interne',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  // Supprimer le menu natif (File / Edit / View...) qui ne colle pas au thème de l'application
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  await db.init(path.join(app.getPath('userData'), 'gestion-stock.db'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ============================== Export Excel ============================== */

async function ecrireXlsx(dest, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gestion de Stock Interne';
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name || 'Feuille', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = (sh.headers || []).map((h, i) => ({ header: h, width: (sh.widths && sh.widths[i]) || Math.max(14, String(h || '').length + 4) }));
    for (const r of (sh.rows || [])) ws.addRow(r);
    const entete = ws.getRow(1);
    entete.font = { bold: true, color: { argb: 'FF1E3A5F' } };
    entete.fill = { type: 'pattern', pattern: 'solid', fillColor: { argb: 'FFEFF6FF' } };
    entete.alignment = { vertical: 'middle' };
    for (const c of (sh.numCols || [])) ws.getColumn(c).numFmt = '#,##0.###';
    if ((sh.rows || []).length && ws.columnCount > 1) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    }
  }
  await wb.xlsx.writeFile(dest);
}

async function lireXlsxArticles(fichier) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(fichier));
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new Error('La première feuille du fichier est vide.');
  const norm = v => {
    if (v == null) return '';
    if (typeof v === 'object') return String(v.text ?? v.result ?? '').trim();
    return String(v).trim();
  };
  const enClair = v => norm(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const cols = {};
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    const h = enClair(cell.value);
    if (h === 'code') cols.code = col;
    else if (h === 'designation') cols.designation = col;
    else if (h === 'categorie') cols.categorie = col;
    else if (h === 'unite') cols.unite = col;
    else if (h.startsWith('seuil')) cols.seuil = col;
  });
  if (!cols.designation) throw new Error('Colonne « Désignation » introuvable sur la ligne d\'en-tête. Utilisez le modèle Excel fourni dans Paramètres.');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, num) => {
    if (num === 1) return;
    const val = colonne => {
      if (!colonne) return '';
      return norm(row.getCell(colonne).value);
    };
    const rec = {
      ligne: num,
      code: val(cols.code),
      designation: val(cols.designation),
      categorie: val(cols.categorie),
      unite: val(cols.unite),
      seuil: Number(val(cols.seuil)) || 0
    };
    if (!rec.code && !rec.designation && !rec.categorie && !rec.unite) return;
    rows.push(rec);
  });
  if (!rows.length) throw new Error('Aucune ligne d\'article trouvée dans le fichier.');
  return rows;
}

/* ============================== Répartition des actions ============================== */

const ACTIONS = {
  getAppInfo: () => ({ dbPath: db.filePath(), version: app.getVersion() }),
  stats: () => db.stats(),

  listArticles: (p) => db.listArticles(),
  saveArticle: (p) => db.saveArticle(p),
  deleteArticle: (p) => db.deleteArticle(p.id),
  getStock: (p) => db.getStock(p),

  listCategories: () => db.listCategories(),
  saveCategory: (p) => db.saveCategory(p),
  deleteCategory: (p) => db.deleteCategory(p.id),

  listSources: (p) => db.listSources(p || {}),
  saveSource: (p) => db.saveSource(p),
  deleteSource: (p) => db.deleteSource(p.id),

  listDepartements: () => db.listDepartements(),
  saveDepartement: (p) => db.saveDepartement(p),
  deleteDepartement: (p) => db.deleteDepartement(p.id),

  listEntrees: (p) => db.listEntrees(p || {}),
  saveEntree: (p) => db.saveEntree(p),
  deleteEntree: (p) => db.deleteEntree(p.id),

  listSorties: (p) => db.listSorties(p || {}),
  saveSortie: (p) => db.saveSortie(p),
  deleteSortie: (p) => db.deleteSortie(p.id),

  getMouvements: (p) => db.getMouvements(p || {}),
  rapportParDepartement: (p) => db.rapportParDepartement(p || {}),
  rapportParSource: (p) => db.rapportParSource(p || {}),

  xlsxExport: async (p) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Exporter en Excel',
      defaultPath: (p && p.filename) || 'export.xlsx',
      filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }]
    });
    if (r.canceled) return { canceled: true };
    await ecrireXlsx(r.filePath, (p && p.sheets) || []);
    return { filePath: r.filePath };
  },
  xlsxImportArticles: async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importer des articles depuis Excel',
      properties: ['openFile'],
      filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }]
    });
    if (r.canceled) return { canceled: true };
    const resultat = db.importArticles(await lireXlsxArticles(r.filePaths[0]));
    return { ...resultat, fichier: path.basename(r.filePaths[0]) };
  },

  backup: async () => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Enregistrer une sauvegarde',
      defaultPath: `sauvegarde-stock-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'Sauvegarde SQLite', extensions: ['db', 'sqlite'] }]
    });
    if (r.canceled) return { canceled: true };
    return db.backupTo(r.filePath);
  },
  restore: async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Restaurer une sauvegarde',
      properties: ['openFile'],
      filters: [{ name: 'Sauvegarde SQLite', extensions: ['db', 'sqlite'] }]
    });
    if (r.canceled) return { canceled: true };
    return db.restoreFrom(r.filePaths[0]);
  },
  seedDemo: () => db.seedDemo(),
  resetAll: () => db.resetAll()
};

ipcMain.handle('db:request', (e, { action, payload }) => {
  try {
    const fn = ACTIONS[action];
    if (!fn) throw new Error('Action inconnue : ' + action);
    return Promise.resolve(fn(payload || {})).then(data => ({ ok: true, data }));
  } catch (err) {
    return { ok: false, error: err.message || 'Erreur inattendue.' };
  }
});

/* ============================== Export PDF ============================== */

function wrapPdfHtml(title, inner) {
  const stamp = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#111827;padding:26px;font-size:12px}
    h1{font-size:19px;color:#1e3a5f;border-bottom:2px solid #2563eb;padding-bottom:8px;margin:0 0 4px}
    .meta{color:#6b7280;font-size:11px;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th{background:#eff6ff;color:#1e3a5f;text-align:left}
    th,td{border:1px solid #cbd5e1;padding:6px 8px}
    tr:nth-child(even) td{background:#f8fafc}
    .num{text-align:right;white-space:nowrap}
    .grp td{font-weight:bold;background:#e0e7ff}
    .sans{font-size:11px;color:#6b7280}
  </style></head><body>
  <h1>${String(title).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</h1>
  <div class="meta">Gestion de stock interne — édité le ${stamp}</div>
  ${inner}</body></html>`;
}

ipcMain.handle('pdf:generate', async (e, { title, html, filename }) => {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(wrapPdfHtml(title, html)));
    const buf = await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      marginType: 'default'
    });
    const r = await dialog.showSaveDialog(win, {
      title: 'Exporter en PDF',
      defaultPath: filename || 'rapport.pdf',
      filters: [{ name: 'Document PDF', extensions: ['pdf'] }]
    });
    if (r.canceled) return { canceled: true };
    fs.writeFileSync(r.filePath, buf);
    return { filePath: r.filePath };
  } catch (err) {
    return { error: err.message };
  } finally {
    pdfWin.destroy();
  }
});

ipcMain.handle('csv:export', async (e, { filename, content }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter en CSV',
    defaultPath: filename || 'export.csv',
    filters: [{ name: 'Fichier CSV (Excel)', extensions: ['csv'] }]
  });
  if (r.canceled) return { canceled: true };
  fs.writeFileSync(r.filePath, '\ufeff' + content, 'utf8');
  return { filePath: r.filePath };
});
