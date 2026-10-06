import { expect, mock, test } from 'claude-code/testing'

const REPORT = '/repo/tests/App.Tests/TestResults/1/coverage.cobertura.xml'
const XML = `<coverage><packages>
  <package name="App.Domain"><classes><class filename="a.cs"><lines>
    <line number="1" hits="1"/><line number="2" hits="1"/><line number="3" hits="1"/><line number="4" hits="1"/>
  </lines></class></classes></package>
  <package name="App.WebApi"><classes><class filename="b.cs"><lines>
    <line number="1" hits="1"/><line number="2" hits="0"/>
  </lines></class></classes></package>
</packages></coverage>`

const drawHintLine = (on: Args[1]) => {
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{[e.props.hint, e.props.tail].filter(Boolean).join(' ')}</Text>
  })
}
const HINT_PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' } as never
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never

type Args = Parameters<Parameters<typeof test>[1]>

const runTests = async ($: Args[0], on: Args[1], command: string) => {
  const seen = { searches: 0, toasts: [] as string[], lines: [] as (string | undefined)[] }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { 'history:/repo': [70, 75.3] })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('command.register', ($, e) => ({ value: { command: e.name } }) as never)
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)

    return { value: undefined } as never
  })
  on('ui.status', ($, e) => {
    seen.lines.push(e.text)

    return { value: undefined } as never
  })
  on('process.run', () => {
    seen.searches += 1

    return { value: { exitCode: 0, stdout: `${REPORT}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: XML.length, mtimeMs: 1_000_500, isLink: false } }) as never)
  on('fs.read', () => ({ value: XML }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'Passed!', stderr: '', interrupted: false }, text: 'Passed!' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(500)
  await $.tool.call({ tool: 'Bash', command, tool_use_id: 't1' } as never)

  return seen
}

for(const surface of ['terminal', 'desktop'] as const) {
  test(`shows coverage after a test run on the ${surface}`, { options: { placement: 'band' } }, async ($, on) => {
    const seen = await runTests($, on, 'dotnet test --collect:"XPlat Code Coverage"')

    const ui = await $.ui.mount({ plugin: 'coverage-band', surface, component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ type: 'Text', text: /^83\.3%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '🧪' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'App.WebApi 50%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /App\.Domain/ })).toBeUndefined()
    expect(seen.toasts).toEqual(['Coverage: 1 module(s) below 80%'])
  })
}

test('stays out of the way for commands that are not tests', async ($, on) => {
  const seen = await runTests($, on, 'dotnet build')

  expect(seen.searches).toBe(0)
  expect(seen.toasts).toEqual([])
})

test('writes the coverage on the status line', { options: { placement: 'status' } }, async ($, on) => {
  const seen = await runTests($, on, 'dotnet test --collect:"XPlat Code Coverage"')

  expect(seen.lines.at(-1)).toBe('🧪 ━━━━━━━━┃━ 83.3% · ↑8.0 · App.WebApi 50%')
})

test('keeps the engine hint line and adds the colored coverage after it by default', async ($, on) => {
  drawHintLine(on)
  await runTests($, on, 'dotnet test --collect:"XPlat Code Coverage"')

  const ui = await $.ui.mount({ plugin: 'coverage-band', surface: 'terminal', component: 'PromptHint', props: HINT_PROPS })

  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '83.3%' }))?.props.color).toBe('green')
  expect((await ui.find({ type: 'Text', text: '↑8.0' }))?.props.color).toBe('green')
  expect((await ui.find({ type: 'Text', text: '┃' }))?.props.color).toBe('yellow')
  expect((await ui.find({ type: 'Text', text: '━━━━━━━━' }))?.props.color).toBe('green')
  expect((await ui.find({ type: 'Text', text: 'App.WebApi 50%' }))?.props.color).toBe('yellow')
})

