import { useCallback, useEffect, useState } from 'react'

export type DemocracyMergeSettings = {
  animationsEnabled: boolean
  animationSpeed: 'normal' | 'fast'
}

const STORAGE_KEY = 'friend-battle.democracy-merge.settings.v1'
const CHANGE_EVENT = 'democracy-merge-settings-change'

export const DEFAULT_DEMOCRACY_MERGE_SETTINGS: DemocracyMergeSettings = {
  animationsEnabled: true,
  animationSpeed: 'normal',
}

function readSettings(): DemocracyMergeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_DEMOCRACY_MERGE_SETTINGS
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_DEMOCRACY_MERGE_SETTINGS
    const candidate = value as Partial<DemocracyMergeSettings>
    return {
      animationsEnabled: typeof candidate.animationsEnabled === 'boolean'
        ? candidate.animationsEnabled
        : DEFAULT_DEMOCRACY_MERGE_SETTINGS.animationsEnabled,
      animationSpeed: candidate.animationSpeed === 'fast' ? 'fast' : 'normal',
    }
  } catch {
    return DEFAULT_DEMOCRACY_MERGE_SETTINGS
  }
}

export function useDemocracyMergeSettings() {
  const [settings, setSettings] = useState<DemocracyMergeSettings>(DEFAULT_DEMOCRACY_MERGE_SETTINGS)

  useEffect(() => {
    const sync = () => setSettings(readSettings())
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener(CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(CHANGE_EVENT, sync)
    }
  }, [])

  const updateSettings = useCallback((patch: Partial<DemocracyMergeSettings>) => {
    const next = { ...readSettings(), ...patch }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Settings still apply for this mounted session if storage is unavailable.
    }
    setSettings(next)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { settings, updateSettings }
}
