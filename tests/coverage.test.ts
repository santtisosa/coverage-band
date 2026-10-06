import { expect, test } from 'claude-code/testing'

import { appendHistory, formatDelta, isTestCommand, parseCobertura, parseLcov, gauge, withHistory, workingDirectory } from '../hooks/coverage'

const report = (lines: string) => `<?xml version="1.0"?>
<coverage line-rate="0.5">
  <packages>
    <package name="App.Domain" line-rate="0.5">
      <classes>
        <class name="User" filename="src/Domain/User.cs" line-rate="0.5">
          <lines>${lines}</lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`

test('recognizes test commands', () => {
  expect(isTestCommand('dotnet test FarmeORT.sln --collect:"XPlat Code Coverage"')).toBe(true)
  expect(isTestCommand('cd web && npm run test -- --coverage')).toBe(true)
  expect(isTestCommand('pytest --cov')).toBe(true)
  expect(isTestCommand('dotnet build')).toBe(false)
})

test('takes the directory of a leading cd', () => {
  expect(workingDirectory('cd tests && dotnet test', '/repo')).toBe('/repo/tests')
  expect(workingDirectory('cd "/other dir" && pytest', '/repo')).toBe('/other dir')
  expect(workingDirectory('dotnet test', '/repo')).toBe('/repo')
})

test('reads line coverage per package from Cobertura', () => {
  const coverage = parseCobertura([report('<line number="1" hits="3"/><line number="2" hits="0"/>')])

  expect(coverage).toEqual({ percent: 50, modules: [{ name: 'App.Domain', percent: 50 }] })
})

test('merges reports from several test projects line by line', () => {
  const coverage = parseCobertura([
    report('<line number="1" hits="1"/><line number="2" hits="0"/>'),
    report('<line number="1" hits="0"/><line number="2" hits="4"/>'),
  ])

  expect(coverage.percent).toBe(100)
})

test('reads lcov records grouped by folder', () => {
  const lcov = [
    'SF:/repo/src/a/x.ts', 'DA:1,1', 'DA:2,0', 'end_of_record',
    'SF:/repo/src/b/y.ts', 'DA:1,1', 'end_of_record',
  ].join('\n')

  expect(parseLcov(lcov, '/repo')).toEqual({
    percent: 66.7,
    modules: [{ name: 'src/a', percent: 50 }, { name: 'src/b', percent: 100 }],
  })
})

test('matches the same file across reports that use different source roots', () => {
  const fromDomainTests = `<coverage><sources><source>/repo/src/App.Domain/</source></sources><packages>
    <package name="App.Domain"><classes><class filename="User.cs"><lines>
      <line number="1" hits="1"/><line number="2" hits="0"/>
    </lines></class></classes></package></packages></coverage>`
  const fromApiTests = `<coverage><sources><source>/repo/src/</source></sources><packages>
    <package name="App.Domain"><classes><class filename="App.Domain/User.cs"><lines>
      <line number="1" hits="0"/><line number="2" hits="1"/>
    </lines></class></classes></package></packages></coverage>`

  expect(parseCobertura([fromDomainTests, fromApiTests]).percent).toBe(100)
})

test('keeps the last five runs', () => {
  expect(appendHistory([1, 2, 3, 4, 5], 6)).toEqual([2, 3, 4, 5, 6])
})

test('draws a gauge with a mark at the threshold', () => {
  const text = (percent: number) => gauge(percent, 80, 10).map(part => part.text).join('')

  expect(text(99.3)).toBe('━━━━━━━━┃━')
  expect(gauge(99.3, 80, 10).map(part => part.kind)).toEqual(['covered', 'threshold', 'covered'])
  expect(gauge(50, 80, 10).map(part => part.kind)).toEqual(['covered', 'missing', 'threshold', 'missing'])
})

test('says how many points the last run moved', () => {
  expect(formatDelta([91.3, 99.3])).toBe('↑8.0')
  expect(formatDelta([99.3, 98.1])).toBe('↓1.2')
  expect(formatDelta([99.3])).toBeUndefined()
})

test('upgrades a snapshot saved before the history existed', () => {
  const saved = { percent: 91.3, modules: [], previous: 90, source: '/repo' } as never

  expect(withHistory(saved)?.history).toEqual([91.3])
  expect(withHistory(null)).toBeNull()
})
