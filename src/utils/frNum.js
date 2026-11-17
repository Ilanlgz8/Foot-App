// Affichage des nombres décimaux à la française (17/11, demande utilisateur : « mettre toutes les
// virgules ») : 31.5% → 31,5%, 1.21 → 1,21. Uniquement pour l'AFFICHAGE — les calculs gardent les
// vrais nombres (parseFloat sur la valeur d'origine, jamais sur le texte formaté).
export function frNum(v) {
  if (v == null) return v
  if (typeof v !== 'string' && typeof v !== 'number') return v
  return String(v).replace(/(\d)\.(\d)/g, '$1,$2')
}

// Cote décimale à 2 chiffres, virgule française : 1.2149 → "1,21"
export function frOdd(n) {
  return frNum(Number(n).toFixed(2))
}
