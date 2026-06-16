import '../mentionslegales.css'

function MentionsLegales() {
  return (
    <div className="mentions">
      <div className="mentions__container">
        <h1 className="mentions__title">Mentions légales</h1>
        <p className="mentions__intro">Conformément aux dispositions de la loi n° 2004-575 du 21 juin 2004 pour la Confiance en l'Économie Numérique (LCEN), les informations suivantes sont portées à la connaissance des utilisateurs du site StatFootix.</p>

        <section className="mentions__section">
          <h2>Éditeur du site</h2>
          <p>
            <strong>Nom du site :</strong> StatFootix<br />
            <strong>Nature :</strong> Site web personnel, à titre non commercial<br />
            <strong>Directeur de la publication :</strong> Ilan<br />
            <strong>Contact :</strong> korityx.pro@gmail.com
          </p>
        </section>

        <section className="mentions__section">
          <h2>Hébergement</h2>
          <p>
            <strong>Netlify, Inc.</strong><br />
            512 2nd Street, Suite 200<br />
            San Francisco, CA 94107, États-Unis<br />
            <a href="https://www.netlify.com" target="_blank" rel="noreferrer">www.netlify.com</a>
          </p>
        </section>

        <section className="mentions__section">
          <h2>Données sportives</h2>
          <p>Les données de matchs, scores, classements et statistiques sont fournies par l'API <strong>football-data.org</strong>. Ces données sont mises à jour automatiquement et peuvent présenter un léger décalage par rapport aux événements en direct. StatFootix n'est affilié à aucune fédération, ligue ou organisation sportive officielle.</p>
        </section>

        <section className="mentions__section">
          <h2>Propriété intellectuelle</h2>
          <p>L'ensemble du contenu du site StatFootix (design, textes, code source) est la propriété de l'éditeur. Les logos, emblèmes et visuels des équipes et compétitions sont la propriété de leurs détenteurs respectifs (UEFA, FIFA, clubs, etc.). Leur reproduction à des fins commerciales est strictement interdite. Toute utilisation sur ce site est exclusivement informative et non lucrative.</p>
        </section>

        <section className="mentions__section">
          <h2>Données personnelles & RGPD</h2>
          <p>StatFootix ne collecte aucune donnée personnelle des utilisateurs. Aucun compte, inscription ou formulaire n'est requis pour utiliser le site. Aucune donnée n'est transmise à des tiers à des fins commerciales.</p>
          <p>Conformément au Règlement Général sur la Protection des Données (RGPD - UE 2016/679), vous disposez d'un droit d'accès, de rectification et de suppression de vos données. Pour exercer ces droits, contactez-nous à l'adresse indiquée ci-dessus.</p>
        </section>

        <section className="mentions__section">
          <h2>Cookies</h2>
          <p>StatFootix utilise uniquement des cookies techniques et fonctionnels (cache local des données API) nécessaires au bon fonctionnement du site. Aucun cookie publicitaire ou de tracking tiers n'est utilisé. Ces données sont stockées localement dans votre navigateur et ne sont pas transmises à des serveurs externes.</p>
        </section>

        <section className="mentions__section">
          <h2>Liens hypertextes</h2>
          <p>StatFootix peut contenir des liens vers des sites tiers (sources d'actualités, API, etc.). L'éditeur ne saurait être tenu responsable du contenu de ces sites externes ni des dommages pouvant résulter de leur consultation. La présence de ces liens ne constitue pas une approbation de leur contenu.</p>
        </section>

        <section className="mentions__section">
          <h2>Responsabilité</h2>
          <p>Les informations présentées sur StatFootix sont fournies à titre informatif. Malgré le soin apporté à leur exactitude, elles peuvent comporter des erreurs, omissions ou délais. L'éditeur ne saurait être tenu responsable de toute décision prise sur la base de ces informations ni des interruptions de service liées à des problèmes techniques.</p>
        </section>

        <section className="mentions__section">
          <h2>Droit applicable & juridiction</h2>
          <p>Les présentes mentions légales sont régies par le droit français. En cas de litige et à défaut de résolution amiable, les tribunaux français seront seuls compétents.</p>
        </section>
      </div>
    </div>
  )
}

export default MentionsLegales
