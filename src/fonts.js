// src/fonts.js
//
// Polices auto-hébergées via les packages npm @fontsource/* (01/10) —
// remplace le <link> Google Fonts externe (index.html) + sa règle de cache
// Workbox dédiée (vite.config.js, "google-fonts-v2").
//
// Pourquoi (constat utilisateur persistant malgré 2 correctifs précédents le
// 29/09 : (1) document.fonts.load() sur visibilitychange/pageshow/montage/
// intervalle 2min, (2) renommage du cache Workbox pour forcer un
// rechargement propre) : les deux correctifs réduisaient le risque mais
// dépendaient encore d'une ressource EXTERNE (fonts.googleapis.com/
// fonts.gstatic.com) — si cette ressource externe est lente/indisponible au
// moment précis où le navigateur tente de réparer une police évincée, la
// réparation elle-même peut échouer ou traîner, ce qui correspond
// exactement au symptôme signalé "encore" après ces 2 fixes.
//
// En embarquant les fichiers de police directement dans le build (via ces
// packages npm, mêmes polices Google Fonts, juste distribuées en WOFF2 par
// npm au lieu d'être servies par le CDN Google), elles deviennent des
// assets Vite comme n'importe quel autre fichier de l'app — précachées par
// vite-plugin-pwa dans LE MÊME précache que le reste du shell applicatif
// (JS/CSS), garanti disponible offline avec la même fiabilité que le code
// de l'app lui-même. Le mécanisme document.fonts.load() déjà en place
// (App.jsx) reste utile comme filet contre une éviction mémoire WebKit,
// mais sa réussite ne dépend plus JAMAIS d'un aller-retour réseau externe :
// la police est toujours déjà là, localement, aucune dépendance à
// fonts.googleapis.com/fonts.gstatic.com à l'exécution.
//
// Un seul poids par import (pas de fichier combiné) pour ne charger QUE les
// graisses réellement utilisées dans l'app — mêmes graisses que l'ancien
// <link> Google Fonts (index.html, avant retrait) :
//   Chakra Petch   600, 700
//   Archivo        700, 900
//   Archivo Black  400 (seule graisse existante)
//   Orbitron       700 (seule graisse utilisée dans l'app)
//   Russo One      400 (seule graisse existante)
//   Bebas Neue     400 (seule graisse existante)
//
// Sous-ensembles unicode `latin` + `latin-ext` uniquement (pas le fichier
// combiné `NNN.css` qui inclut aussi cyrillique/vietnamien/thaï selon la
// famille) : couvre tous les noms d'équipes/joueurs européens et
// sud-américains de l'app (accents français/espagnol/portugais/scandinaves/
// est-européens compris, latin-ext les couvre tous) sans charger ~100 Ko de
// polices pour des écritures jamais affichées ici — pur gain de poids de
// précache, aucune perte de couverture réelle pour ce projet.
import '@fontsource/chakra-petch/latin-600.css'
import '@fontsource/chakra-petch/latin-ext-600.css'
import '@fontsource/chakra-petch/latin-700.css'
import '@fontsource/chakra-petch/latin-ext-700.css'
import '@fontsource/archivo/latin-700.css'
import '@fontsource/archivo/latin-ext-700.css'
import '@fontsource/archivo/latin-900.css'
import '@fontsource/archivo/latin-ext-900.css'
import '@fontsource/archivo-black/latin-400.css'
import '@fontsource/archivo-black/latin-ext-400.css'
import '@fontsource/orbitron/latin-700.css'
import '@fontsource/russo-one/latin-400.css'
import '@fontsource/russo-one/latin-ext-400.css'
import '@fontsource/bebas-neue/latin-400.css'
import '@fontsource/bebas-neue/latin-ext-400.css'
