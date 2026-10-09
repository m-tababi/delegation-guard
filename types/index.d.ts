export type DelegationTurn = { count: number; isReminded: boolean }
export type DelegationContext = { tokens: number | null; percent: number | null; window: number }

declare module 'claude-code' {
  interface PluginState {
    'delegation-guard': {
      turn: DelegationTurn
      isEnabled: boolean
      thresholdOverride: number | null
      context: DelegationContext | null
      agents: string[]
      agentTokens: number
    }
  }
}
