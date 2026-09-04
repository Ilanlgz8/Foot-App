import { describe, it, expect } from 'vitest'
import { assetFromHtml, assetFromUrl, decideUpdateAction } from './appUpdate'

const A = '/assets/index-BOo-19lt.js'
const B = '/assets/index-C5jGGBgq.js'

describe('extraction du bundle', () => {
  it('lit l’asset dans le HTML servi', () => {
    expect(assetFromHtml(`<script type="module" crossorigin src="${A}"></script>`)).toBe(A)
  })
  it('lit l’asset dans l’URL du module courant', () => {
    expect(assetFromUrl(`https://statfootix.vercel.app${A}`)).toBe(A)
  })
  it('renvoie null sur une entrée sans asset (dev, HTML inattendu)', () => {
    expect(assetFromHtml('<html></html>')).toBeNull()
    expect(assetFromUrl('http://localhost:5173/src/main.jsx')).toBeNull()
    expect(assetFromHtml(null)).toBeNull()
    expect(assetFromUrl(undefined)).toBeNull()
  })
})

describe('decideUpdateAction', () => {
  it('même bundle → on ne touche à rien', () => {
    expect(decideUpdateAction(A, A, false)).toBe('ok')
    expect(decideUpdateAction(A, A, true)).toBe('ok')
  })

  it('bundle différent → rechargement simple d’abord', () => {
    expect(decideUpdateAction(A, B, false)).toBe('reload')
  })

  it('toujours différent APRÈS un rechargement → purge du service worker', () => {
    expect(decideUpdateAction(A, B, true)).toBe('purge')
  })

  it('ne recharge JAMAIS sur une information manquante (pas de boucle)', () => {
    expect(decideUpdateAction(null, B, false)).toBe('ok')
    expect(decideUpdateAction(A, null, false)).toBe('ok')
    expect(decideUpdateAction(null, null, true)).toBe('ok')
    expect(decideUpdateAction('', B, true)).toBe('ok')
  })
})
