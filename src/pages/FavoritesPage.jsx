/**
 * FavoritesPage — page dédiée (route /favoris), ouverte depuis la cloche.
 *
 * Remplace l'ancien popover (FavoriteTeamsPanel) : retour utilisateur — "un
 * grand affichage" plutôt qu'un panneau étroit. Regroupe tout ce qui touche
 * aux préférences de suivi :
 *   1. Activation des notifications push (inchangé, usePushNotifications)
 *   2. Championnats suivis pour le FILTRE DE NOTIFS (useFavoriteTeams — nom
 *      historique trompeur, c'est bien un filtre par compétition, pas par
 *      équipe, voir le commentaire dans ce hook)
 *   3. Équipes favorites pour la MISE EN AVANT dans l'app (useFavoriteClubs,
 *      nouveau hook distinct) — Classement (ligne surlignée + étoile,
 *      réutilisable partout où StandingsTable est déjà utilisé), Accueil
 *      (bandeau "Mon équipe") et Programme/Résultats (badge étoile).
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePushNotifications, resyncFavoriteTeams } from '../hooks/usePushNotifications'
import { useFavoriteTeams } from '../hooks/useFavoriteTeams'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { useStandings } from '../hooks/useStandings'
import { COMPETITIONS, COMPETITION_ESPN_SLUG } from '../data/competitions'
import { StandingsTable } from '../components/StandingsTable'
import { translateTeam } from '../data/teamNames'
import { getTeamColor, hexToRgbTriplet } from '../data/teamPhotos'
import '../favoritesPage.css'

function formatGroupName(raw = '') {
  return raw.replace('GROUP_', 'Groupe ').replace(/_/g, ' ')
}

export default function FavoritesPage() {
  const navigate = useNavigate()
  const { status, subscribe, unsubscribe } = usePushNotifications()
  const { favorites: favComps, toggle: toggleComp } = useFavoriteTeams()
  const { favorites: favClubs, isFavorite: isFavClub, toggle: toggleFavClub, atLimit } = useFavoriteClubs()
  const [selectedComp, setSelectedComp] = useState('WC')

  const { standings, groups, loading, error } = useStandings(selectedComp)
  const isMultiGroup = groups.length > 1

  const isSubscribed = status === 'subscribed'
  const isLoading    = status === 'loading'
  const isDenied     = status === 'denied'

  const handleToggleComp = (slug) => {
    toggleComp(slug)
    if (isSubscribed) resyncFavoriteTeams()
  }

  return (
    <div className="favPage">
      <div className="favPage__header">
        <button className="favPage__back" onClick={() => navigate(-1)} aria-label="Retour" type="button">‹</button>
        <h1 className="favPage__title">Favoris &amp; notifications</h1>
      </div>

      <section className="favPage__section">
        <h2 className="favPage__sectionTitle">Notifications</h2>
        <p className="favPage__hint">Reçois une notification à chaque but, mi-temps et fin de match.</p>
        {isDenied ? (
          <p className="favPage__hint favPage__hint--warn">Notifications bloquées — active-les dans les réglages de ton navigateur.</p>
        ) : isSubscribed ? (
          <button className="favPage__btn favPage__btn--danger" onClick={unsubscribe} disabled={isLoading} type="button">
            Désactiver les notifications
          </button>
        ) : (
          <button className="favPage__btn favPage__btn--accent" onClick={subscribe} disabled={isLoading} type="button">
            {isLoading ? 'Activation…' : 'Activer les notifications'}
          </button>
        )}
      </section>

      <section className="favPage__section">
        <h2 className="favPage__sectionTitle">Championnats suivis</h2>
        <p className="favPage__hint">
          {favComps.length === 0
            ? "Aucune sélection = tu reçois les notifs de tous les championnats."
            : `Tu ne recevras les notifs que pour ces ${favComps.length} championnat${favComps.length > 1 ? 's' : ''}.`}
        </p>
        <div className="favPage__chipGrid">
          {COMPETITIONS.map(comp => {
            const slug = COMPETITION_ESPN_SLUG[comp.id]
            if (!slug) return null
            const active = favComps.includes(slug)
            return (
              <button
                key={comp.id}
                className={`favPage__chip${active ? ' favPage__chip--active' : ''}`}
                onClick={() => handleToggleComp(slug)}
                type="button"
              >
                {comp.emblem && <img src={comp.emblem} alt="" />}
                <span>{comp.shortName}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="favPage__section">
        <h2 className="favPage__sectionTitle">Mes équipes</h2>
        <p className="favPage__hint">
          {favClubs.length === 0
            ? 'Choisis les équipes que tu suis — elles seront mises en avant dans le classement, l’accueil et le programme.'
            : `${favClubs.length} équipe${favClubs.length > 1 ? 's' : ''} suivie${favClubs.length > 1 ? 's' : ''}${atLimit ? ' — maximum atteint' : ''}.`}
        </p>

        {favClubs.length > 0 && (
          <div className="favPage__clubChips">
            {favClubs.map(t => {
              const color = getTeamColor(t.shortName || t.name)
              const rgb = hexToRgbTriplet(color)
              return (
                <button
                  key={t.id}
                  className="favPage__clubChip"
                  style={{ '--chip-color': color, '--chip-color-rgb': rgb }}
                  onClick={() => toggleFavClub(t)}
                  type="button"
                >
                  {t.crest && <img src={t.crest} alt="" />}
                  <span>{translateTeam(t.shortName || t.name)}</span>
                  <span className="favPage__clubChipX" aria-hidden="true">×</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="favPage__chipGrid favPage__chipGrid--tabs">
          {COMPETITIONS.map(comp => (
            <button
              key={comp.id}
              className={`favPage__chip${selectedComp === comp.id ? ' favPage__chip--active' : ''}`}
              onClick={() => setSelectedComp(comp.id)}
              type="button"
            >
              {comp.emblem && <img src={comp.emblem} alt="" />}
              <span>{comp.shortName}</span>
            </button>
          ))}
        </div>

        {loading && <p className="favPage__state">Chargement du classement…</p>}
        {error && <p className="favPage__state favPage__state--error">Classement non disponible pour cette compétition.</p>}

        {!loading && !error && isMultiGroup && (
          <div className="favPage__groups">
            {groups.map(g => (
              <div key={g.name} className="favPage__group">
                <p className="favPage__groupTitle">{formatGroupName(g.name)}</p>
                <StandingsTable
                  rows={g.table}
                  compact
                  isCountry={selectedComp === 'WC'}
                  favoritable
                  isFavorite={isFavClub}
                  onToggleFavorite={toggleFavClub}
                  favLimitReached={atLimit}
                  compCode={selectedComp}
                />
              </div>
            ))}
          </div>
        )}

        {!loading && !error && !isMultiGroup && standings.length > 0 && (
          <StandingsTable
            rows={standings}
            isCountry={selectedComp === 'WC'}
            favoritable
            isFavorite={isFavClub}
            onToggleFavorite={toggleFavClub}
            favLimitReached={atLimit}
            compCode={selectedComp}
          />
        )}
      </section>
    </div>
  )
}
