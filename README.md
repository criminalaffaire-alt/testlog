# 🎬 VoixOff Studio

Application web de montage vidéo avec **génération de voix off à partir d'un script**, 100 % côté navigateur (aucun serveur, aucune clé API, vos fichiers restent locaux).

## Fonctionnalités

- **Import de médias** : images et clips vidéo (locaux, jamais envoyés ailleurs).
- **Script → scènes** : chaque ligne du script devient une scène de la timeline, avec durée estimée à partir du texte.
- **Illustrations automatiques** : l'application analyse le script, en extrait les mots-clés et illustre chaque scène sans touches manuelles :
  - *Images libres par mots-clés* : recherche sur [Openverse](https://openverse.org) puis [Wikimedia Commons](https://commons.wikimedia.org) (licence libre, crédit affiché à l'écran),
  - *Dégradés animés* : fonds colorés générés localement, sans connexion Internet,
  - *Manuel* : vos médias importés ; si une image automatique ne se charge pas, un dégradé animé prend le relais.
- **Voix off TTS** : synthèse vocale du navigateur (Web Speech API), voix françaises mises en avant, vitesse et tonalité réglables par scène, préécoute par scène.
- **Timeline** : réorganisation (↑/↓), duplication, suppression, durée manuelle ou automatique, sous-titres affichés sur la vidéo.
- **Effets** : Ken Burns (zoom lent) sur les images, fondus entre les scènes.
- **Export vidéo** WebM (MediaRecorder) en temps réel, avec au choix :
  - *Capture audio de l'onglet* : enregistre la voix TTS (Chrome/Edge, cocher « Partager l'audio de l'onglet »),
  - *Fichiers audio importés* : attribués aux scènes dans l'ordre,
  - *Muet*.

## Lancement

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000 dans Chrome ou Edge
```

Ouvrir directement `index.html` fonctionne aussi.

## Navigateurs supportés

Chrome et Edge recommandés (TTS + capture audio d'onglet + MediaRecorder WebM). Firefox : tout fonctionne sauf la capture audio d'onglet (préférer les fichiers audio pour l'export).

## Structure

```
├── index.html   # Interface (médias/script · aperçu/timeline · réglages/export)
├── style.css    # Thème sombre
└── app.js       # Timeline, rendu canvas, TTS, illustrations auto, export MediaRecorder
```
