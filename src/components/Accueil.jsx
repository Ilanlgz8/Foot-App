import { useNews } from '../hooks/useNews'
import { useTodayMatches } from '../hooks/useTodayMatches'
import { translateTeam } from '../data/teamNames'
import { COMPETITIONS } from '../data/competitions'
import '../accueil.css'

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit'
  })
}

function Accueil() {
  const { news, loading: newsLoading, error: newsError } = useNews()
  const { matches, loading: matchesLoading } = useTodayMatches()

  const todayStr = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <section className="accueil">
      <div className="accueil__backdrop accueil__backdrop--one" />
      <div className="accueil__backdrop accueil__backdrop--two" />

      <div className="accueil__inner">

        {/* Hero */}
        <div className="accueil__hero">
          <p className="accueil__kicker">
            <span className="accueil__kickerDot" />
            Actualités football
          </p>
          <h1 className="accueil__title">
            L'actu du <span>football</span>
          </h1>
          <p className="accueil__subtitle">
            Les dernières nouvelles des championnats européens
          </p>
        </div>

        {/* Matchs du jour */}
        <div className="accueil__section">
          <div className="accueil__sectionHeader">
            <h2 className="accueil__sectionTitle">Matchs du jour</h2>
            <span className="accueil__sectionDate">{todayStr}</span>
          </div>

          {matchesLoading && (
            <div className="accueil__state">
              <div className="accueil__spinner" />
              <span>Chargement des matchs...</span>
            </div>
          )}

          {!matchesLoading && matches.length === 0 && (
            <p className="accueil__empty">Aucun match aujourd'hui.</p>
          )}

          {!matchesLoading && matches.length > 0 && (
            <div className="accueil__matches">
              {matches.map(match => {
                const comp = COMPETITIONS.find(c => c.id === match.competition?.code)
                const isLive = match.status === 'IN_PLAY' || match.status === 'PAUSED'
                const isFinished = match.status === 'FINISHED'
                const homeScore = match.score?.fullTime?.home
                const awayScore = match.score?.fullTime?.away

                return (
                  <div key={match.id} className={`accueil__match ${isLive ? 'accueil__match--live' : ''}`}>
                    <div className="accueil__matchComp">
                      {comp?.emblem && (
                        <img src={comp.emblem} alt="" className="accueil__matchCompLogo"
                          onError={e => e.currentTarget.style.display = 'none'} />
                      )}
                      <span className="accueil__matchCompName">
                        {comp?.name ?? match.competition?.name}
                      </span>
                      {isLive && <span className="accueil__matchLiveBadge">● Live</span>}
                    </div>

                    <div className="accueil__matchRow">
                      <span className="accueil__matchTeam accueil__matchTeam--home">
                        {match.homeTeam.crest && (
                          <img src={match.homeTeam.crest} alt="" className="accueil__matchCrest"
                            onError={e => e.currentTarget.style.display = 'none'} />
                        )}
                        {translateTeam(match.homeTeam.shortName || match.homeTeam.name)}
                      </span>

                      <div className="accueil__matchScore">
                        {isFinished || isLive ? (
                          <span className="accueil__matchScoreNums">
                            {homeScore ?? 0} — {awayScore ?? 0}
                          </span>
                        ) : (
                          <span className="accueil__matchScoreTime">
                            {formatHour(match.utcDate)}
                          </span>
                        )}
                      </div>

                      <span className="accueil__matchTeam accueil__matchTeam--away">
                        {translateTeam(match.awayTeam.shortName || match.awayTeam.name)}
                        {match.awayTeam.crest && (
                          <img src={match.awayTeam.crest} alt="" className="accueil__matchCrest"
                            onError={e => e.currentTarget.style.display = 'none'} />
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* News */}
        <div className="accueil__section">
          <div className="accueil__sectionHeader">
            <h2 className="accueil__sectionTitle">Dernières actualités</h2>
          </div>

          {newsLoading && (
            <div className="accueil__state">
              <div className="accueil__spinner" />
              <span>Chargement des articles...</span>
            </div>
          )}

          {newsError && (
            <p className="accueil__state accueil__state--error">{newsError}</p>
          )}

          {!newsLoading && !newsError && (
            <div className="accueil__grid">
              {news.length === 0 && (
                <p className="accueil__empty">Aucun article disponible.</p>
              )}
              {news.map(article => (
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
                    {article.source && (
                      <span className="accueil__cardSource">{article.source}</span>
                    )}
                    <h3 className="accueil__cardTitle">{article.title}</h3>
                    {article.description && (
                      <p className="accueil__cardDesc">{article.description}</p>
                    )}
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

      </div>
    </section>
  )
}

export default Accueil