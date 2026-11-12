import { describe, it, expect } from 'vitest'
import { keepParticles, keepTogether } from './nameBreak'

const N = ' '

describe('nameBreak', () => {
  it('colle initiale et particules au mot suivant', () => {
    expect(keepParticles('A. de la Fuente')).toBe(`A.${N}de${N}la${N}Fuente`)
    expect(keepParticles('V. Manuel Armenteros Amado')).toBe(`V.${N}Manuel Armenteros Amado`)
  })
  it('minute insécable', () => {
    expect(keepTogether("120'+4' (pen)")).toBe(`120'+4'${N}(pen)`)
  })
})
