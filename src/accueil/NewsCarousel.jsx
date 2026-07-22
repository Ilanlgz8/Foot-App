import { useState, useEffect } from 'react'
import { useSwipe } from '../hooks/useSwipe'

// Un seul article par page sur mobile — les flèches de navigation sont dans
// l'en-tête (à côté du titre), ce qui libère la carte pour qu'elle remplisse
// toute la largeur disponible (donc bien plus grande sur mobile, au lieu de
// 3 petites cards côte à côte / empilées).
// Sur desktop (demande utilisateur : "un seul sur desktop ça fait trop
// gros") : 3 articles par ligne — piloté par le parent (Accueil.jsx, déjà en
// possession de l'état isDesktop pour le reste de la refonte) via la prop
// `perPage`, pour éviter un 2e écouteur matchMedia redondant ici.
export function NewsCarousel({ news, loading, error, perPage = 1 }) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(news.length / perPage)
  // Filet de sécurité calculé au render (pas via un effet + setState, pour
  // éviter un aller-retour de rendu inutile) : si perPage change (resize
  // croisant le breakpoint desktop pendant que l'utilisateur est sur une
  // page > 0), `page` peut se retrouver hors bornes une fois `pages`
  // recalculé — repli sur la dernière page valide plutôt qu'une page vide.
  const page_ = pages === 0 ? 0 : Math.min(page, pages - 1)
  const slice = news.slice(page_ * perPage, page_ * perPage + perPage)

  useEffect(() => {
    if (loading || pages <= 1) return
    const id = setInterval(() => setPage(p => (p + 1) % pages), 20000)
    return () => clearInterval(id)
  }, [pages, loading])

  // Swipe tactile mobile (question utilisateur) — même hook que MatchPage/
  // LiveMatchPage (finger-follow, axis locking, spring-back), réutilisé ici
  // pour rester cohérent avec le reste de l'app plutôt que d'inventer une 2e
  // logique de swipe. Boucle sur les extrémités (comme l'auto-rotation
  // ci-dessus) : swiper à gauche sur le dernier article revient au premier,
  // et inversement — plus naturel qu'un blocage sec en bout de liste.
  const swipe = useSwipe(
    () => { if (pages > 1) setPage(p => (p + 1) % pages) },
    () => { if (pages > 1) setPage(p => (p - 1 + pages) % pages) },
  )

  return (
    <div className="accueil__section">
      <div className="accueil__sectionHeader">
        <h2 className="accueil__sectionTitle">Dernières actualités</h2>
        {!loading && pages > 1 && (
          <div className="accueil__carouselHeaderNav">
            <button
              className="accueil__carouselArrow accueil__carouselArrow--sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page_ === 0}
              aria-label="Article précédent"
            >‹</button>
            <button
              className="accueil__carouselArrow accueil__carouselArrow--sm"
              onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
              disabled={page_ === pages - 1}
              aria-label="Article suivant"
            >›</button>
          </div>
        )}
      </div>

      {loading && (
        <div className={`accueil__grid accueil__grid--carousel${perPage > 1 ? ' accueil__grid--carousel3' : ''}`}>
          <div className="accueil__card" style={{ pointerEvents: 'none' }}>
            <div className="sk" style={{ width: '100%', aspectRatio: '16/9' }} />
            <div className="accueil__cardBody" style={{ gap: '0.6rem' }}>
              <div className="sk" style={{ width: '4rem', height: '0.6rem' }} />
              <div className="sk" style={{ width: '100%', height: '0.85rem' }} />
              <div className="sk" style={{ width: '80%', height: '0.85rem' }} />
            </div>
          </div>
        </div>
      )}

      {error && <p className="accueil__state accueil__state--error">{error}</p>}

      {!loading && !error && (
        <div
          ref={swipe.ref}
          className={`accueil__grid accueil__grid--carousel${perPage > 1 ? ' accueil__grid--carousel3' : ''}`}
          key={page_}
          style={{
            transform: `translateX(${swipe.dragOffset}px)`,
            transition: swipe.isDragging ? 'none' : 'transform 0.25s ease',
            touchAction: 'pan-y',
          }}
        >
          {slice.length === 0 && <p className="accueil__empty">Aucun article disponible.</p>}
          {slice.map(article => (
            <a key={article.url} href={article.url}
              target="_blank" rel="noreferrer" className="accueil__card">
              {article.image && (
                <div className="accueil__cardImgWrap">
                  <img src={article.image} alt={article.title}
                    className="accueil__cardImg"
                    onError={e => e.currentTarget.style.display = 'none'} />
                </div>
              )}
              <div className="accueil__cardBody">
                {article.source && <span className="accueil__cardSource">{article.source}</span>}
                <h3 className="accueil__cardTitle">{article.title}</h3>
                {article.description && <p className="accueil__cardDesc">{article.description}</p>}
                <div className="accueil__cardFooter">
                  <span className="accueil__cardDate">
                    {new Date(article.publishedAt).toLocaleDateString('fr-FR', {
                      day: '2-digit', month: 'short', year: 'numeric'
                    })}
                  </span>
                  <span className="accueil__cardLink">Lire l'article →</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
