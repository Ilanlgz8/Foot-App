/**
 * ProfilPage.jsx — page « Mon profil » (/profil), 17/11.
 * Ouverte par l'icône profil du haut d'écran (à la place de « Pronos » et de la cloche).
 * Regroupe : Mes pronos, Favoris et notifications (l'ancienne cloche), Thème (Sobre / Néon),
 * Mentions légales. Rien n'est inventé : les chiffres viennent des mêmes stockages locaux que
 * les pages Pronos et Favoris.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useFavoriteTeams } from '../hooks/useFavoriteTeams'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { getTheme, setTheme, getCardOdds, setCardOdds } from '../utils/theme'
import '../profil.css'

function readPronosGroup() {
  try { return JSON.parse(localStorage.getItem('pronos_group') ?? 'null') } catch { return null }
}

const Chevron = () => (
  <svg className="profil__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
)

function Row({ to, icon, tone, title, sub, value, valueTone }) {
  return (
    <Link to={to} className="profil__row">
      <span className={`profil__rowIcon profil__rowIcon--${tone}`}>{icon}</span>
      <span className="profil__rowText">
        <span className="profil__rowTitle">{title}</span>
        {sub && <span className="profil__rowSub">{sub}</span>}
      </span>
      {value ? <span className={`profil__rowValue${valueTone ? ` profil__rowValue--${valueTone}` : ''}`}>{value}</span> : <span />}
      <Chevron />
    </Link>
  )
}

function ThemeCard({ id, active, onPick, title, sub }) {
  return (
    <button
      type="button"
      className={`profil__theme profil__theme--${id}${active ? ' profil__theme--active' : ''}`}
      aria-pressed={active}
      onClick={() => onPick(id)}
    >
      <span className="profil__themePreview" aria-hidden="true">
        <span className="profil__themeFlag profil__themeFlag--a" />
        <span className="profil__themeTime">20:45</span>
        <span className="profil__themeFlag profil__themeFlag--b" />
      </span>
      <span className="profil__themeFoot">
        <span className="profil__themeText">
          <span className="profil__themeTitle">{title}</span>
          <span className="profil__themeSub">{sub}</span>
        </span>
        <span className="profil__themeCheck" aria-hidden="true">
          {active && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 5 5 9-10" /></svg>}
        </span>
      </span>
    </button>
  )
}

export default function ProfilPage() {
  const { status } = usePushNotifications()
  const { favorites: favComps } = useFavoriteTeams()
  const { favorites: favClubs } = useFavoriteClubs()
  const [theme, setThemeState] = useState(getTheme)
  const [cardOdds, setCardOddsState] = useState(getCardOdds)
  const toggleCardOdds = () => { const v = !cardOdds; setCardOdds(v); setCardOddsState(v) }
  const group = readPronosGroup()

  const pickTheme = (t) => { setTheme(t); setThemeState(t) }

  const notif = status === 'subscribed' ? ['Activées', 'on']
    : status === 'denied' ? ['Bloquées', 'off']
    : status === 'unsupported' ? ['Indisponibles', null]
    : status === 'checking' || status === 'loading' ? ['…', null]
    : ['Désactivées', null]

  const favCount = (favComps?.length ?? 0) + (favClubs?.length ?? 0)

  return (
    <section className="profil">
      <div className="profil__inner">
        <div className="profil__head">
          <div className="profil__avatar" aria-hidden="true">
            {group?.name ? group.name.trim().charAt(0).toUpperCase() : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
            )}
          </div>
          <div className="profil__headText">
            <h1 className="profil__title">Mon profil</h1>
            <p className="profil__subtitle">
              {group?.name ? <>Pseudo des pronos : <strong>{group.name}</strong></> : 'Pas encore de groupe de pronos'}
            </p>
          </div>
        </div>

        <nav className="profil__list" aria-label="Profil">
          <Row
            to="/pronos" tone="red" title="Mes pronos"
            sub={group?.code ? `Groupe ${group.code}` : 'Créer ou rejoindre un groupe'}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>}
          />
          <Row
            to="/favoris" tone="green" title="Notifications"
            sub="Buts, mi-temps, fin de match"
            value={notif[0]} valueTone={notif[1]}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10.5 21a2 2 0 0 0 3 0" /></svg>}
          />
          <Row
            to="/favoris" tone="yellow" title="Mes favoris"
            sub="Équipes et compétitions suivies"
            value={favCount > 0 ? String(favCount) : null}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>}
          />
        </nav>

        <h2 className="profil__section">Thème</h2>
        <div className="profil__themes">
          <ThemeCard id="sobre" active={theme === 'sobre'} onPick={pickTheme} title="Sobre" sub="Clair et lisible · par défaut" />
          <ThemeCard id="neon" active={theme === 'neon'} onPick={pickTheme} title="Néon" sub="Le style d'origine de StatFootix" />
          <ThemeCard id="jaune" active={theme === 'jaune'} onPick={pickTheme} title="Jaune" sub="Sobre, avec les cotes en jaune" />
        </div>
        <p className="profil__note">Ton choix est gardé sur ce téléphone.</p>

        <h2 className="profil__section">Affichage</h2>
        <div className="profil__list">
          <button type="button" className="profil__row profil__row--toggle" role="switch" aria-checked={cardOdds} onClick={toggleCardOdds}>
            <span className="profil__rowText">
              <span className="profil__rowTitle">Cotes sur les cartes</span>
              <span className="profil__rowSub">Accueil et page Match. Les pages des matchs les gardent.</span>
            </span>
            <span className={`profil__switch${cardOdds ? ' profil__switch--on' : ''}`} aria-hidden="true"><span /></span>
          </button>
        </div>

        <nav className="profil__list" aria-label="Informations">
          <Link to="/mentions-legales" className="profil__row profil__row--plain">
            <span className="profil__rowTitle">Mentions légales et confidentialité</span>
            <Chevron />
          </Link>
        </nav>
      </div>
    </section>
  )
}
