// Liste des sélections nationales pouvant être suivies en favori (notifs
// filtrées). Sous-ensemble de TEAM_NAMES_FR (clés = noms bruts tels que
// renvoyés par ESPN, valeurs = affichage FR) — limité aux nations pour
// l'instant (les noms de clubs sont plus ambigus d'une source à l'autre,
// donc pas encore couverts par le filtre de notifs).
import { TEAM_NAMES_FR } from './teamNames'

export const NATIONAL_TEAM_KEYS = [
  // Euro / Nations
  'Germany', 'Scotland', 'Hungary', 'Switzerland', 'Spain', 'Croatia',
  'Italy', 'Albania', 'Poland', 'Netherlands', 'Slovenia', 'Denmark',
  'Serbia', 'England', 'Romania', 'Ukraine', 'Belgium', 'Slovakia',
  'Austria', 'France', 'Turkey', 'Georgia', 'Portugal', 'Czechia',
  // Coupe du monde
  'Mexico', 'South Africa', 'Korea Republic', 'Canada', 'Bosnia-H.',
  'USA', 'Paraguay', 'Qatar', 'Brazil', 'Morocco', 'Haiti', 'Australia',
  'Curaçao', 'Japan', 'Ivory Coast', 'Ecuador', 'Sweden', 'Tunisia',
  'Cape Verde', 'Egypt', 'Saudi Arabia', 'Uruguay', 'Iran', 'New Zealand',
  'Senegal', 'Iraq', 'Norway', 'Argentina', 'Algeria', 'Jordan',
  'Congo DR', 'Ghana', 'Panama', 'Uzbekistan', 'Colombia',
]

// Liste triée par affichage FR (plus pratique pour un sélecteur utilisateur)
export const NATIONAL_TEAMS_SORTED = NATIONAL_TEAM_KEYS
  .map(key => ({ key, label: TEAM_NAMES_FR[key] ?? key }))
  .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
