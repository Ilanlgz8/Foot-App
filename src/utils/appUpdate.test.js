import { describe, it, expect } from 'vitest'
import { assetsFromHtml, assetsFromDocument, decideUpdateAction } from './appUpdate'

const JS_A  = '/assets/index-AAAAAAAA.js'
const CSS_A = '/assets/index-CCCCCCCC.css'
const CSS_B = '/assets/index-DDDDDDDD.css'
const LAZY  = '/assets/LiveMatchPage-EEEEEEEE.js'

const html = (...assets) =>
  `<!doctype html><html><head>${assets.map(a =>
    a.endsWith('.css') ? `<link rel="stylesheet" crossorigin href="${a}">`
                       : `<script type="module" crossorigin src="${a}"></script>`
  ).join('')}</head><body><div id="root"></div></body></html>`

const fakeDoc = (...assets) => ({
  querySelectorAll: () => assets.map(a => ({
    getAttribute: (k) => (a.endsWith('.css') ? (k === 'href' ? a : null)
                                             : (k === 'src'  ? a : null)),
  })),
})

describe('extraction des assets', () => {
  it('lit le JS ET le CSS du HTML servi', () => {
    expect(assetsFromHtml(html(JS_A, CSS_A))).toEqual([CSS_A, JS_A].sort())
  })
  it('lit le JS ET le CSS de la page en cours', () => {
    expect(assetsFromDocument(fakeDoc(JS_A, CSS_A))).toEqual([CSS_A, JS_A].sort())
  })
  it('dédoublonne', () => {
    expect(assetsFromHtml(html(JS_A, JS_A, CSS_A))).toHaveLength(2)
  })
  it('renvoie une liste vide sur une entrée sans asset haché (mode dev)', () => {
    expect(assetsFromHtml('<html><script src="/src/main.jsx"></script></html>')).toEqual([])
    expect(assetsFromHtml(null)).toEqual([])
  })
})

describe('decideUpdateAction', () => {
  it('mêmes assets → on ne touche à rien', () => {
    expect(decideUpdateAction([JS_A, CSS_A], [JS_A, CSS_A], false)).toBe('ok')
  })

  it('CSS différent, MÊME JS → détecté (le cas qui échappait à la 1re version)', () => {
    expect(decideUpdateAction([JS_A, CSS_A], [JS_A, CSS_B], false)).toBe('reload')
  })

  it('toujours périmé APRÈS un rechargement → purge du service worker', () => {
    expect(decideUpdateAction([JS_A, CSS_A], [JS_A, CSS_B], true)).toBe('purge')
  })

  it('un morceau chargé en plus (route visitée) n’est PAS une mise à jour', () => {
    expect(decideUpdateAction([JS_A, CSS_A, LAZY], [JS_A, CSS_A], false)).toBe('ok')
  })

  it('ne recharge JAMAIS sur une information manquante (pas de boucle)', () => {
    expect(decideUpdateAction([], [JS_A], false)).toBe('ok')
    expect(decideUpdateAction([JS_A], [], false)).toBe('ok')
    expect(decideUpdateAction(null, null, true)).toBe('ok')
    expect(decideUpdateAction(undefined, [JS_A], true)).toBe('ok')
  })
})

// ── Garde-fou anti-boucle ────────────────────────────────────────────────────
// Reproduit l'enchaînement qui bouclait : rechargement → toujours périmé →
// purge → toujours périmé → … La décision seule ne peut pas s'arrêter, c'est
// bien le COMPTEUR de tentatives (localStorage, hors de cette fonction pure)
// qui doit couper. Ce test documente la limite de decideUpdateAction pour que
// personne ne la croie suffisante à elle seule.
describe('la décision seule ne s’arrête jamais — d’où le compteur', () => {
  it('reste sur "purge" tant que la page est périmée', () => {
    expect(decideUpdateAction([JS_A], [CSS_B], true)).toBe('purge')
    expect(decideUpdateAction([JS_A], [CSS_B], true)).toBe('purge')
  })

  it('revient à "reload" si le drapeau de session a été effacé — la faille exacte', () => {
    // La purge effaçait elle-même le drapeau : le contrôle suivant repartait
    // donc du début, d'où la boucle infinie.
    expect(decideUpdateAction([JS_A], [CSS_B], false)).toBe('reload')
  })
})
