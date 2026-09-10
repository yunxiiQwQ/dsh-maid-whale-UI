/* Per-pass DOM scan utilities shared by the frame and ornament controllers.
   Every controller synchronization builds one pass: computed styles,
   visibility verdicts, and plugin-subtree gates memoize for the duration of
   the pass, so a full-tree heuristic scan costs one style read per element
   instead of one per ancestor per element. Stylesheet parsing (the plugin
   class inventory and CSS-modules export lookups) caches across passes until
   the stylesheet text changes. */

export type StyleReader = (target: HTMLElement) => CSSStyleDeclaration | undefined

export type VisibilityCheck = (target: HTMLElement) => boolean

export type ForeignUiGate = (target: HTMLElement) => boolean

function hasElementNode(nodes: NodeList): boolean {
  return Array.from(nodes).some((node) => node.nodeType === 1)
}

/** Text streaming changes character data or adds text nodes. Neither can
    introduce or remove a semantic frame target, so only structural element
    changes and observed attributes require a new full-tree scan. */
export function mutationNeedsScan(mutations: readonly MutationRecord[]): boolean {
  return mutations.some((mutation) => {
    if (mutation.type === 'attributes') return true
    if (mutation.type !== 'childList') return false
    return hasElementNode(mutation.addedNodes) || hasElementNode(mutation.removedNodes)
  })
}

interface ParsedStyleSheet {
  text: string
  classNames: Set<string>
  exportNames: Map<string, string | undefined>
}

/* Stylesheets injected as style[data-plugin-css] carry their module id. Host
   UI packages live under @deepseek-ai/dsh-client-ui-*; every other tagged
   stylesheet belongs to a plugin (this skin included), so the class names it
   declares mark plugin-authored subtrees. */
const NATIVE_CSS_PREFIX = '@deepseek-ai/dsh-client-ui'

const parsedStyleSheets = new WeakMap<HTMLStyleElement, ParsedStyleSheet>()

function parseStyleSheet(style: HTMLStyleElement): ParsedStyleSheet {
  const text = style.textContent ?? ''
  let parsed = parsedStyleSheets.get(style)
  if (parsed?.text === text) return parsed
  const classNames = new Set<string>()
  for (const match of text.matchAll(/\.([-\w]+)(?![-\w])/g)) classNames.add(match[1])
  parsed = { text, classNames, exportNames: new Map() }
  parsedStyleSheets.set(style, parsed)
  return parsed
}

/** Class names declared by plugin stylesheets; host-authored sheets are
    skipped so host components never count as plugin UI. */
export function foreignClassNames(body: HTMLElement): Set<string> {
  const names = new Set<string>()
  body.ownerDocument.querySelectorAll<HTMLStyleElement>('style[data-plugin-css]').forEach((style) => {
    const moduleId = style.dataset.pluginCss ?? ''
    if (moduleId.startsWith(NATIVE_CSS_PREFIX) || moduleId === '@deepseek-ai/dsh-client-locale/LanguageRow.module.css')
      return
    for (const name of parseStyleSheet(style).classNames) names.add(name)
  })
  return names
}

/** Resolve a CSS-modules export name to its hashed class. Cached per
    stylesheet text so repeated syncs skip the full-text regex match. */
export function cssModuleClass(document: Document, moduleId: string, exportName: string): string | undefined {
  const style = Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-plugin-css]')).find(
    (candidate) => candidate.dataset.pluginCss === moduleId,
  )
  if (!style) return undefined
  const parsed = parseStyleSheet(style)
  if (!parsed.exportNames.has(exportName)) {
    const safeExportName = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    parsed.exportNames.set(
      exportName,
      parsed.text.match(new RegExp(`\\.([\\w-]+_${safeExportName})(?=[\\s,{.:#>\\[])`))?.[1],
    )
  }
  return parsed.exportNames.get(exportName)
}

/** One getComputedStyle read per element per pass; the live declaration is
    stable because a pass never interleaves style reads with DOM writes. */
export function createStyleReader(body: HTMLElement): StyleReader {
  const view = body.ownerDocument.defaultView
  const cache = new WeakMap<HTMLElement, CSSStyleDeclaration>()
  return (target) => {
    let style = cache.get(target)
    if (style === undefined && view) {
      style = view.getComputedStyle(target)
      cache.set(target, style)
    }
    return style
  }
}

/** Visibility with a memoized ancestor chain. Document-order iteration lets
    each verdict reuse its parent's, collapsing per-element ancestor walks
    into one shared pass; target-only checks (hidden, aria-hidden,
    checkVisibility) stay outside the memo because they never apply to
    ancestors. */
export function createVisibility(body: HTMLElement, styleOf: StyleReader): VisibilityCheck {
  const verdicts = new Map<HTMLElement, boolean>()
  const chainVisible = (target: HTMLElement): boolean => {
    const cached = verdicts.get(target)
    if (cached !== undefined) return cached
    const style = styleOf(target)
    const opacity = Number.parseFloat(style?.opacity ?? '1')
    const concealed = style?.display === 'none' || style?.visibility === 'hidden' || opacity <= 0.05
    const parent = target.parentElement
    const visible = !concealed && (target === body || parent == null || chainVisible(parent))
    verdicts.set(target, visible)
    return visible
  }
  return (target) => {
    if (target.hidden || target.getAttribute('aria-hidden') === 'true') return false
    const checkVisibility = (
      target as HTMLElement & {
        checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean
      }
    ).checkVisibility
    if (checkVisibility && !checkVisibility.call(target, { checkOpacity: true, checkVisibilityCSS: true })) return false
    return chainVisible(target)
  }
}

/** Snapshot gate over plugin-authored subtrees. Verdicts memoize up the
    ancestor chain like visibility and are recomputed per pass so plugins
    that load late are covered too. */
export function createForeignUiGate(body: HTMLElement): ForeignUiGate {
  const foreignClasses = foreignClassNames(body)
  const verdicts = new Map<HTMLElement, boolean>()
  const gate = (target: HTMLElement): boolean => {
    const cached = verdicts.get(target)
    if (cached !== undefined) return cached
    let self = false
    for (const name of target.classList) {
      if (foreignClasses.has(name)) {
        self = true
        break
      }
    }
    const parent = target.parentElement
    const verdict = self || (parent != null && parent !== body ? gate(parent) : false)
    verdicts.set(target, verdict)
    return verdict
  }
  return gate
}
