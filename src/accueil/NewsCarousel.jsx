import { useState, useEffect } from 'react'

// Un seul article par page — les flèches de navigation sont dans l'en-tête
// (à côté du titre), ce qui libère la carte pour qu'elle remplisse toute la
// largeur disponible (donc bien plus grande sur mobile, au lieu de 3 petites
// cards côte à côte / empilées).
const PER_PAGE = 1

export function NewsCarousel({ news, loading, error }) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(news.length / PER_PAGE)
  const slice = news.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)

  useEffect(() => {
    if (loading || pages <= 1) return
    const id = setInterval(() => setPage(p => (p + 1) % pages), 20000)
    return () => clearInterval(id)
  }, [page, pages, loading])

  return (
    <div className="accueil__section">
      <div className="accueil__sectionHeader">
        <h2 className="accueil__sectionTitle">Dernières actualités</h2>
        {!loading && pages > 1 && (
          <div className="accueil__carouselHeaderNav">
            <button
              className="accueil__carouselArrow accueil__carouselArrow--sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label="Article précédent"
            >‹</button>
            <button
              className="accueil__carouselArrow accueil__carouselArrow--sm"
              onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
              disabled={page === pages - 1}
              aria-label="Article suivant"
            >›</button>
          </div>
        )}
      </div>

      {loading && (
        <div className="accueil__grid accueil__grid--carousel">
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
        <div className="accueil__grid accueil__grid--carousel" key={page}>
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
