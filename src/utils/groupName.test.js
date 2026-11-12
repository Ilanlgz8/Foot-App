import { describe, it, expect } from 'vitest'
import { formatGroupName } from './groupName'

describe('formatGroupName', () => {
  it('traduit les noms de groupe', () => {
    expect(formatGroupName('GROUP_A')).toBe('Groupe A')
    expect(formatGroupName('Group B')).toBe('Groupe B')
    expect(formatGroupName('Group A1')).toBe('Ligue A · Groupe 1')
    expect(formatGroupName('Group D2')).toBe('Ligue D · Groupe 2')
  })
})
