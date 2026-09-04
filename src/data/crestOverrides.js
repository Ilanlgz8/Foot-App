/**
 * crestOverrides — écussons haute définition pour les clubs dont
 * football-data.org ne fournit qu'une image basse résolution.
 *
 * CONSTAT (04/09, remonté par l'utilisateur sur Monaco puis vérifié
 * systématiquement sur les 5 grands championnats en mesurant la taille réelle
 * de CHAQUE écusson) : football-data.org sert la quasi-totalité de ses
 * écussons en 200×200 px, mais 8 clubs de l'élite n'existent qu'en 70×70 px.
 * Affichés à 84 px (affiche "Match du jour", bandeaux de MatchPage /
 * LiveMatchPage), sur un écran retina (×2 = 168 px réels), ces 70 px sont
 * étirés ×2,4 → flou visible. Aucun réglage CSS ne peut corriger ça : les
 * pixels n'existent tout simplement pas dans le fichier source.
 *
 * SOLUTION : ESPN — déjà utilisé partout ailleurs dans l'app — publie les
 * mêmes écussons en 500×500 px sur un CDN public, sans clé ni quota. On
 * substitue donc l'URL UNIQUEMENT pour ces 8 clubs ; tous les autres
 * continuent d'utiliser football-data.org comme avant.
 *
 * Chaque correspondance ci-dessous a été vérifiée une par une (image chargée
 * et comparée visuellement au logo d'origine, taille confirmée à 500×500) —
 * aucune n'est déduite d'un nom ou devinée.
 *
 * NE PAS confondre les deux identifiants : la clé est l'id football-data.org
 * (celui qui apparaît dans crests.football-data.org/{id}.png), la valeur
 * contient l'id ESPN, qui est différent.
 *
 * Clubs volontairement ÉCARTÉS : l'endpoint /teams de football-data.org
 * renvoyait aussi Schalke, Elversberg, Málaga et Ipswich en 70 px, mais le
 * recoupement avec les effectifs ESPN de la saison en cours montre qu'ils ne
 * jouent pas dans un des 5 grands championnats — inutile de les traiter.
 * Naples (139×181) est en dessous des 200 px standards sans être en 70 px :
 * laissé tel quel, la dégradation n'est pas visible à l'œil.
 */

/** id football-data.org → id ESPN (écusson 500×500) */
const FD_TO_ESPN = {
  548: 174,   // Monaco          (Ligue 1)
  519: 172,   // Auxerre         (Ligue 1)
  351: 393,   // Nottingham      (Premier League)
  10:  134,   // Stuttgart       (Bundesliga)
  15:  2950,  // Mayence         (Bundesliga)
  16:  3841,  // Augsbourg       (Bundesliga)
  18:  268,   // M'gladbach      (Bundesliga)
  7:   127,   // Hambourg        (Bundesliga)
}

/** URL de l'écusson ESPN 500×500 correspondant, ou null si pas d'override. */
export function espnCrestFor(fdTeamId) {
  const espnId = FD_TO_ESPN[fdTeamId]
  return espnId ? `https://a.espncdn.com/i/teamlogos/soccer/500/${espnId}.png` : null
}

/**
 * Remplace, dans le corps JSON brut d'une réponse football-data.org, les URLs
 * d'écusson des clubs concernés par leur équivalent ESPN haute définition.
 *
 * Le remplacement est fait sur le TEXTE plutôt que sur l'objet parsé, à un
 * seul endroit (fdFetch.js), pour une raison de simplicité : `crest` apparaît
 * à des profondeurs différentes selon l'endpoint (matchs, classements,
 * buteurs, confrontations…) et est lu par une vingtaine de composants. Un
 * remplacement à la source couvre tous les cas d'un coup, sans toucher un
 * seul composant ni risquer d'en oublier un.
 *
 * @param {string} text  corps JSON brut
 * @returns {string}     le même texte, écussons substitués
 */
export function overrideCrestUrls(text) {
  if (typeof text !== 'string' || !text.includes('crests.football-data.org')) return text
  return text.replace(
    /https:\/\/crests\.football-data\.org\/(\d+)\.png/g,
    (whole, id) => espnCrestFor(Number(id)) ?? whole,
  )
}
