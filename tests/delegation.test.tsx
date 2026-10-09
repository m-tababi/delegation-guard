import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { reminderText } from '../hooks/counting'

const PLUGIN = 'delegation-guard'

const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

// The engine's side of every event the plugin hooks or calls; the returned
// record is the plugin's store, kept across sessions.
function bottoms(on: On, store: Record<string, unknown> = {}): Record<string, unknown> {
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('agent.spawn', () => ({ model: 'claude-sonnet', agentId: 'sub-1' }))
  on('tool.call', ($, e) =>
    String(e.tool).startsWith('mcp__') && String(e.tool).includes('list')
      ? { result: 'ok' as never, text: 'ok', isReadOnly: true }
      : { result: 'ok' as never, text: 'ok' },
  )
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  return store
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
}

function read($: Engine) {
  return $.tool.call({ tool: 'Read', file_path: '/tmp/a.txt' })
}

async function bandText($: Engine, text: RegExp) {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()

  return found
}

async function selfText($: Engine): Promise<string | undefined> {
  return (await bandText($, /Selbst/))?.text
}

function delegation($: Engine, args: string) {
  return $.command.run({
    command: 'delegation',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
}

describe('counting', () => {
  test('only main-thread read/search tools count', async ($, on) => {
    bottoms(on)
    await start($)

    await read($)
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'x' })
    await $.tool.call({ tool: 'Edit', file_path: '/tmp/a.txt', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'mcp__srv__list_items' } as never)
    await $.tool.call({ tool: 'mcp__srv__create_item' } as never)
    // A subagent's call: the typed args drop agentId, the engine passes it on.
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a.txt', agentId: 'sub-1' } as never)

    expect(await selfText($)).toBe('Selbst diesen Turn: 4/6')
  })

  test('a new turn resets the counter', async ($, on) => {
    bottoms(on)
    await start($)
    await read($)
    await read($)
    expect(await selfText($)).toBe('Selbst diesen Turn: 2/6')

    await $.turn.start({ text: 'next', turnId: 't2' })

    expect(await selfText($)).toBe('Selbst diesen Turn: 0/6')
  })

  test('a spawn from the main thread resets the counter and is counted as delegated', async ($, on) => {
    bottoms(on)
    await start($)
    await read($)
    await read($)
    await read($)

    await $.agent.spawn({
      tool_use_id: 'tu-1',
      prompt: 'search',
      description: 'search',
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus',
      background: false,
      fork: false,
    })
    expect(await selfText($)).toBe('Selbst diesen Turn: 0/6')

    await $.turn.complete({
      answer: 'done',
      durationMs: 10,
      isAborted: false,
      turnId: 'sub-turn',
      agentId: 'sub-1',
      reason: 'answer',
      usage: {
        model: 'claude-sonnet',
        input_tokens: 1000,
        output_tokens: 2000,
        cache_read_input_tokens: 150_000,
        cache_creation_input_tokens: 57_000,
      },
    })
    // A fork the plugin never saw spawn is no delegation.
    await $.turn.complete({
      answer: 'summary',
      durationMs: 10,
      isAborted: false,
      turnId: 'fork-turn',
      agentId: 'compaction-fork',
      reason: 'answer',
      usage: {
        model: 'claude-sonnet',
        input_tokens: 99_000,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })

    expect((await bandText($, /Hauptkontext/))?.text).toContain('Delegiert: 1 Agent, 210k Tokens')
  })
})

describe('reminder', () => {
  test('fires exactly once when the threshold is reached', { options: { threshold: 3 } }, async ($, on) => {
    bottoms(on)
    await start($)

    const contexts = []
    for (let i = 0; i < 5; i++) {
      const ran = await read($)
      contexts.push(ran.context ?? [])
    }

    expect(contexts).toEqual([[], [], [reminderText(3)], [], []])
  })

  test('fires again in the next turn', { options: { threshold: 2 } }, async ($, on) => {
    bottoms(on)
    await start($)
    await read($)
    expect((await read($)).context).toEqual([reminderText(2)])

    await $.turn.start({ text: 'next', turnId: 't2' })
    await read($)
    expect((await read($)).context).toEqual([reminderText(2)])
  })
})

describe('band', () => {
  test('shows main context, delegation and the counter in color', { options: { threshold: 3 } }, async ($, on) => {
    bottoms(on)
    await start($)
    await $.session.measure({
      context: { tokens: 45_000, window: 200_000, percent: 22 },
      rateLimits: [],
      changed: ['context'],
    })
    await read($)

    expect((await bandText($, /Hauptkontext/))?.text).toBe(
      'Hauptkontext 45k (22 %) │ Delegiert: 0 Agents, 0 Tokens │ ',
    )
    expect(await bandText($, /Selbst/)).toMatchObject({ text: 'Selbst diesen Turn: 1/3', props: { dimColor: true } })

    await read($)
    expect(await bandText($, /Selbst/)).toMatchObject({ props: { color: 'warning' } })

    await read($)
    expect(await bandText($, /Selbst/)).toMatchObject({ props: { color: 'error' } })
  })
})

describe('/delegation', () => {
  test('off stops the reminder and the band; on brings them back', { options: { threshold: 2 } }, async ($, on) => {
    const store = bottoms(on)
    await start($)

    expect((await delegation($, 'off')).text).toBe('Delegation guard off.')
    expect(store.enabled).toBe(false)
    await read($)
    expect((await read($)).context).toBeUndefined()
    expect(await bandText($, /engine band/)).toBeDefined()
    expect(await bandText($, /Selbst/)).toBeUndefined()

    await delegation($, 'on')
    expect(await selfText($)).toBe('Selbst diesen Turn: 2/2')
  })

  test('threshold is validated and persisted in the store', async ($, on) => {
    const store = bottoms(on)
    await start($)

    expect((await delegation($, 'threshold 0')).text).toContain('1 to 50')
    expect(store.threshold).toBeUndefined()
    expect((await delegation($, 'threshold 2')).text).toBe('Delegation threshold set to 2.')
    expect(store.threshold).toBe(2)

    await read($)
    expect((await read($)).context).toEqual([reminderText(2)])
    expect((await delegation($, 'status')).text).toContain('threshold 2 (set via /delegation)')
  })

  test('a stored threshold and off state are loaded at session start', async ($, on) => {
    bottoms(on, { threshold: 2, enabled: false })
    await start($)

    expect((await delegation($, '')).text).toContain('Delegation guard is off, threshold 2')
  })
})

describe('band composition', () => {
  for (const tier of ['prepend', 'append'] as const) {
    test(`another plugin's band and this one both show (${tier})`, {
      plugins: [
        {
          name: 'other-band',
          tier,
          register(on) {
            on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
              const below = await next(e)
              const { Box, Text } = $.ui.resolve(e)

              return (
                <Box flexDirection="column">
                  {below}
                  <Text>other band</Text>
                </Box>
              )
            })
          },
        },
      ],
    }, async ($, on) => {
      bottoms(on)
      await start($)

      expect(await bandText($, /other band/)).toBeDefined()
      expect(await bandText($, /engine band/)).toBeDefined()
      expect(await selfText($)).toBe('Selbst diesen Turn: 0/6')
    })
  }

  test('a survey keeps the band to itself', async ($, on) => {
    bottoms(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: /Selbst/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  })
})
