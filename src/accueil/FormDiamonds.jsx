// FormDiamonds — 5 derniers résultats d'une équipe sous forme de losanges
// (vert = victoire, jaune = nul, rouge = défaite), du plus ancien (gauche) au
// plus récent (droite). Masqué si aucune donnée de forme (pas de placeholder
// vide, cf. logique déjà appliquée au H2H dans MatchModal.jsx).
export function FormDiamonds({ form }) {
  if (!form || form.length === 0) return null

  return (
    <div className="formDiamonds">
      {form.map((result, i) => (
        <span key={i} className={`formDiamonds__item formDiamonds__item--${result.toLowerCase()}`} />
      ))}
    </div>
  )
}
