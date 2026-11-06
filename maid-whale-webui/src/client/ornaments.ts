import css from './deepseek-workshop.module.css'
import { ORNAMENT_ART, type OrnamentId, type OrnamentMode } from './ornament-art.generated.ts'
import { chooseOrnaments } from './ornament-policy.ts'
import {
  createForeignUiGate,
  createStyleReader,
  createVisibility,
  mutationNeedsScan,
  type ForeignUiGate,
  type VisibilityCheck,
} from './scan.ts'

export interface OrnamentController {
  sync(): void
  setMode(mode: OrnamentMode): void
  setWide(wide: boolean): void
  dispose(): void
}

interface Targets {
  selectedNav: HTMLElement | null
  tree: HTMLElement | null
  workspaceLabel: HTMLElement | null
  composer: HTMLElement | null
  dialog: HTMLElement | null
  heading: HTMLElement | null
}

function visibleTarget<T extends HTMLElement>(
  body: HTMLElement,
  selector: string,
  isForeignUi: ForeignUiGate,
  isVisible: VisibilityCheck,
): T | null {
  for (const target of Array.from(body.querySelectorAll<T>(selector))) {
    if (!isForeignUi(target) && isVisible(target)) return target
  }
  return null
}

function workspaceLabelForTree(
  tree: HTMLElement | null,
  body: HTMLElement,
  isVisible: VisibilityCheck,
): HTMLElement | null {
  if (!tree) return null
  for (let current: HTMLElement | null = tree; current && current !== body; current = current.parentElement) {
    const header = current.previousElementSibling
    if (!(header instanceof HTMLElement) || !isVisible(header)) continue
    const label = Array.from(header.querySelectorAll<HTMLElement>('span')).find((candidate) => isVisible(candidate))
    return label ?? header
  }
  return null
}

const ornamentClasses: Record<OrnamentId, string> = {
  bow: css.ornamentBow,
  whaleTail: css.ornamentWhaleTail,
  apronCrest: css.ornamentApronCrest,
  hairWave: css.ornamentHairWave,
  bubbles: css.ornamentBubbles,
  headbandCorner: css.ornamentHeadbandCorner,
  ribbonTab: css.ornamentRibbonTab,
}

function resolveTargets(body: HTMLElement): Targets {
  const isForeignUi = createForeignUiGate(body)
  const styleOf = createStyleReader(body)
  const isVisible = createVisibility(body, styleOf)
  const tree = visibleTarget(body, '[role="tree"]', isForeignUi, isVisible)
  return {
    selectedNav: visibleTarget(body, '[role="treeitem"][aria-selected="true"]', isForeignUi, isVisible),
    tree,
    workspaceLabel: workspaceLabelForTree(tree, body, isVisible),
    composer: visibleTarget(body, 'textarea, [contenteditable="true"], input:not([type])', isForeignUi, isVisible),
    dialog: visibleTarget(body, '[role="dialog"]', isForeignUi, isVisible),
    heading: visibleTarget(body, 'main h1, main h2, [role="main"] h1, [role="main"] h2', isForeignUi, isVisible),
  }
}

function hasComposerContent(composer: HTMLElement | null): boolean {
  if (!composer) return false
  if (composer instanceof HTMLInputElement || composer instanceof HTMLTextAreaElement) {
    return composer.value.trim().length > 0
  }
  return (composer.textContent ?? '').trim().length > 0
}

function targetFor(id: OrnamentId, targets: Targets): HTMLElement | null {
  switch (id) {
    case 'bow':
      return targets.selectedNav
    case 'whaleTail':
      return targets.workspaceLabel ?? targets.tree
    case 'bubbles':
    case 'ribbonTab':
      return targets.composer
    case 'apronCrest':
    case 'headbandCorner':
      return targets.dialog
    case 'hairWave':
      return targets.heading
  }
}

export function createOrnamentController(body: HTMLElement, options: { wide: boolean }): OrnamentController {
  let wide = options.wide
  let mode: OrnamentMode = 'light'
  let disposed = false
  let frame: number | undefined
  let targets: Targets = resolveTargets(body)

  const layer = body.ownerDocument.createElement('div')
  layer.dataset.skinChrome = 'ornaments'
  layer.className = css.ornamentLayer
  layer.setAttribute('aria-hidden', 'true')
  body.append(layer)

  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => schedule())

  const clearTargetMarkers = () => {
    body.querySelectorAll<HTMLElement>('[data-dsh-ornament-target]').forEach((target) => {
      target.removeAttribute('data-dsh-ornament-target')
    })
  }

  const sync = () => {
    if (disposed) return
    targets = resolveTargets(body)
    const composerEngaged =
      targets.composer != null &&
      (targets.composer === body.ownerDocument.activeElement || hasComposerContent(targets.composer))
    const selected = chooseOrnaments({
      wide,
      selectedNav: targets.selectedNav != null,
      dialog: targets.dialog != null,
      composerEngaged,
      heading: targets.heading != null,
    }).filter((id) => targetFor(id, targets) != null)
    const selectedSet = new Set<OrnamentId>(selected)

    layer.querySelectorAll<HTMLImageElement>('img[data-dsh-ornament]').forEach((image) => {
      if (!selectedSet.has(image.dataset.dshOrnament as OrnamentId)) image.remove()
    })
    clearTargetMarkers()
    resizeObserver?.disconnect()

    for (const id of selected) {
      const target = targetFor(id, targets)
      if (!target) continue
      target.dataset.dshOrnamentTarget = id
      resizeObserver?.observe(target)

      let image = layer.querySelector<HTMLImageElement>(`img[data-dsh-ornament="${id}"]`)
      if (!image) {
        image = body.ownerDocument.createElement('img')
        image.dataset.dshOrnament = id
        image.className = `${css.ornament} ${ornamentClasses[id]}`
        image.alt = ''
        image.draggable = false
        image.setAttribute('aria-hidden', 'true')
        layer.append(image)
      }
      image.src = ORNAMENT_ART[mode][id]
      const rect = target.getBoundingClientRect()
      image.style.setProperty('--dsw-x', `${rect.left}px`)
      image.style.setProperty('--dsw-y', `${rect.top}px`)
      image.style.setProperty('--dsw-w', `${rect.width}px`)
      image.style.setProperty('--dsw-h', `${rect.height}px`)
    }
  }

  const requestFrame = (callback: FrameRequestCallback): number => {
    if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback)
    return window.setTimeout(() => callback(performance.now()), 0)
  }
  const cancelFrame = (handle: number) => {
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(handle)
    else window.clearTimeout(handle)
  }
  function schedule(): void {
    if (disposed || frame != null) return
    frame = requestFrame(() => {
      frame = undefined
      sync()
    })
  }

  const mutationObserver = new MutationObserver((mutations) => {
    const externalMutations = mutations.filter((mutation) => !layer.contains(mutation.target))
    if (mutationNeedsScan(externalMutations)) schedule()
  })
  mutationObserver.observe(body, {
    attributes: true,
    attributeFilter: ['aria-hidden', 'aria-selected', 'class', 'hidden', 'open', 'role', 'style'],
    childList: true,
    subtree: true,
  })

  const eventTypes = ['focusin', 'focusout', 'input', 'transitionend'] as const
  eventTypes.forEach((type) => {
    body.addEventListener(type, schedule)
  })
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)

  return {
    sync,
    setMode(nextMode) {
      mode = nextMode
      sync()
    },
    setWide(nextWide) {
      wide = nextWide
      sync()
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (frame != null) cancelFrame(frame)
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      eventTypes.forEach((type) => {
        body.removeEventListener(type, schedule)
      })
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      clearTargetMarkers()
      layer.remove()
    },
  }
}
