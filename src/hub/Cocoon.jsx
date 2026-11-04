// Cocon d'une compétition : enveloppe colorée (couleur de la compétition) qui
// regroupe ses matchs — page Match et "à ne pas manquer" de l'Accueil.
import './hub.css'
import ligue1Tile from '../assets/leagues/ligue1-2026.png'
import ligue1Clean from '../assets/leagues/ligue1-2026-transparent.png'

export function CompetitionHead({ group, count }) {
  // Logo Ligue 1 : la tuile bleue pleine est remplacée par sa version détourée (blanc sur transparent).
  const emblem = group.emblem === ligue1Tile ? ligue1Clean : group.emblem
  const opaque = group.emblemOpaque && emblem !== ligue1Clean
  return (
    <>
      <span className={'hubCocoon__logo' + (opaque ? ' hubCocoon__logo--opaque' : '')}>
        {emblem
          ? <img src={emblem} alt="" loading="lazy" />
          : <span aria-hidden="true">⚽</span>}
      </span>
      <b className="hubCocoon__name">{group.name}</b>
      <span className="hubCocoon__count">{count}</span>
    </>
  )
}

// `alwaysBody` : le corps reste affiché même quand `open` est faux (Accueil : le 1er match
// reste visible, la flèche de l'en-tête déplie/replie le reste de la liste).
export function Cocoon({ group, count, open = true, onToggle, footer = null, alwaysBody = false, children }) {
  return (
    <section className="hubCocoon" style={{ '--acc': group.accent }}>
      {onToggle ? (
        <button
          type="button"
          className={'hubCocoon__head hubCocoon__head--btn' + (open ? ' is-open' : '')}
          onClick={onToggle}
          aria-expanded={open}
        >
          <CompetitionHead group={group} count={count} />
          <span className="hubCocoon__chev" aria-hidden="true">›</span>
        </button>
      ) : (
        <div className="hubCocoon__head">
          <CompetitionHead group={group} count={count} />
        </div>
      )}
      {(open || alwaysBody) && <div className="hubCocoon__body">{children}</div>}
      {open && footer}
    </section>
  )
}
