import { useState, useEffect, useRef, useCallback } from 'react'
import type { SSEEvent } from './types'
import { MOCK_SSE_EVENTS } from './mocks'

export function useSSE(runId: string | null): {
  events: SSEEvent[]
  connected: boolean
} {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!runId) {
      setEvents([])
      setConnected(false)
      return
    }

    const source = new EventSource(
      `http://localhost:8080/api/runs/${runId}/logs`
    )

    source.onopen = () => {
      setConnected(true)
    }

    source.onmessage = (e: MessageEvent) => {
      const event: SSEEvent = JSON.parse(e.data as string)
      setEvents((prev) => [...prev, event])
    }

    source.onerror = () => {
      setConnected(false)
    }

    return () => {
      source.close()
      setConnected(false)
    }
  }, [runId])

  return { events, connected }
}

export function useMockSSE(): { events: SSEEvent[]; connected: boolean } {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [connected, setConnected] = useState(false)
  const timerIds = useRef<ReturnType<typeof setTimeout>[]>([])

  const replay = useCallback(() => {
    setEvents([])
    setConnected(true)

    timerIds.current.forEach(clearTimeout)
    timerIds.current = []

    MOCK_SSE_EVENTS.forEach((event, i) => {
      const id = setTimeout(() => {
        setEvents((prev) => [...prev, event])
      }, (i + 1) * 800)
      timerIds.current.push(id)
    })
  }, [])

  useEffect(() => {
    replay()

    return () => {
      timerIds.current.forEach(clearTimeout)
      timerIds.current = []
      setConnected(false)
    }
  }, [replay])

  return { events, connected }
}
