import type { Context } from '@deepseek-ai/cordis'
import { MASCOT_ART, PAPER_BACKDROP_DARK, PAPER_BACKDROP_LIGHT } from './art.ts'
import { ILLUSTRATED_BACKGROUND, SIDEBAR_OCEAN_BACKGROUND } from './background-art.generated.ts'
import { registerCompanionSettingsCard } from './companion-settings.ts'
import { writeCompanionConfig } from './config-writes.ts'
import css from './deepseek-workshop.module.css'
import { createFrameController } from './frames.ts'
import { createOrnamentController } from './ornaments.ts'

const BODY_ATTR = 'data-dsh-deepseek-workshop'
const SKIN_TITLE = 'DeepSeek 云鲸纸面'
// Published by the Desktop shell's application preload before any page script
// runs. The Desktop window keeps its native chrome (taskbar title, window
// icon), so the browser-only title/favicon rebranding is skipped there.
const isDesktopShell = (): boolean => (globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot !== undefined
const WIDE_QUERY = '(min-width: 960px)'
const SIDEBAR_ATTR = 'data-dsh-sidebar-surface'
const SIDEBAR_BACKGROUND_PROPERTY = '--dsw-sidebar-ocean-background'
const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

export const inject = ['slots']

/** Apply the cloud-paper theme and register a complete retraction lifecycle. */
export function apply(ctx: Context): void {
  const body = document.body
  const originalTitle = document.title
  const previous = new Map<string, string>()
  for (const property of BACKDROP_PROPERTIES) {
    previous.set(property, body.style.getPropertyValue(property))
  }

  body.setAttribute(BODY_ATTR, '')

  if (!isDesktopShell()) {
    const favicon = document.createElement('link')
    favicon.rel = 'icon'
    favicon.type = 'image/webp'
    favicon.href = MASCOT_ART
    favicon.dataset.deepseekWorkshopIcon = ''
    document.head.append(favicon)
  }

  const media = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : undefined
  let sidebarSurface: HTMLElement | undefined
  const clearSidebarSurface = (): void => {
    sidebarSurface?.removeAttribute(SIDEBAR_ATTR)
    sidebarSurface?.style.removeProperty(SIDEBAR_BACKGROUND_PROPERTY)
    sidebarSurface = undefined
  }
  const findSidebarSurface = (): HTMLElement | undefined => {
    const tree = body.querySelector<HTMLElement>('[role="tree"]')
    if (!tree) return undefined
    const treeBounds = tree.getBoundingClientRect()
    const maximumSidebarWidth = Math.max(480, treeBounds.width * 1.75)
    let candidate = tree
    for (let parent = tree.parentElement; parent && parent !== body; parent = parent.parentElement) {
      const bounds = parent.getBoundingClientRect()
      if (bounds.width <= 0) continue
      if (treeBounds.width > 0 && bounds.width > maximumSidebarWidth) break
      candidate = parent
    }
    return candidate
  }
  const syncSidebarSurface = (): void => {
    const next = findSidebarSurface()
    if (next === sidebarSurface && next?.isConnected) return
    clearSidebarSurface()
    if (!next) return
    sidebarSurface = next
    sidebarSurface.setAttribute(SIDEBAR_ATTR, '')
    sidebarSurface.style.setProperty(SIDEBAR_BACKGROUND_PROPERTY, `url("${SIDEBAR_OCEAN_BACKGROUND}")`)
  }
  syncSidebarSurface()

  const petToggle = document.createElement('button')
  petToggle.type = 'button'
  petToggle.className = css.petToggle ?? ''
  petToggle.dataset.skinChrome = 'pet-toggle'
  petToggle.setAttribute('aria-label', '鲸鱼桌宠开关')
  const petToggleIcon = document.createElement('img')
  petToggleIcon.className = css.petToggleImage ?? ''
  petToggleIcon.src = MASCOT_ART
  petToggleIcon.alt = ''
  petToggleIcon.draggable = false
  petToggleIcon.setAttribute('aria-hidden', 'true')
  petToggle.append(petToggleIcon)
  let petEnabled = true
  let petPatchSeq = 0
  const syncPetToggle = (): void => {
    petToggle.dataset.petOn = petEnabled ? 'on' : 'off'
    petToggle.setAttribute('aria-pressed', String(petEnabled))
    petToggle.title = petEnabled ? '鲸鱼桌宠：开（点击关闭）' : '鲸鱼桌宠：关（点击开启）'
  }
  const patchPetEnabled = async (next: boolean): Promise<void> => {
    const seq = ++petPatchSeq
    petEnabled = next
    syncPetToggle()
    try {
      const config = (await writeCompanionConfig({ enabled: next })) as { enabled?: boolean }
      if (seq === petPatchSeq) {
        petEnabled = config.enabled !== false
      }
    } catch {
      // Host unreachable: keep the optimistic state; the next click retries.
    }
    if (seq === petPatchSeq) syncPetToggle()
  }
  petToggle.addEventListener('click', () => {
    void patchPetEnabled(!petEnabled)
  })
  const syncPetTogglePosition = (): void => {
    const bounds = sidebarSurface?.getBoundingClientRect()
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      petToggle.style.left = `${Math.round(bounds.right - 54)}px`
      petToggle.style.right = 'auto'
    } else {
      petToggle.style.left = 'auto'
      petToggle.style.right = 'max(16px, env(safe-area-inset-right))'
    }
  }
  syncPetToggle()
  body.append(petToggle)
  syncPetTogglePosition()
  if (typeof fetch === 'function') {
    void fetch('/plugins/maid-whale-webui/config', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((config: { enabled?: boolean } | null) => {
        if (!config) return
        petEnabled = config.enabled !== false
        syncPetToggle()
      })
      .catch(() => {})
  }

  const ornaments = createOrnamentController(body, { wide: media?.matches ?? true })
  const frames = createFrameController(body)
  const setBackdrop = (): void => {
    const dark = body.hasAttribute('data-ds-dark-theme')
    const mode = dark ? 'dark' : 'light'
    const haze = dark
      ? 'linear-gradient(rgba(18, 31, 47, 0.52), rgba(18, 31, 47, 0.52))'
      : 'linear-gradient(rgba(255, 254, 249, 0.60), rgba(255, 254, 249, 0.60))'
    const paper = dark ? PAPER_BACKDROP_DARK : PAPER_BACKDROP_LIGHT
    body.style.setProperty('background-image', `${haze}, url("${ILLUSTRATED_BACKGROUND}"), ${paper}`)
    body.style.setProperty('background-position', 'center, center, center, center, center')
    body.style.setProperty('background-size', 'cover, cover, cover, cover, cover')
    body.style.setProperty('background-attachment', 'fixed')
    body.style.setProperty('background-repeat', 'no-repeat')
    ornaments.setMode(mode)
    frames.setMode(mode)
  }

  const syncViewport = (): void => {
    ornaments.setWide(media?.matches ?? true)
  }

  const syncChrome = (): void => {
    syncSidebarSurface()
    syncPetTogglePosition()
  }
  // Coalesce chrome reflows to one per frame: each mutation batch used to run
  // sidebar lookups (getBoundingClientRect walks) synchronously, forcing a
  // layout between React commits.
  let chromeFrame: number | undefined
  const requestChromeFrame = (callback: FrameRequestCallback): number => {
    if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback)
    return window.setTimeout(() => callback(performance.now()), 0)
  }
  const cancelChromeFrame = (handle: number): void => {
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(handle)
    else window.clearTimeout(handle)
  }
  const scheduleChrome = (): void => {
    if (chromeFrame != null) return
    chromeFrame = requestChromeFrame(() => {
      chromeFrame = undefined
      syncChrome()
    })
  }
  const chromeObserver = new MutationObserver(scheduleChrome)
  chromeObserver.observe(body, { childList: true, subtree: true })
  window.addEventListener('resize', scheduleChrome)

  setBackdrop()
  if (!isDesktopShell()) document.title = SKIN_TITLE
  registerCompanionSettingsCard(ctx)

  const observer = new MutationObserver(setBackdrop)
  observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  media?.addEventListener('change', syncViewport)

  ctx.effect(
    () => () => {
      frames.dispose()
      ornaments.dispose()
      observer.disconnect()
      chromeObserver.disconnect()
      if (chromeFrame != null) cancelChromeFrame(chromeFrame)
      media?.removeEventListener('change', syncViewport)
      window.removeEventListener('resize', scheduleChrome)
      clearSidebarSurface()
      body.removeAttribute(BODY_ATTR)
      document.querySelector('link[data-deepseek-workshop-icon]')?.remove()
      petToggle.remove()
      for (const [property, value] of previous) {
        if (value === '') body.style.removeProperty(property)
        else body.style.setProperty(property, value)
      }
      if (document.title === SKIN_TITLE) document.title = originalTitle
    },
    'ui-skin-maid-whale-webui: cloud paper surface',
  )
}
