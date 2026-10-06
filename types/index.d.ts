export type ModuleCoverage = { name: string; percent: number }

export type Coverage = { percent: number; modules: ModuleCoverage[] }

export type Snapshot = Coverage & { history: number[]; source: string }

declare module 'claude-code' {
  interface PluginState {
    'coverage-band': { last: Snapshot | null }
  }
}
