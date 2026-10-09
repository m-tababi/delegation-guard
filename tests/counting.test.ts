import { expect, test } from 'claude-code/testing'

import { formatTokens, isSelfStep, parseThreshold } from '../hooks/counting'

test('only main-thread read/search tools are self-done steps', () => {
  expect(isSelfStep('Read', 'sub-1', false)).toBe(false)
  expect(isSelfStep('Grep', undefined, false)).toBe(true)
  expect(isSelfStep('Glob', undefined, false)).toBe(true)
  expect(isSelfStep('Edit', undefined, true)).toBe(false)
  expect(isSelfStep('mcp__srv__get', undefined, true)).toBe(true)
  expect(isSelfStep('mcp__srv__put', undefined, false)).toBe(false)
})

test('threshold accepts whole numbers from 1 to 50 only', () => {
  expect(parseThreshold(6)).toBe(6)
  expect(parseThreshold('12')).toBe(12)
  expect(parseThreshold(0)).toBeNull()
  expect(parseThreshold(51)).toBeNull()
  expect(parseThreshold(2.5)).toBeNull()
  expect(parseThreshold(undefined)).toBeNull()
})

test('token counts are compact', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(45_000)).toBe('45k')
  expect(formatTokens(1_250_000)).toBe('1.3M')
})
