# 🎬 VoixOff Studio

Application web de montage vidéo avec **génération de voix off à partir d'un script**, 100 % côté navigateur (aucun serveur, aucune clé API, vos fichiers restent locaux).

## Fonctionnalités

- **Import de médias** : images et clips vidéo (locaux, jamais envoyés ailleurs).
- **Script → scènes** : chaque ligne du script devient une scène de la timeline, avec durée estimée à partir du texte.
- **Animation par prompt** (mode recommandé) : pour chaque scène, vous précisez dans le panneau de droite :
  - *Passage du script* : le texte lu par la voix off,
  - *Description visuelle / Prompt de génération* : décrite en français libre (ex. « coucher de soleil sur l'océan, vagues lentes »), le moteur détecte le thème et anime la scène en temps réel — 28 thèmes détectés : documentaire (savane, faune, reportage), aurores boréales, sous l'eau, soleil, fête, désert, neige, océan, pluie, feu, forêt, champs, montagnes, nuit étoilée, ville, film noir, historique sépia, route de nuit, brouillard, automne, printemps, technologie/IA, argent, sport, amour, santé, cuisine, abstrait,
  - *Type de plan* : plan large, plan moyen, gros plan, plongée, contre-plongée, travelling latéral ou zoom avant progressif.
- **Illustrations automatiques** : l'application analyse le script, en extrait les mots-clés et illustre chaque scène sans touches manuelles :
  - *Images libres par mots-clés* : recherche sur [Openverse](https://openverse.org) puis [Wikimedia Commons](https://commons.wikimedia.org) (licence libre, crédit affiché à l'écran),
  - *Dégradés animés* : fonds colorés générés localement, sans connexion Internet,
  - *Manuel* : vos médias importés ; si une image automatique ne se charge pas, un dégradé animé prend le relais.
- **Voix off TTS** : synthèse vocale du navigateur (Web Speech API), voix françaises mises en avant, vitesse et tonalité réglables par scène, préécoute par scène.
- **Musique de fond** : importez un fichier audio, volume réglable, boucle automatique — mixé à la voix TTS et aux fichiers audio dans la vidéo exportée.
- **Transitions** entre les scènes : fondu au noir, fondu enchaîné, fondu au blanc, glissement latéral, zoom, ou coupe franche.
- **Timeline** : réorganisation (↑/↓), duplication, suppression, durée manuelle ou automatique, sous-titres affichés sur la vidéo.
- **Effets** : Ken Burns (zoom lent) sur les images.
- **Export vidéo** en temps réel, **MP4 (H.264)** si le navigateur le supporte (Chrome récent, Safari), sinon **WebM** ; audio : capture de l'onglet (voix TTS), fichiers audio importés, ou muet.

## Lancement

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000 dans Chrome ou Edge
```

Ouvrir directement `index.html` fonctionne aussi.

## Navigateurs supportés

Chrome et Edge recommandés (TTS + capture audio d'onglet + MediaRecorder MP4/WebM). Firefox : tout fonctionne sauf la capture audio d'onglet et l'export MP4 (préférer les fichiers audio pour l'export).

## Structure

```
├── index.html   # Interface (médias/script · aperçu/timeline · musique/transitions/export)
├── style.css    # Thème sombre
└── app.js       # Timeline, transitions, rendu canvas, TTS, mixage audio, export MediaRecorder
```
