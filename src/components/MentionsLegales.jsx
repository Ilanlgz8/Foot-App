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
            <strong>Vercel Inc.</strong><br />
            340 S Lemon Ave #4133<br />
            Walnut, CA 91789, États-Unis<br />
            <a href="https://vercel.com" target="_blank" rel="noreferrer">vercel.com</a>
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
          <h2>Données personnelles & Politique de confidentialité</h2>
          <p>StatFootix ne demande ni compte, ni inscription, ni formulaire pour être utilisé. Les seules données traitées sont celles décrites ci-dessous, dans le cadre strict du fonctionnement du site.</p>
          <p><strong>Notifications push (si vous les activez).</strong> Votre navigateur génère alors un abonnement technique (une adresse de point de terminaison et des clés de chiffrement, aucune information d'identité) que nous stockons afin de pouvoir vous envoyer des alertes (but, mi-temps, fin de match) sur les compétitions que vous suivez. Cet abonnement est conservé jusqu'à ce qu'il expire ou devienne invalide, ou jusqu'à ce que vous désactiviez les notifications depuis l'application — l'entrée correspondante est alors supprimée automatiquement.</p>
          <p><strong>Adresse IP.</strong> Comme sur la plupart des sites web, votre adresse IP est traitée ponctuellement pour limiter les abus (protection anti-surcharge) sur certains services du site. Elle est conservée quelques minutes à quelques heures selon le service concerné, puis supprimée automatiquement, et n'est utilisée à aucune autre fin.</p>
          <p>Aucune donnée n'est vendue, ni partagée à des fins publicitaires, ni croisée avec d'autres sources pour vous identifier personnellement.</p>
          <p><strong>Sous-traitants techniques :</strong> Vercel (hébergement), Upstash (base de données), Ably (diffusion en temps réel des scores en direct), football-data.org et ESPN (données sportives). Ces prestataires peuvent traiter des données en dehors de l'Union Européenne dans le cadre de leur propre infrastructure.</p>
          <p>Conformément au Règlement Général sur la Protection des Données (RGPD - UE 2016/679), vous disposez d'un droit d'accès, de rectification et de suppression de vos données. Le moyen le plus simple de supprimer votre abonnement aux notifications est de les désactiver depuis l'application (cloche dans la barre de navigation) ; pour toute autre demande, contactez-nous à l'adresse indiquée ci-dessus.</p>
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
