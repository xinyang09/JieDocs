import assert from 'node:assert/strict'
import test from 'node:test'
import { installWhenUniverRendered } from '../src/univer-lifecycle.ts'

function lifecycleAt(initialStage: number) {
  let stage = initialStage
  const listeners = new Set<(event: { stage: number }) => void>()
  const api = {
    Enum: { LifecycleStages: { Rendered: 2 } },
    Event: { LifeCycleChanged: 'LifeCycleChanged' as const },
    getCurrentLifecycleStage: () => stage,
    addEvent: (_event: 'LifeCycleChanged', listener: (event: { stage: number }) => void) => {
      listeners.add(listener)
      listener({ stage })
      return { dispose: () => { listeners.delete(listener) } }
    },
  }
  return {
    api,
    listeners,
    advance: (nextStage: number) => {
      stage = nextStage
      for (const listener of listeners) listener({ stage })
    },
  }
}

test('waits for paragraph render modules instead of resolving them when the document is created', () => {
  const lifecycle = lifecycleAt(1)
  let paragraphModuleRegistered = false
  let installations = 0
  const dispose = installWhenUniverRendered(lifecycle.api, () => {
    assert.equal(paragraphModuleRegistered, true)
    installations += 1
    return () => {}
  })
  assert.equal(installations, 0)
  paragraphModuleRegistered = true
  lifecycle.advance(2)
  assert.equal(installations, 1)
  lifecycle.advance(3)
  assert.equal(installations, 1)
  dispose()
})

test('installs once when attached after Univer is already rendered', () => {
  const lifecycle = lifecycleAt(2)
  let installations = 0
  const dispose = installWhenUniverRendered(lifecycle.api, () => {
    installations += 1
    return () => {}
  })
  assert.equal(installations, 1)
  dispose()
})

test('closing a document before render cancels its pending installation', () => {
  const lifecycle = lifecycleAt(1)
  let installations = 0
  const dispose = installWhenUniverRendered(lifecycle.api, () => {
    installations += 1
    return () => {}
  })
  dispose()
  lifecycle.advance(2)
  assert.equal(installations, 0)
  assert.equal(lifecycle.listeners.size, 0)
})

test('closing a rendered document removes the menu subscription and lifecycle listener', () => {
  const lifecycle = lifecycleAt(1)
  let cleanups = 0
  const dispose = installWhenUniverRendered(lifecycle.api, () => () => { cleanups += 1 })
  lifecycle.advance(2)
  dispose()
  assert.equal(cleanups, 1)
  assert.equal(lifecycle.listeners.size, 0)
})
