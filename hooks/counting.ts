// Glob, Grep and NotebookRead are not registered on every build, so tools are
// compared by name rather than through the typed tool union.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch', 'NotebookRead'])

export const DEFAULT_THRESHOLD = 6

export function isSelfStep(tool: string, agentId: string | undefined, isReadOnly: boolean): boolean {
  if (agentId != null) {
    return false
  }

  // An MCP tool counts only when its server declares it read-only.
  return READ_TOOLS.has(tool) || (tool.startsWith('mcp__') && isReadOnly)
}

export function parseThreshold(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN

  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null
}

export function reminderText(count: number): string {
  return (
    `Delegation reminder: you have done ${count} reading/searching steps yourself in this turn. ` +
    'Hand the remaining agent-capable work (reading, searching, research, review) to a subagent ' +
    'with an explicit model, and keep the main session for orchestration and short edits.'
  )
}

export function formatTokens(n: number): string {
  if (n < 1000) {
    return String(n)
  }

  if (n < 1_000_000) {
    return `${Math.round(n / 1000)}k`
  }

  return `${(n / 1_000_000).toFixed(1)}M`
}
