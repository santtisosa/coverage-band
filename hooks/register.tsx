import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Coverage, Snapshot } from '../types'
import { appendHistory, formatDelta, gauge, isTestCommand, parseCobertura, parseLcov, REPORT_NAMES, withHistory, workingDirectory } from './coverage'

const PANE = 'coverage'
const CLOCK_SKEW_MS = 2_000
const FIND_TIMEOUT_MS = 15_000
const MODULES_IN_BAND = 3
const NAME_COLUMN = 40
const BAR_CELLS = 20
const PRUNED = ['node_modules', '.git', 'bin', 'obj', '.venv']

const last = atom({ plugin: 'coverage-band', key: 'last' } as const, null as Snapshot | null)

const findReports = async ($: EngineInterface, dir: string, since: number): Promise<string[]> => {
  // ponytail: one `find` call; walk with $.fs.list if Windows support is ever needed
  const prune = PRUNED.flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name]))
  const names = REPORT_NAMES.flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name]))
  const found = await $.process.run(
    ['find', dir, '(', ...prune, ')', '-prune', '-o', '-type', 'f', '(', ...names, ')', '-print'],
    { timeoutMs: FIND_TIMEOUT_MS })
  const paths = found.stdout.split('\n').filter(path => path.length > 0)
  const stats = await Promise.all(paths.map(async path => ({ path, modified: (await $.fs.stat(path)).mtimeMs })))

  return stats
    .filter(file => file.modified >= since)
    .sort((a, b) => b.modified - a.modified)
    .map(file => file.path)
}

const readCoverage = async ($: EngineInterface, reports: readonly string[], dir: string): Promise<Coverage> => {
  const lcov = reports.find(path => path.endsWith('lcov.info'))

  if(lcov !== undefined) {
    return parseLcov(await $.fs.read(lcov), dir)
  }

  return parseCobertura(await Promise.all(reports.map(path => $.fs.read(path))))
}

type Display = { isStatus: boolean; threshold: number; gaugeWidth: number }

const record = async ($: EngineInterface, command: string, startedAt: number, display: Display) => {
  const dir = workingDirectory(command, await $.session.cwd())
  const reports = await findReports($, dir, startedAt - CLOCK_SKEW_MS)

  if(reports.length === 0) {
    return
  }

  const coverage = await readCoverage($, reports, dir)
  const key = `history:${dir}`
  const history = appendHistory(((await $.store.get(key)) as number[] | undefined) ?? [], coverage.percent)
  await $.store.set(key, history)
  const snapshot = { ...coverage, history, source: dir }
  await update($, last, () => snapshot)

  if(display.isStatus) {
    $.ui.status(formatLine(snapshot, display))
  }

  const below = coverage.modules.filter(module => module.percent < display.threshold)

  if(below.length > 0) {
    $.ui.toast(`Coverage: ${below.length} module(s) below ${display.threshold}%`)
  }
}

const belowThreshold = (snapshot: Snapshot, threshold: number) =>
  snapshot.modules.filter(module => module.percent < threshold).slice(0, MODULES_IN_BAND)

type Elements = ReturnType<EngineInterface['ui']['resolve']>

const coverageTree = (snapshot: Snapshot, display: Display, { Box, Text }: Elements) => {
  const threshold = display.threshold
  const color = snapshot.percent >= threshold ? 'green' : 'red'
  const delta = formatDelta(snapshot.history)
  const parts = gauge(snapshot.percent, threshold, display.gaugeWidth)

  return (
    <Box gap={1}>
      <Text>🧪</Text>
      <Box>
        {parts.map((part, index) => (
          <Text key={`${index}`} color={part.kind === 'covered' ? color : part.kind === 'threshold' ? 'yellow' : undefined} dimColor={part.kind === 'missing'} bold={part.kind === 'threshold'}>
            {part.text}
          </Text>
        ))}
      </Box>
      <Text color={color} bold>{`${snapshot.percent}%`}</Text>
      {delta === undefined ? null : <Text color={delta.startsWith('↑') ? 'green' : 'red'}>{delta}</Text>}
      {belowThreshold(snapshot, threshold).map(module => (
        <Text key={module.name} color="yellow">{`${module.name} ${module.percent}%`}</Text>
      ))}
    </Box>
  )
}

const formatLine = (snapshot: Snapshot, display: Display): string => {
  const delta = formatDelta(snapshot.history)
  const below = belowThreshold(snapshot, display.threshold).map(module => `${module.name} ${module.percent}%`)
  const total = `🧪 ${gauge(snapshot.percent, display.threshold, display.gaugeWidth).map(part => part.text).join('')} ${snapshot.percent}%`

  return [total, delta, ...below].filter(part => part !== undefined).join(' · ')
}

export const register: Register = (on, options) => {
  const threshold = Number(options.threshold ?? 80)
  const placement = String(options.placement ?? 'hint')
  const isStatus = placement === 'status'
  const gaugeWidth = Number(options.gaugeWidth ?? 10)
  const display = { isStatus, threshold, gaugeWidth }
  const colorOf = (percent: number) => (percent >= threshold ? 'green' : 'red')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: PANE, description: 'Coverage per module from the last test run' })
    const snapshot = await update($, last, withHistory)
    $.ui.status(isStatus && snapshot !== null ? formatLine(snapshot, display) : undefined)

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const output = ran.result as { interrupted?: boolean; backgroundTaskId?: string } | undefined
    const isFinishedTestRun = ran.deny === undefined && isTestCommand(e.command)
      && output?.interrupted !== true && output?.backgroundTaskId === undefined

    if(isFinishedTestRun) {
      await record($, e.command, startedAt, display)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: PANE }, async ($, e) => {
    if((await read($, last)) === null) {
      return { text: 'No coverage yet: run your tests with coverage enabled.' }
    }

    await $.ui.open({ id: PANE, title: 'Coverage', focus: true, closeOnEscape: true })

    return { text: 'Coverage opened.' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const line = await next(e)
    const snapshot = await read($, last)

    if(placement !== 'hint' || snapshot === null) {
      return line
    }

    const elements = $.ui.resolve(e)

    return <elements.Box gap={2}>{line}{coverageTree(snapshot, display, elements)}</elements.Box>
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, last)

    if(placement !== 'band' || e.props.hasSurvey || snapshot === null) {
      return next(e)
    }

    return coverageTree(snapshot, display, $.ui.resolve(e))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const snapshot = await read($, last)

    if(snapshot === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text dimColor>{`${snapshot.source} · threshold ${threshold}%`}</Text>
        {snapshot.modules.map(module => {
          const filled = Math.round((module.percent / 100) * BAR_CELLS)

          return (
            <Box key={module.name}>
              <Box width={NAME_COLUMN}><Text wrap="truncate-start">{module.name}</Text></Box>
              <Text color={colorOf(module.percent)}>{'█'.repeat(filled)}</Text>
              <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}</Text>
              <Text color={colorOf(module.percent)}>{` ${module.percent}%`}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
