import { describe, it, expect } from 'vitest'
import { frNum, frOdd } from './frNum'

describe('frNum / frOdd', () => {
  it('remplace le point décimal par une virgule', () => {
    expect(frNum('31.5%')).toBe('31,5%')
    expect(frNum(1.21)).toBe('1,21')
    expect(frOdd(1.2149)).toBe('1,21')
    expect(frOdd(10)).toBe('10,00')
  })
  it('laisse le reste intact', () => {
    expect(frNum('12')).toBe('12')
    expect(frNum('–')).toBe('–')
    expect(frNum(null)).toBe(null)
    expect(frNum('3 - 1')).toBe('3 - 1')
  })
})
