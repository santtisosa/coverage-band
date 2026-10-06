import type { Coverage, Snapshot } from '../types'

const TEST_COMMAND = /\b(dotnet\s+test|(npm|pnpm)\s+(run\s+)?test|yarn\s+test|jest|vitest|pytest)\b/
const LEADING_CD = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/
const PACKAGE = /<package\b([^>]*)>([\s\S]*?)<\/package>/g
const CLASS = /<class\b([^>]*)>([\s\S]*?)<\/class>/g
const LINE = /<line\b([^>]*)\/?>/g
const PERCENT = 100

export const REPORT_NAMES = ['coverage.cobertura.xml', 'coverage.xml', 'cobertura-coverage.xml', 'lcov.info']

export const isTestCommand = (command: string): boolean => TEST_COMMAND.test(command)

export const workingDirectory = (command: string, sessionCwd: string): string => {
  const target = LEADING_CD.exec(command)?.[1]?.replace(/^["']|["']$/g, '')

  if(target === undefined) {
    return sessionCwd
  }

  return target.startsWith('/') ? target : `${sessionCwd}/${target}`
}

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1]

const percentOf = (covered: number, total: number): number =>
  total === 0 ? PERCENT : Math.round((covered / total) * PERCENT * 10) / 10

const summarize = (lines: Map<string, Map<string, boolean>>): Coverage => {
  let covered = 0
  let total = 0
  const modules = [...lines].map(([name, moduleLines]) => {
    const moduleCovered = [...moduleLines.values()].filter(Boolean).length
    covered += moduleCovered
    total += moduleLines.size

    return { name, percent: percentOf(moduleCovered, moduleLines.size) }
  })

  return { percent: percentOf(covered, total), modules: modules.sort((a, b) => a.percent - b.percent) }
}

const recordLine = (lines: Map<string, Map<string, boolean>>, module: string, key: string, isCovered: boolean) => {
  const moduleLines = lines.get(module) ?? new Map<string, boolean>()
  moduleLines.set(key, (moduleLines.get(key) ?? false) || isCovered)
  lines.set(module, moduleLines)
}

export const parseCobertura = (reports: readonly string[]): Coverage => {
  const lines = new Map<string, Map<string, boolean>>()

  for(const report of reports) {
    const source = /<source>([^<]*)<\/source>/.exec(report)?.[1]?.trim() ?? ''

    for(const [, packageAttributes = '', packageBody = ''] of report.matchAll(PACKAGE)) {
      const module = attribute(packageAttributes, 'name') || '.'

      for(const [, classAttributes = '', classBody = ''] of packageBody.matchAll(CLASS)) {
        const file = `${source}${attribute(classAttributes, 'filename') ?? ''}`

        for(const [, lineAttributes = ''] of classBody.matchAll(LINE)) {
          const hits = Number(attribute(lineAttributes, 'hits') ?? 0)
          recordLine(lines, module, `${file}:${attribute(lineAttributes, 'number')}`, hits > 0)
        }
      }
    }
  }

  return summarize(lines)
}

export const parseLcov = (report: string, root: string): Coverage => {
  const lines = new Map<string, Map<string, boolean>>()

  for(const record of report.split('end_of_record')) {
    const file = /^SF:(.*)$/m.exec(record)?.[1]?.trim()

    if(file === undefined) {
      continue
    }

    const module = file.replace(`${root}/`, '').replace(/\/[^/]*$/, '') || '.'

    for(const [, number = '', hits = '0'] of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      recordLine(lines, module, `${file}:${number}`, Number(hits) > 0)
    }
  }

  return summarize(lines)
}

export const HISTORY_LENGTH = 5
const GAUGE_LINE = '━'
const GAUGE_MARK = '┃'

export type GaugePart = { text: string; kind: 'covered' | 'missing' | 'threshold' }

export const appendHistory = (history: readonly number[], percent: number): number[] =>
  [...history, percent].slice(-HISTORY_LENGTH)

export const gauge = (percent: number, threshold: number, width: number): GaugePart[] => {
  const cells = Math.max(2, Math.round(width))
  const mark = Math.min(cells - 1, Math.round((threshold / PERCENT) * cells))
  const covered = Math.round((Math.min(PERCENT, Math.max(0, percent)) / PERCENT) * cells)
  const kinds = Array.from({ length: cells }, (_, cell): GaugePart['kind'] => {
    if(cell === mark) {
      return 'threshold'
    }

    return cell < covered ? 'covered' : 'missing'
  })

  return kinds.reduce<GaugePart[]>((parts, kind) => {
    const char = kind === 'threshold' ? GAUGE_MARK : GAUGE_LINE
    const previous = parts.at(-1)

    return previous?.kind === kind
      ? [...parts.slice(0, -1), { kind, text: previous.text + char }]
      : [...parts, { kind, text: char }]
  }, [])
}

export const formatDelta = (history: readonly number[]): string | undefined => {
  const [previous, current] = history.slice(-2)

  if(previous === undefined || current === undefined || previous === current) {
    return undefined
  }

  const delta = Math.round((current - previous) * 10) / 10

  return delta > 0 ? `↑${delta.toFixed(1)}` : `↓${(-delta).toFixed(1)}`
}

export const withHistory = (saved: Snapshot | null): Snapshot | null =>
  saved === null || Array.isArray(saved.history) ? saved : { ...saved, history: [saved.percent] }
