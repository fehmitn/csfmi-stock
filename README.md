# 📦 Gestion de Stock Interne

Application de bureau (Electron) pour la gestion du stock d'un magasin interne :
le magasinier **reçoit** des articles de fournisseurs et de marchés, et les **distribue** aux départements
de l'entreprise. L'application ne gère aucun achat et aucune vente — uniquement les mouvements internes.

## ▶️ Démarrer l'application

Prérequis : [Node.js](https://nodejs.org) (v18 ou plus) installé sur le poste.

```bash
npm install       # à faire une seule fois
npm start         # démarre l'application
```

## ✨ Fonctionnalités

- **Tableau de bord** : statistiques (entrées/sorties du mois), alertes de stock bas, derniers mouvements
- **Stock actuel** : quantités en temps réel (entrées − sorties), filtres, statuts (Rupture / Stock bas / OK),
  export PDF et CSV
- **Articles** : code, désignation, catégorie, unité de mesure, seuil d'alerte
- **Entrées (bons de réception)** : articles reçus d'un fournisseur ou d'un marché, multi-articles par bon
- **Sorties (bons de distribution)** : articles distribués à un département, avec contrôle du stock
  disponible (impossible de distribuer plus que le stock existant)
- **Journal des mouvements** : historique complet filtrable (type, période, article)
- **Fournisseurs & marchés** et **Départements** : gestion des sources et des destinataires
- **Rapports** : état du stock, consommation par département, réceptions par source, journal des mouvements —
  export **PDF** et **CSV** (compatible Excel)
- **Paramètres** : sauvegarde/restauration des données, données de démonstration, réinitialisation

## 🗄️ Données

- Stockées localement, aucune connexion Internet requise
- Fichier : `%APPDATA%\gestion-stock-interne\gestion-stock.json`
- Faites une **sauvegarde régulière** (menu Paramètres) sur une clé USB ou le réseau

## 🧊 Règles métier

- Le stock est **calculé automatiquement** : il ne se modifie pas directement
- Une sortie ne peut **jamais dépasser** le stock disponible
- Supprimer un bon de réception est **bloqué** si cela rendrait le stock négatif
  (articles déjà distribués)
- Un article / une source / un département utilisé(e) dans des bons ne peut pas être supprimé(e)

## 📦 Créer un exécutable (optionnel)

Pour distribuer l'application sans installer Node.js sur les autres postes :

```bash
npm install --save-dev electron-builder
npx electron-builder --win portable
```

Le fichier `.exe` sera généré dans le dossier `dist/`.
