// Cocon d'une compétition : enveloppe colorée (couleur de la compétition) qui
// regroupe ses matchs — page Match et "à ne pas manquer" de l'Accueil.
import './hub.css'

export function CompetitionHead({ group, count }) {
  return (
    <>
      <span className={'hubCocoon__logo' + (group.emblemOpaque ? ' hubCocoon__logo--opaque' : '')}>
        {group.emblem
          ? <img src={group.emblem} alt="" loading="lazy" />
          : <span aria-hidden="true">⚽</span>}
      </span>
      <b className="hubCocoon__name">{group.name}</b>
      <span className="hubCocoon__count">{count}</span>
    </>
  )
}

export function Cocoon({ group, count, open = true, onToggle, footer = null, children }) {
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
      {open && <div className="hubCocoon__body">{children}</div>}
      {open && footer}
    </section>
  )
}
