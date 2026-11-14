import '../mentionslegales.css'

// Mentions légales + politique de confidentialité + conditions d'utilisation (refonte 14/11/2026).
// Une seule page, ancres #mentions / #confidentialite / #conditions : l'URL
// /mentions-legales#confidentialite peut servir de « Privacy Policy URL » sur l'App Store / Play Store.
// ⚠️ À tenir à jour à chaque nouveau service tiers ou nouvelle donnée stockée (voir la liste des
// sous-traitants ci-dessous).

const CONTACT = 'korityx.pro@gmail.com'
const UPDATED = '14 novembre 2026'

function MentionsLegales() {
  return (
    <div className="mentions">
      <div className="mentions__container">
        <h1 className="mentions__title">Mentions légales et confidentialité</h1>
        <p className="mentions__intro">Dernière mise à jour : {UPDATED}</p>

        {/* ───────────── Mentions légales ───────────── */}
        <section className="mentions__section" id="mentions">
          <h2>Éditeur</h2>
          <p>
            <strong>StatFootix</strong> est un service gratuit, sans publicité ni achat, édité à titre
            personnel et non professionnel (loi n° 2004-575 du 21 juin 2004 pour la confiance dans
            l'économie numérique, article 6).<br />
            <strong>Éditeur et directeur de la publication :</strong> Ilan<br />
            <strong>Contact :</strong> <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </p>
        </section>

        <section className="mentions__section">
          <h2>Hébergement</h2>
          <p>
            <strong>Vercel Inc.</strong> — 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis —{' '}
            <a href="https://vercel.com" target="_blank" rel="noreferrer">vercel.com</a>
          </p>
        </section>

        <section className="mentions__section">
          <h2>Sources des données sportives</h2>
          <p>
            Les calendriers, scores, compositions, classements et statistiques proviennent de sources
            tierces : ESPN, football-data.org et la Fédération Française de Football (Ligue 2, Ligue 3).
            Ils sont mis à jour automatiquement et peuvent comporter un décalage ou des erreurs par rapport
            aux événements réels.
          </p>
          <p>
            StatFootix est un projet indépendant : il n'est ni affilié, ni approuvé, ni sponsorisé par la
            FIFA, l'UEFA, la FFF, la LFP, une ligue, un club ou l'une des sources citées.
          </p>
        </section>

        <section className="mentions__section">
          <h2>Propriété intellectuelle</h2>
          <p>
            Le nom, le design, les textes et le code de StatFootix appartiennent à l'éditeur. Les noms,
            logos et emblèmes des compétitions, clubs et sélections sont la propriété de leurs titulaires
            respectifs ; ils sont affichés uniquement pour identifier les équipes et compétitions, à des
            fins d'information. Tout titulaire de droits qui souhaite le retrait d'un élément peut écrire à
            l'adresse de contact : il sera retiré rapidement.
          </p>
        </section>

        {/* ───────────── Confidentialité ───────────── */}
        <section className="mentions__section" id="confidentialite">
          <h2>Politique de confidentialité</h2>
          <p>
            StatFootix fonctionne <strong>sans compte, sans inscription, sans publicité et sans outil de
            suivi publicitaire ou de mesure d'audience</strong>. Aucune donnée n'est vendue, louée ou
            utilisée pour du profilage. Responsable du traitement : l'éditeur (voir ci-dessus).
          </p>
        </section>

        <section className="mentions__section">
          <h2>Données traitées</h2>
          <ul className="mentions__list">
            <li>
              <strong>Notifications (uniquement si vous les activez).</strong> Un identifiant technique
              d'abonnement fourni par votre navigateur (adresse d'envoi et clés de chiffrement, sans nom ni
              e-mail) et la liste des compétitions et équipes suivies. But : vous envoyer les alertes de
              match demandées. Base : votre consentement, retirable à tout moment en désactivant les
              notifications dans l'app. Conservation : jusqu'à la désactivation ou l'expiration de
              l'abonnement, puis suppression automatique.
            </li>
            <li>
              <strong>Pronos entre amis (uniquement si vous créez ou rejoignez un groupe).</strong> Le
              pseudo que vous choisissez, un identifiant aléatoire généré sur votre appareil et vos
              pronostics, visibles des membres du groupe. Base : exécution du service que vous demandez.
              Conservation : 60 jours après la dernière activité du groupe, puis suppression automatique.
              Évitez d'utiliser votre vrai nom comme pseudo.
            </li>
            <li>
              <strong>Adresse IP.</strong> Utilisée brièvement pour limiter les abus (nombre de requêtes
              par minute) : conservée au plus une heure. Les journaux techniques de l'hébergeur peuvent
              aussi la contenir quelques jours, selon sa propre politique. Base : intérêt légitime (sécurité
              du service).
            </li>
            <li>
              <strong>Rapports d'erreur.</strong> En cas de plantage, un rapport technique est envoyé à
              Sentry (serveurs dans l'Union européenne) : message d'erreur, page concernée, type de
              navigateur et de système. Le service est configuré pour ne pas envoyer de données
              personnelles. Conservation : 30 jours. Base : intérêt légitime (corriger les bugs).
            </li>
          </ul>
        </section>

        <section className="mentions__section">
          <h2>Stockage sur votre appareil</h2>
          <p>
            StatFootix n'utilise <strong>aucun cookie publicitaire ni traceur</strong>. L'app enregistre
            seulement dans le stockage local de votre navigateur ce qui est nécessaire à son
            fonctionnement : favoris, préférences d'affichage, données en cache pour un chargement rapide
            et l'identifiant des Pronos entre amis. Ces éléments, strictement nécessaires au service, ne
            demandent pas de consentement ; vous pouvez les effacer en vidant les données du site dans
            votre navigateur.
          </p>
        </section>

        <section className="mentions__section">
          <h2>Prestataires techniques</h2>
          <p>
            Ces prestataires traitent des données uniquement pour faire fonctionner le service :
            Vercel (hébergement), Cloudflare (tâches automatiques), Upstash et Turso (bases de données),
            Ably (scores en direct), Sentry (rapports d'erreur). Pour afficher les logos, drapeaux et
            certaines données, votre navigateur contacte aussi directement les serveurs d'ESPN,
            football-data.org, de la FFF et de flagcdn, qui reçoivent alors votre adresse IP comme pour
            toute page web.
          </p>
          <p>
            Certains de ces prestataires sont situés hors de l'Union européenne, notamment aux
            États-Unis. Ces transferts s'appuient sur les garanties prévues par le RGPD (certification
            au Data Privacy Framework UE–États-Unis ou clauses contractuelles types de la Commission
            européenne, selon le prestataire).
          </p>
        </section>

        <section className="mentions__section">
          <h2>Vos droits</h2>
          <p>
            Conformément au RGPD (règlement UE 2016/679) et à la loi Informatique et Libertés, vous
            disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et
            de portabilité. Le plus simple : désactiver les notifications dans l'app, quitter votre groupe
            de pronos et vider les données du site. Pour toute autre demande, écrivez à{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a> (réponse sous un mois au plus). Vous pouvez aussi
            adresser une réclamation à la CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noreferrer">cnil.fr</a>).
          </p>
          <p>
            Les fonctions qui demandent votre accord (notifications) sont destinées aux personnes de
            15 ans et plus, ou aux plus jeunes avec l'accord d'un parent.
          </p>
        </section>

        {/* ───────────── Conditions d'utilisation ───────────── */}
        <section className="mentions__section" id="conditions">
          <h2>Conditions d'utilisation</h2>
          <p>
            StatFootix est gratuit et fourni « en l'état », à titre informatif. L'éditeur fait de son mieux
            pour que les informations soient exactes et le service disponible, sans pouvoir le garantir :
            il ne peut être tenu responsable d'une erreur, d'un retard, d'une interruption ou d'une
            décision prise sur la base des informations affichées.
          </p>
          <p>
            <strong>Pronostics.</strong> Les probabilités et pronostics affichés sont des estimations
            statistiques, à titre de divertissement. StatFootix n'est pas un site de paris : aucune mise
            d'argent, aucun gain, aucun lien avec un opérateur de jeux. Les jeux d'argent sont interdits
            aux mineurs ; en cas de besoin, Joueurs Info Service : 09 74 75 13 13 (appel non surtaxé).
          </p>
          <p>
            <strong>Pseudos.</strong> Dans les Pronos entre amis, les pseudos injurieux, discriminatoires
            ou usurpant l'identité d'autrui sont interdits ; l'éditeur peut les supprimer.
          </p>
        </section>

        <section className="mentions__section">
          <h2>Liens externes</h2>
          <p>
            StatFootix contient des liens vers des sites tiers (articles de presse, diffuseurs, sources de
            données). L'éditeur n'est pas responsable de leur contenu.
          </p>
        </section>

        <section className="mentions__section">
          <h2>Droit applicable</h2>
          <p>
            Ces mentions sont régies par le droit français. En cas de litige, une solution amiable sera
            recherchée en priorité, à l'adresse de contact ; à défaut, les tribunaux français sont
            compétents.
          </p>
        </section>
      </div>
    </div>
  )
}

export default MentionsLegales
