import { describe, it, expect } from 'vitest'
import { formKey, CUP_FORM_PREFIX } from './useTeamForm'

describe('formKey (forme par compétition)', () => {
  it('match de championnat : id brut', () => {
    expect(formKey({ isCup: false }, 84)).toBe(84)
    expect(formKey({}, 84)).toBe(84)
  })
  it('match de coupe nationale : clé de coupe séparée', () => {
    expect(formKey({ isCup: true }, 84)).toBe(`${CUP_FORM_PREFIX}84`)
  })
  it('id inconnu : null', () => {
    expect(formKey({ isCup: true }, null)).toBeNull()
  })
})
