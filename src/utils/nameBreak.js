// Noms de joueurs longs (12/11, demande utilisateur : « couper stratégiquement ») : les particules
// (de, la, van, dos…) restent collées au mot suivant par un espace insécable, pour qu'un retour à
// la ligne ne sépare jamais « de la » de « Fuente ». Les coupures restent possibles ailleurs.
const PARTICLES = new Set([
  'de', 'del', 'della', 'di', 'da', 'das', 'do', 'dos', 'du', 'des', 'la', 'le', 'les', 'el', 'al',
  'van', 'von', 'der', 'den', 'ter', 'ten', 'mac', 'bin', 'ben', 'ibn', 'st.', 'san', 'santa',
])

export function keepParticles(name) {
  const words = String(name ?? '').split(' ')
  let out = ''
  words.forEach((w, i) => {
    if (i === 0) { out = w; return }
    out += (PARTICLES.has(words[i - 1].toLowerCase()) ? ' ' : ' ') + w
  })
  return out
}

// Minute « 120'+4' (pen) » : jamais coupée en deux.
export const keepTogether = (txt) => String(txt ?? '').replace(/ /g, '\u00A0')
