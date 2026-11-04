'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
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

app.whenReady().then(() => {
  db.init(path.join(app.getPath('userData'), 'gestion-stock.json'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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

  backup: async () => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Enregistrer une sauvegarde',
      defaultPath: `sauvegarde-stock-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Sauvegarde JSON', extensions: ['json'] }]
    });
    if (r.canceled) return { canceled: true };
    return db.backupTo(r.filePath);
  },
  restore: async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Restaurer une sauvegarde',
      properties: ['openFile'],
      filters: [{ name: 'Sauvegarde JSON', extensions: ['json'] }]
    });
    if (r.canceled) return { canceled: true };
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    return db.importFrom(data);
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
