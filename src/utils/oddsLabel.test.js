import { describe, it, expect } from 'vitest'
import { oddsLabel } from './oddsLabel'

describe('oddsLabel', () => {
  it('retire les mots génériques des noms longs', () => {
    expect(oddsLabel('Clermont Foot')).toBe('Clermont')
    expect(oddsLabel('VfB Stuttgart')).toBe('Stuttgart')
    expect(oddsLabel('Stade Brestois 29')).toBe('Brestois 29')
  })
  it('laisse les noms courts et les noms sans mot générique', () => {
    expect(oddsLabel('Troyes')).toBe('Troyes')
    expect(oddsLabel('AS Monaco')).toBe('AS Monaco')
    expect(oddsLabel('Bayern Munich')).toBe('Bayern Munich')
    expect(oddsLabel('Manchester United')).toBe('Manchester United')
    expect(oddsLabel('Athletic Bilbao')).toBe('Athletic Bilbao')
  })
  it('ne renvoie jamais un nom vide', () => {
    expect(oddsLabel('')).toBe('')
    expect(oddsLabel(null)).toBe('')
    expect(oddsLabel('Football Club AS')).toBe('Football Club AS')
  })
})
