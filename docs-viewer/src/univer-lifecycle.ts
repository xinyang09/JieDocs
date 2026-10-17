type Disposable = { dispose: () => void }

type UniverLifecycle = {
  Enum: { LifecycleStages: { Rendered: number } }
  Event: { LifeCycleChanged: 'LifeCycleChanged' }
  getCurrentLifecycleStage: () => number
  addEvent: (event: 'LifeCycleChanged', callback: (event: { stage: number }) => void) => Disposable
}

/** Render modules are registered at Rendered, after createDocument returns at Ready. */
export function installWhenUniverRendered(api: UniverLifecycle, install: () => () => void) {
  let installed = false
  let disposed = false
  let cleanup = () => {}
  const onStage = (stage: number) => {
    if (disposed || installed || stage < api.Enum.LifecycleStages.Rendered) return
    installed = true
    cleanup = install()
  }
  const listener = api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => onStage(stage))
  onStage(api.getCurrentLifecycleStage())
  return () => {
    disposed = true
    listener.dispose()
    cleanup()
  }
}
