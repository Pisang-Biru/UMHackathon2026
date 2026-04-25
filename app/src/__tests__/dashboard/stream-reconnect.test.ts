import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openAgentEventStream } from '#/lib/agent-events-stream'

class MockES {
  static instances: MockES[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  readyState = 0
  private listeners: Record<string, Array<(e: MessageEvent) => void>> = {}
  constructor(public url: string) {
    MockES.instances.push(this)
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    ;(this.listeners[name] ||= []).push(fn)
  }
  emit(name: string, e: MessageEvent) {
    ;(this.listeners[name] || []).forEach((fn) => fn(e))
  }
  close() {
    this.readyState = 2
  }
}

describe('openAgentEventStream', () => {
  beforeEach(() => {
    MockES.instances = []
    ;(globalThis as unknown as { EventSource: unknown }).EventSource = MockES
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('falls back to polling after 3 failures', () => {
    const onFallback = vi.fn()
    const onEvent = vi.fn()
    openAgentEventStream({
      businessId: 'b1',
      onEvent,
      onConnect: () => {},
      onFallback,
    })
    for (let i = 0; i < 3; i++) {
      const es = MockES.instances.at(-1)!
      es.onerror?.(new Event('error'))
      vi.advanceTimersByTime(60_000)
    }
    expect(onFallback).toHaveBeenCalled()
  })

  it('delivers parsed default-channel frames to onEvent', () => {
    const onEvent = vi.fn()
    openAgentEventStream({
      businessId: 'b1',
      onEvent,
      onConnect: () => {},
      onFallback: () => {},
    })
    const es = MockES.instances.at(-1)!
    es.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ id: 1, agent_id: 'manager', kind: 'node.end' }),
      }),
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'manager' }),
    )
  })

  it('delivers named "agent.event" frames to onEvent', () => {
    const onEvent = vi.fn()
    openAgentEventStream({
      businessId: 'b1',
      onEvent,
      onConnect: () => {},
      onFallback: () => {},
    })
    const es = MockES.instances.at(-1)!
    es.emit(
      'agent.event',
      new MessageEvent('agent.event', {
        data: JSON.stringify({ id: 2, agent_id: 'customer_support', kind: 'node.end' }),
      }),
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'customer_support' }),
    )
  })
})
