import { FRAME_ART, FRAME_IDS, type FrameId, type FrameMode } from './frame-art.generated.ts'
import {
  createForeignUiGate,
  createStyleReader,
  createVisibility,
  cssModuleClass,
  mutationNeedsScan,
  type ForeignUiGate,
  type StyleReader,
  type VisibilityCheck,
} from './scan.ts'

export interface FrameController {
  sync(): void
  setMode(mode: FrameMode): void
  dispose(): void
}

const FRAME_PROPERTIES: Record<FrameId, string> = {
  selectedNav: '--dsw-frame-selected-nav',
  composer: '--dsw-frame-composer',
  dialog: '--dsw-frame-dialog',
  message: '--dsw-frame-message',
  menu: '--dsw-frame-menu',
  panel: '--dsw-frame-panel',
  primaryButton: '--dsw-frame-primary-button',
}

const FRAME_VALUES: Record<FrameId, string> = {
  selectedNav: 'selected-nav',
  composer: 'composer',
  dialog: 'dialog',
  message: 'message',
  menu: 'menu',
  panel: 'panel',
  primaryButton: 'primary-button',
}

const SELECTORS: Record<FrameId, string> = {
  selectedNav: '[role="treeitem"][aria-selected="true"]',
  composer: 'textarea, [contenteditable="true"], input:not([type])',
  dialog: '[role="dialog"]',
  message: ':not(*)',
  menu: '[role="menu"], [role="listbox"], [role="combobox"]',
  panel:
    'main > section, [role="main"] > section, [data-settings-section], [data-slot="conversation.view"] .md-code-block',
  primaryButton: 'button[type="submit"], button[data-variant="primary"]',
}

const INTERACTIVE_FRAME_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="treeitem"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
].join(', ')

// Third-party plugin interfaces and the skin's own injected chrome keep their
// native borders; every framing pass rejects plugin-authored subtrees (see
// createForeignUiGate) so decorations stay on the DSH-hosted UI only.
const FRAME_EXCLUSION_SELECTOR =
  'a, [role="link"], code, code *, [data-shortcut-modal="settings"] *, [data-skin-chrome], [data-skin-chrome] *'

const CONVERSATION_CSS_MODULES = {
  userMessage: '@deepseek-ai/dsh-client-ui-conversation/MessageItem.module.css',
  assistantMessage: '@deepseek-ai/dsh-client-ui-conversation/AssistantMarkdown.module.css',
  reasoning: '@deepseek-ai/dsh-client-ui-conversation/ReasoningRow.module.css',
} as const

interface MessageTarget {
  target: HTMLElement
  role: 'user' | 'assistant'
}

interface DesiredFrame {
  frame: string
  role?: MessageTarget['role']
}

/* One synchronization pass: style reads, visibility verdicts, and the
   plugin-subtree gate share their per-pass caches so the full-tree heuristic
   scan costs one getComputedStyle per element instead of one per ancestor. */
interface ScanPass {
  body: HTMLElement
  styleOf: StyleReader
  isVisible: VisibilityCheck
  isForeignUi: ForeignUiGate
}

function messageTargets(pass: ScanPass): MessageTarget[] {
  const body = pass.body
  const document = body.ownerDocument
  // DSH moved message rendering into ui-chat; older Web hosts still use ui-conversation.
  const messageClass = (moduleId: string, exportName: string) =>
    cssModuleClass(document, moduleId.replace('ui-conversation', 'ui-chat'), exportName) ??
    cssModuleClass(document, moduleId, exportName)
  const userBubbleClass = messageClass(CONVERSATION_CSS_MODULES.userMessage, 'bubble')
  const assistantRootClass = messageClass(CONVERSATION_CSS_MODULES.assistantMessage, 'root')
  const assistantBodyClass = messageClass(CONVERSATION_CSS_MODULES.assistantMessage, 'body')
  const reasoningRootClass = messageClass(CONVERSATION_CSS_MODULES.reasoning, 'root')

  const userMessages = userBubbleClass
    ? Array.from(body.getElementsByClassName(userBubbleClass)).filter(
        (target): target is HTMLElement => target instanceof HTMLElement,
      )
    : []
  const assistantMessages =
    assistantRootClass && assistantBodyClass
      ? Array.from(body.getElementsByClassName(assistantRootClass))
          .filter((target): target is HTMLElement => target instanceof HTMLElement)
          .flatMap((target) => {
            const content = Array.from(target.children).find(
              (child) => child instanceof HTMLElement && child.classList.contains(assistantBodyClass),
            )
            if (!(content instanceof HTMLElement)) return []
            return Array.from(content.children)
              .filter((child): child is HTMLElement => child instanceof HTMLElement)
              .filter((child) => !reasoningRootClass || !child.classList.contains(reasoningRootClass))
          })
      : []

  return [
    ...userMessages.map((target): MessageTarget => ({ target, role: 'user' })),
    ...assistantMessages.map((target): MessageTarget => ({ target, role: 'assistant' })),
  ].filter(({ target }) => !pass.isForeignUi(target) && pass.isVisible(target))
}

function visibleCandidates(pass: ScanPass, id: FrameId): HTMLElement[] {
  return Array.from(pass.body.querySelectorAll<HTMLElement>(SELECTORS[id])).filter(
    (target) => !target.matches(FRAME_EXCLUSION_SELECTOR) && !pass.isForeignUi(target) && pass.isVisible(target),
  )
}

function hasAccessibleName(button: HTMLElement): boolean {
  return Boolean(
    button.getAttribute('aria-label')?.trim() || button.getAttribute('title')?.trim() || button.textContent?.trim(),
  )
}

function related(left: HTMLElement, right: HTMLElement): boolean {
  return left === right || left.contains(right) || right.contains(left)
}

function hasRenderedBorder(target: HTMLElement, styleOf: StyleReader): boolean {
  const style = styleOf(target)
  if (!style) return false
  return [
    [style.borderTopWidth, style.borderTopStyle],
    [style.borderRightWidth, style.borderRightStyle],
    [style.borderBottomWidth, style.borderBottomStyle],
    [style.borderLeftWidth, style.borderLeftStyle],
  ].some(([width, borderStyle]) => Number.parseFloat(width) > 0 && borderStyle !== 'none')
}

/* Borderless controls the frame theme must still decorate as controls: the
   settings rows' selector, stepper, and shortcut pills draw only a background
   (language, permission, chat preference, enter behaviour, font size, and
   shortcut rows), and ARIA switches draw no border at all. The pills resolve
   through their CSS-modules export names; the switch check is structural, so
   it also covers primitives bundled into the app shell stylesheet. */
function createBorderlessControlProbe(document: Document): (target: HTMLElement) => boolean {
  const pillClasses = new Set<string>()
  for (const [moduleId, exportName] of [
    ['@deepseek-ai/dsh-client-locale/LanguageRow.module.css', 'selector'],
    ['@deepseek-ai/dsh-client-ui-permission-presets/PermissionRow.module.css', 'selector'],
    ['@deepseek-ai/dsh-client-ui-chat/PreferenceRow.module.css', 'selector'],
    ['@deepseek-ai/dsh-client-ui-conversation/EnterBehaviorRow.module.css', 'selector'],
    ['@deepseek-ai/dsh-client-ui-shortcuts/Reference.module.css', 'button'],
    ['@deepseek-ai/dsh-client-ui-theme/FontSizeRow.module.css', 'stepper'],
  ] as const) {
    const className = cssModuleClass(document, moduleId, exportName)
    if (className) pillClasses.add(className)
  }
  return (target) => {
    if (target.getAttribute('role') === 'switch') return true
    for (const name of target.classList) {
      if (pillClasses.has(name)) return true
    }
    return false
  }
}

function closestBorderedAncestor(target: HTMLElement, pass: ScanPass): HTMLElement | null {
  for (let current = target.parentElement; current && current !== pass.body; current = current.parentElement) {
    if (pass.isVisible(current) && hasRenderedBorder(current, pass.styleOf)) return current
  }
  return null
}

function selectTargets(pass: ScanPass): Map<FrameId, HTMLElement[]> {
  const result = new Map<FrameId, HTMLElement[]>()
  const selectedNav = visibleCandidates(pass, 'selectedNav').slice(0, 1)
  const composer = visibleCandidates(pass, 'composer').slice(0, 1)
  const dialogs = visibleCandidates(pass, 'dialog')
  const menus = visibleCandidates(pass, 'menu')
  const reserved = [...composer, ...dialogs, ...menus]
  const panelCandidates = visibleCandidates(pass, 'panel').filter((panel) =>
    reserved.every((target) => !related(panel, target)),
  )
  const panels = panelCandidates.filter((panel) =>
    panelCandidates.every((candidate) => candidate === panel || !candidate.contains(panel)),
  )
  const primaryButtons = visibleCandidates(pass, 'primaryButton').filter(hasAccessibleName)

  result.set('selectedNav', selectedNav)
  result.set('composer', composer)
  result.set('dialog', dialogs)
  result.set('menu', menus)
  result.set('panel', panels)
  result.set('primaryButton', primaryButtons)
  return result
}

export function createFrameController(body: HTMLElement): FrameController {
  let disposed = false
  let frame: number | undefined
  let mode: FrameMode = 'light'
  const view = body.ownerDocument.defaultView ?? window

  const clearMarkers = (): void => {
    body
      .querySelectorAll<HTMLElement>('[data-dsh-frame], [data-dsh-message-role], [data-dsh-control-row]')
      .forEach((target) => {
        target.removeAttribute('data-dsh-frame')
        target.removeAttribute('data-dsh-message-role')
        target.removeAttribute('data-dsh-control-row')
      })
  }

  const syncResources = (): void => {
    const sharedFrame = FRAME_ART[mode].message
    for (const id of FRAME_IDS) {
      body.style.setProperty(FRAME_PROPERTIES[id], `url("${sharedFrame}")`)
    }
  }

  const sync = (): void => {
    if (disposed) return
    const styleOf = createStyleReader(body)
    const pass: ScanPass = {
      body,
      styleOf,
      isVisible: createVisibility(body, styleOf),
      isForeignUi: createForeignUiGate(body),
    }
    const targets = selectTargets(pass)
    const trajectoryClass = cssModuleClass(
      body.ownerDocument,
      '@deepseek-ai/dsh-client-ui-trajectory/views.module.css',
      'root',
    )
    const customSettingsClass = cssModuleClass(
      body.ownerDocument,
      '@deepseek-ai/dsh-client-ui-settings-models/ModelsSection.module.css',
      'customized',
    )
    const platformOverlayClass = cssModuleClass(
      body.ownerDocument,
      '@deepseek-ai/dsh-client-ui-settings-account/PlatformOverlay.module.css',
      'overlay',
    )
    const desired = new Map<HTMLElement, DesiredFrame>()
    const inputCardClass = cssModuleClass(
      body.ownerDocument,
      '@deepseek-ai/dsh-client-ui-conversation/InputBar.module.css',
      'card',
    )
    const isBorderlessControl = createBorderlessControlProbe(body.ownerDocument)
    for (const id of FRAME_IDS) {
      targets.get(id)?.forEach((target) => {
        desired.set(target, { frame: FRAME_VALUES[id] })
      })
    }
    targets.get('composer')?.forEach((target) => {
      const shell =
        (inputCardClass && target.closest<HTMLElement>(`.${inputCardClass}`)) || closestBorderedAncestor(target, pass)
      if (shell) desired.set(shell, { frame: 'composer-shell' })
    })
    messageTargets(pass).forEach(({ target, role }) => {
      desired.set(target, { frame: 'message', role })
    })
    body.querySelectorAll<HTMLElement>('*').forEach((target) => {
      if (
        !(target instanceof HTMLElement) ||
        desired.has(target) ||
        target.matches(FRAME_EXCLUSION_SELECTOR) ||
        pass.isForeignUi(target) ||
        !pass.isVisible(target)
      )
        return
      const existing = target.dataset.dshFrame
      if (existing === 'control' || existing === 'surface') {
        desired.set(target, { frame: existing })
        return
      }
      const borderlessControl = isBorderlessControl(target)
      if (!target.hasAttribute('data-dsh-frame') && (hasRenderedBorder(target, pass.styleOf) || borderlessControl)) {
        desired.set(target, {
          frame: borderlessControl || target.matches(INTERACTIVE_FRAME_SELECTOR) ? 'control' : 'surface',
        })
      }
    })
    if (trajectoryClass) {
      desired.forEach((_frame, target) => {
        if (target.closest(`.${trajectoryClass}`)) desired.delete(target)
      })
    }
    if (customSettingsClass) {
      desired.forEach((_frame, target) => {
        if (target.parentElement?.closest(`.${customSettingsClass}`)) desired.delete(target)
      })
    }
    /* The platform usage overlay is a full-viewport modal wrapping the
       platform's own web content: its role="dialog" and bordered header would
       otherwise draw the dialog frame across the whole window rim. The
       platform page keeps its native chrome, like the trajectory view. */
    if (platformOverlayClass) {
      desired.forEach((_frame, target) => {
        if (target.closest(`.${platformOverlayClass}`)) desired.delete(target)
      })
    }
    body.querySelectorAll<HTMLElement>('[data-dsh-frame], [data-dsh-message-role]').forEach((target) => {
      const next = desired.get(target)
      if (!next) {
        target.removeAttribute('data-dsh-frame')
        target.removeAttribute('data-dsh-message-role')
        return
      }
      if (target.dataset.dshFrame !== next.frame) target.dataset.dshFrame = next.frame
      if (next.role === undefined) target.removeAttribute('data-dsh-message-role')
      else if (target.dataset.dshMessageRole !== next.role) target.dataset.dshMessageRole = next.role
      desired.delete(target)
    })
    desired.forEach((next, target) => {
      target.dataset.dshFrame = next.frame
      if (next.role !== undefined) target.dataset.dshMessageRole = next.role
    })
    syncControlRows()
  }

  const syncControlRows = (): void => {
    const counts = new Map<HTMLElement, number>()
    body.querySelectorAll<HTMLElement>('[data-dsh-frame="control"]').forEach((control) => {
      const parent = control.parentElement
      if (parent && parent !== body) counts.set(parent, (counts.get(parent) ?? 0) + 1)
    })
    const qualified = new Set<HTMLElement>()
    counts.forEach((count, parent) => {
      if (count >= 2) qualified.add(parent)
    })
    body.querySelectorAll<HTMLElement>('[data-dsh-control-row]').forEach((row) => {
      if (qualified.has(row)) qualified.delete(row)
      else row.removeAttribute('data-dsh-control-row')
    })
    qualified.forEach((row) => {
      row.setAttribute('data-dsh-control-row', '')
    })
  }

  const requestFrame = (callback: FrameRequestCallback): number => {
    if (typeof view.requestAnimationFrame === 'function') return view.requestAnimationFrame(callback)
    return view.setTimeout(() => callback(performance.now()), 0)
  }
  const cancelFrame = (handle: number): void => {
    if (typeof view.cancelAnimationFrame === 'function') view.cancelAnimationFrame(handle)
    else view.clearTimeout(handle)
  }
  const schedule = (): void => {
    if (disposed || frame != null) return
    frame = requestFrame(() => {
      frame = undefined
      sync()
    })
  }

  const observer = new MutationObserver((mutations) => {
    if (mutationNeedsScan(mutations)) schedule()
  })
  observer.observe(body, {
    attributes: true,
    attributeFilter: [
      'aria-hidden',
      'aria-selected',
      'class',
      'data-variant',
      'disabled',
      'hidden',
      'open',
      'role',
      'style',
      'type',
    ],
    childList: true,
    subtree: true,
  })

  syncResources()
  sync()

  return {
    sync,
    setMode(nextMode) {
      if (disposed) return
      mode = nextMode
      syncResources()
      sync()
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (frame != null) cancelFrame(frame)
      observer.disconnect()
      clearMarkers()
      for (const property of Object.values(FRAME_PROPERTIES)) body.style.removeProperty(property)
    },
  }
}
