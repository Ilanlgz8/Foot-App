import { describe, it, expect } from 'vitest'
import { keepParticles } from './nameBreak'

describe('keepParticles', () => {
  it('colle les particules au mot suivant', () => {
    expect(keepParticles('A. de la Fuente')).toBe('A. de la Fuente')
    expect(keepParticles('V. Manuel Armenteros Amado')).toBe('V. Manuel Armenteros Amado')
  })
})
