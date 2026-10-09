import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { DEFAULT_THRESHOLD, formatTokens, isSelfStep, parseThreshold, reminderText } from './counting'

const turn = atom({ plugin: 'delegation-guard', key: 'turn' } as const, { count: 0, isReminded: false })
const isEnabled = atom({ plugin: 'delegation-guard', key: 'isEnabled' } as const, true)
const thresholdOverride = atom({ plugin: 'delegation-guard', key: 'thresholdOverride' } as const, null)
const context = atom({ plugin: 'delegation-guard', key: 'context' } as const, null)
const agents = atom({ plugin: 'delegation-guard', key: 'agents' } as const, [])
const agentTokens = atom({ plugin: 'delegation-guard', key: 'agentTokens' } as const, 0)

const USAGE = 'Usage: /delegation [status | on | off | threshold <1-50>]'

async function threshold($: EngineInterface, configured: number): Promise<number> {
  return (await read($, thresholdOverride)) ?? configured
}

async function status($: EngineInterface, configured: number): Promise<string> {
  const override = await read($, thresholdOverride)
  const { count } = await read($, turn)
  const ids = await read($, agents)
  const state = (await read($, isEnabled)) ? 'on' : 'off'
  const source = override === null ? 'from settings' : 'set via /delegation'

  return (
    `Delegation guard is ${state}, threshold ${override ?? configured} (${source}). ` +
    `Self-done steps this turn: ${count}. ` +
    `Delegated this session: ${ids.length} agents, ${formatTokens(await read($, agentTokens))} tokens.`
  )
}

export const register: Register = (on, options) => {
  const configured = parseThreshold(options.threshold) ?? DEFAULT_THRESHOLD

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'delegation',
      description: 'Delegation guard: status, on, off, threshold <n>',
      argumentHint: '[status|on|off|threshold <n>]',
    })

    const storedEnabled = await $.store.get('enabled')
    if (typeof storedEnabled === 'boolean') {
      await update($, isEnabled, () => storedEnabled)
    }

    const storedThreshold = parseThreshold(await $.store.get('threshold'))
    if (storedThreshold !== null) {
      await update($, thresholdOverride, () => storedThreshold)
    }

    return next(e)
  })

  on('command.run', { command: 'delegation' }, async ($, e) => {
    const [verb = 'status', value] = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)

    if (verb === 'status') {
      return { text: await status($, configured) }
    }

    if (verb === 'on' || verb === 'off') {
      const isOn = verb === 'on'
      await $.store.set('enabled', isOn)
      await update($, isEnabled, () => isOn)

      return { text: `Delegation guard ${verb}.` }
    }

    if (verb === 'threshold') {
      const n = parseThreshold(value)
      if (n === null) {
        return { text: `Threshold must be a whole number from 1 to 50. ${USAGE}` }
      }

      await $.store.set('threshold', n)
      await update($, thresholdOverride, () => n)

      return { text: `Delegation threshold set to ${n}.` }
    }

    return { text: USAGE }
  })

  // turn.start is raised for the main loop only; a subagent's run raises none.
  on('turn.start', async ($, e, next) => {
    await update($, turn, () => ({ count: 0, isReminded: false }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const ran = await next(e)

    if (ran.deny !== undefined || !isSelfStep(tool, e.agentId, ran.isReadOnly === true)) {
      return ran
    }

    const limit = await threshold($, configured)
    const isOn = await read($, isEnabled)
    let count = 0
    let shouldRemind = false

    // update() re-runs this closure on a version miss, so the captured values
    // always belong to the write that landed, also under parallel tool calls.
    await update($, turn, t => {
      count = t.count + 1
      shouldRemind = isOn && !t.isReminded && count >= limit

      return { count, isReminded: t.isReminded || shouldRemind }
    })

    return shouldRemind ? { ...ran, context: [...(ran.context ?? []), reminderText(count)] } : ran
  }).catch(($, e, next) => next(e))

  // Every spawn counts as delegated work, nested ones included; only a spawn
  // from the main loop resets the main turn's counter. It resolves once the
  // subagent has started, not when it ends.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)

    if (spawned.agentId !== undefined) {
      const id = spawned.agentId
      await update($, agents, list => (list.includes(id) ? list : [...list, id]))

      if (e.parentAgentId == null) {
        await update($, turn, t => ({ ...t, count: 0 }))
      }
    }

    return spawned
  }).catch(($, e, next) => next(e))

  // Subagent tokens arrive per completed subagent turn (its requests summed):
  // a running subagent adds nothing until its turn ends, and an interrupted
  // or failed turn reports no usage. Engine forks (compaction, memory) also
  // carry an agentId; filtering on spawned ids keeps them out.
  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const usage = e.usage

    if (agentId != null && usage !== undefined && (await read($, agents)).includes(agentId)) {
      const sum =
        usage.input_tokens +
        usage.cache_read_input_tokens +
        usage.cache_creation_input_tokens +
        usage.output_tokens
      await update($, agentTokens, n => n + sum)
    }

    return next(e)
  })

  // Raised after each main-thread turn with the status line's own figures.
  on('session.measure', async ($, e, next) => {
    const { tokens, percent, window } = e.context
    await update($, context, () => ({ tokens: tokens ?? null, percent: percent ?? null, window }))

    return next(e)
  })

  // The band is shared: what the other plugins and the engine draw stays,
  // this row goes under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const below = await next(e)
    if (!(await read($, isEnabled))) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const limit = await threshold($, configured)
    const { count } = await read($, turn)
    const ctx = await read($, context)
    const ids = await read($, agents)
    const delegated = await read($, agentTokens)

    const main =
      ctx === null || ctx.tokens === null
        ? 'Hauptkontext –'
        : `Hauptkontext ${formatTokens(ctx.tokens)}${ctx.percent === null ? '' : ` (${ctx.percent} %)`}`
    const agentLabel = ids.length === 1 ? 'Agent' : 'Agents'
    const level = count >= limit ? 'error' : count >= limit - 1 ? 'warning' : null

    const mine = (
      <Box width={e.props.bodyColumns}>
        <Text dimColor wrap="truncate">
          {main} │ Delegiert: {ids.length} {agentLabel}, {formatTokens(delegated)} Tokens │{' '}
        </Text>
        {level === null ? (
          <Text dimColor wrap="truncate">
            Selbst diesen Turn: {count}/{limit}
          </Text>
        ) : (
          <Text color={level} wrap="truncate">
            Selbst diesen Turn: {count}/{limit}
          </Text>
        )}
      </Box>
    )

    // An empty band below draws nothing of its own.
    return (below as RenderElement | null | undefined) == null ? (
      mine
    ) : (
      <Box flexDirection="column">
        {below}
        {mine}
      </Box>
    )
  })
}
