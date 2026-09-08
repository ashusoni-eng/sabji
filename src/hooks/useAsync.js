import { useState, useEffect, useCallback, useRef } from 'react'
import { readableError } from '../lib/supabase'

/**
 * Every screen that reads from the database needs the same four states:
 * loading, data, error, and a way to retry. This gives all of them the same
 * shape so no screen quietly forgets one.
 */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(immediate)
  const alive = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fnRef.current()
      if (alive.current) setData(result)
      return result
    } catch (e) {
      if (alive.current) setError(readableError(e))
      return undefined
    } finally {
      if (alive.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { if (immediate) run() }, [run, immediate])

  return { data, error, loading, reload: run, setData }
}

/** Debounces a fast-changing value — used for the search box. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Tracks whether the device is online, for the offline banner. */
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return online
}
