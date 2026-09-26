// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { apply } from '../src/client/index.ts'

let fiber: Fiber | undefined

async function mount(): Promise<Fiber> {
  const mounted = new Context().plugin({ apply })
  await mounted.await()
  return mounted
}

async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function installMatchMedia(initial: boolean): { set: (next: boolean) => void } {
  let matches = initial
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    get matches() {
      return matches
    },
    media: '(min-width: 960px)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  } as unknown as MediaQueryList
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )
  return {
    set(next) {
      matches = next
      const event = { matches, media: query.media } as MediaQueryListEvent
      listeners.forEach((listener) => {
        listener(event)
      })
    },
  }
}

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.body.style.cssText = ''
  document.body.removeAttribute('data-dsh-deepseek-workshop')
  document.body.removeAttribute('data-ds-dark-theme')
  document.head.querySelectorAll('link[data-deepseek-workshop-icon]').forEach((node) => {
    node.remove()
  })
  document.title = ''
})

describe('DeepSeek cloud paper skin', () => {
  it('mounts the paper backdrop, favicon, and title without an in-page mascot', async () => {
    installMatchMedia(true)
    document.title = 'DeepSeek Harness'
    fiber = await mount()

    expect(document.body.hasAttribute('data-dsh-deepseek-workshop')).toBe(true)
    expect(document.body.querySelectorAll('[data-skin-chrome="mascot"]')).toHaveLength(0)
    expect(document.body.style.getPropertyValue('background-image')).toContain('linear-gradient')
    expect(document.head.querySelector('link[data-deepseek-workshop-icon]')).not.toBeNull()
    expect(document.title).toBe('DeepSeek 云鲸纸面')
  })

  it('keeps the native window title and icon untouched inside the Desktop shell', async () => {
    installMatchMedia(true)
    vi.stubGlobal('dshDesktopBoot', {
      ready: () => Promise.resolve({ injections: [], streamBaseUrl: 'http://127.0.0.1:19387' }),
    })
    document.title = 'DeepSeek Harness'
    fiber = await mount()

    expect(document.body.hasAttribute('data-dsh-deepseek-workshop')).toBe(true)
    expect(document.head.querySelector('link[data-deepseek-workshop-icon]')).toBeNull()
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('switches the backdrop theme without duplicating DOM', async () => {
    installMatchMedia(true)
    fiber = await mount()
    const light = document.body.style.getPropertyValue('background-image')

    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()

    expect(document.body.style.getPropertyValue('background-image')).not.toBe(light)
  })

  it('mounts the illustrated background and retractable semantic frames in both modes', async () => {
    installMatchMedia(true)
    document.body.innerHTML = `
      <nav role="tree"><button role="treeitem" aria-selected="true">Chat</button></nav>
      <main>
        <textarea aria-label="Message"></textarea>
        <section><h2>Workspace</h2></section>
      </main>
      <section role="dialog"><button type="submit">Save</button></section>
      <div role="menu"><button role="menuitem">Open</button></div>
    `
    fiber = await mount()

    expect(document.querySelectorAll('[data-dsh-frame]')).toHaveLength(6)
    const lightBackdrop = document.body.style.getPropertyValue('background-image')
    const lightDialog = document.body.style.getPropertyValue('--dsw-frame-dialog')
    const lightMessage = document.body.style.getPropertyValue('--dsw-frame-message')
    expect(lightBackdrop).toContain('data:image/webp;base64,')
    expect(lightBackdrop).toContain('rgba(255, 254, 249, 0.6)')
    expect(document.body.style.getPropertyValue('background-position')).toBe(
      'center center, center center, center center, center center, center center',
    )
    expect(lightDialog).toContain('data:image/webp;base64,')
    expect(lightMessage).toContain('data:image/webp;base64,')

    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()
    expect(document.body.style.getPropertyValue('background-image')).toContain('rgba(18, 31, 47, 0.52)')
    expect(document.body.style.getPropertyValue('--dsw-frame-dialog')).not.toBe(lightDialog)
    expect(document.body.style.getPropertyValue('--dsw-frame-message')).not.toBe(lightMessage)
    expect(document.querySelectorAll('[data-dsh-frame]')).toHaveLength(6)

    await fiber.dispose()
    fiber = undefined
    expect(document.querySelector('[data-dsh-frame]')).toBeNull()
    expect(document.body.style.getPropertyValue('--dsw-frame-dialog')).toBe('')
    expect(document.body.style.getPropertyValue('--dsw-frame-message')).toBe('')
    expect(document.body.style.getPropertyValue('background-image')).toBe('')
  })

  it('mounts a pet quick toggle that flips the companion enabled flag live', async () => {
    installMatchMedia(true)
    const patches: string[] = []
    let enabled = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === 'PATCH') {
          patches.push(init.body ?? '')
          enabled = (JSON.parse(init.body ?? '{}') as { enabled: boolean }).enabled
        }
        return { ok: true, json: async () => ({ enabled }) } as Response
      }),
    )
    try {
      fiber = await mount()
      const toggle = document.body.querySelector<HTMLButtonElement>('[data-skin-chrome="pet-toggle"]')
      expect(toggle).not.toBeNull()
      expect(toggle?.getAttribute('aria-pressed')).toBe('true')

      toggle?.click()
      await tick()
      expect(patches).toEqual([JSON.stringify({ enabled: false })])
      expect(toggle?.getAttribute('aria-pressed')).toBe('false')
      expect(toggle?.dataset.petOn).toBe('off')

      await fiber.dispose()
      fiber = undefined
      expect(document.body.querySelector('[data-skin-chrome="pet-toggle"]')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('never mounts an in-page mascot and survives viewport query changes', async () => {
    const media = installMatchMedia(false)
    fiber = await mount()
    expect(document.body.querySelector('[data-skin-chrome="mascot"]')).toBeNull()

    media.set(true)
    expect(document.body.querySelector('[data-skin-chrome="mascot"]')).toBeNull()
    media.set(false)
    expect(document.body.querySelector('[data-skin-chrome="mascot"]')).toBeNull()
  })

  it('integrates one light-dark ornament layer', async () => {
    installMatchMedia(true)
    document.body.innerHTML = `
      <nav role="tree"><button role="treeitem" aria-selected="true">Chat</button></nav>
      <main><h1>DeepSeek Harness</h1><textarea></textarea></main>
    `
    fiber = await mount()
    const lightBow = document.body.querySelector<HTMLImageElement>('[data-dsh-ornament="bow"]')?.src

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('blur'))
    expect(document.querySelectorAll('[data-skin-chrome="ornaments"]')).toHaveLength(1)

    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()
    expect(document.body.querySelector<HTMLImageElement>('[data-dsh-ornament="bow"]')?.src).not.toBe(lightBow)
  })

  it('mounts the ocean art on the full sidebar surface and retracts it', async () => {
    installMatchMedia(true)
    document.body.innerHTML = `
      <div data-test-frame>
        <aside data-test-sidebar>
          <div><nav role="tree"><button role="treeitem">Chat</button></nav></div>
        </aside>
        <main>Conversation</main>
      </div>
    `
    const tree = document.querySelector<HTMLElement>('[role="tree"]')!
    const treeWrapper = tree.parentElement!
    const sidebar = document.querySelector<HTMLElement>('[data-test-sidebar]')!
    const frame = document.querySelector<HTMLElement>('[data-test-frame]')!
    tree.getBoundingClientRect = vi.fn(() => ({
      x: 10,
      y: 160,
      left: 10,
      top: 160,
      right: 280,
      bottom: 850,
      width: 270,
      height: 690,
      toJSON: () => ({}),
    }))
    treeWrapper.getBoundingClientRect = vi.fn(() => ({
      x: 10,
      y: 120,
      left: 10,
      top: 120,
      right: 280,
      bottom: 850,
      width: 270,
      height: 730,
      toJSON: () => ({}),
    }))
    sidebar.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 280,
      bottom: 900,
      width: 280,
      height: 900,
      toJSON: () => ({}),
    }))
    frame.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1440,
      bottom: 900,
      width: 1440,
      height: 900,
      toJSON: () => ({}),
    }))

    fiber = await mount()

    expect(sidebar.hasAttribute('data-dsh-sidebar-surface')).toBe(true)
    expect(sidebar.style.getPropertyValue('--dsw-sidebar-ocean-background')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('background-image')).not.toContain('SIDEBAR_OCEAN_BACKGROUND')

    await fiber.dispose()
    fiber = undefined
    expect(sidebar.hasAttribute('data-dsh-sidebar-surface')).toBe(false)
    expect(sidebar.style.getPropertyValue('--dsw-sidebar-ocean-background')).toBe('')
  })

  it('restores prior writes and removes every owned resource', async () => {
    installMatchMedia(true)
    document.title = 'DeepSeek Harness'
    document.body.style.setProperty('background-image', 'url("https://example.test/prior.png")')
    document.body.style.setProperty('background-attachment', 'scroll')
    fiber = await mount()

    await fiber.dispose()
    fiber = undefined
    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()

    expect(document.body.hasAttribute('data-dsh-deepseek-workshop')).toBe(false)
    expect(document.body.querySelector('[data-skin-chrome="mascot"]')).toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="ornaments"]')).toBeNull()
    expect(document.head.querySelector('link[data-deepseek-workshop-icon]')).toBeNull()
    expect(document.body.style.getPropertyValue('background-image')).toContain('prior.png')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('scroll')
    expect(document.title).toBe('DeepSeek Harness')
  })
})

describe('DeepSeek cloud paper stylesheet', () => {
  const stylesheet = readFileSync(resolve(process.cwd(), 'src/client/deepseek-workshop.module.css'), 'utf8')

  it('uses the shell as the visible boundary of the composer editor', () => {
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='composer-shell'\] \[data-composer-input\][^{]*\{[^}]*border-color: transparent !important[^}]*background-color: transparent/,
    )
  })

  it('defines the light and dusk-paper token surfaces', () => {
    expect(stylesheet).toContain('body[data-dsh-deepseek-workshop] {')
    expect(stylesheet).toContain('--dsw-alias-bg-base: rgba(251, 250, 245, 0.28)')
    expect(stylesheet).toContain('--dsw-alias-bg-layer-1: rgba(247, 249, 246, 0.97)')
    expect(stylesheet).toContain('body[data-dsh-deepseek-workshop][data-ds-dark-theme]')
    expect(stylesheet).toContain('--dsw-alias-bg-base: rgba(23, 36, 53, 0.34)')
    expect(stylesheet).toContain('--dsw-alias-bg-layer-1: rgba(28, 45, 66, 0.98)')
  })

  it('keeps the generated ornament layer responsive', () => {
    expect(stylesheet).not.toContain('.mascot')
    expect(stylesheet).toContain('.ornamentLayer')
    expect(stylesheet).toContain('.ornamentBow')
    expect(stylesheet).toContain('.ornamentWhaleTail')
    expect(stylesheet).toContain('.ornamentApronCrest')
    expect(stylesheet).toContain('.ornamentHairWave')
    expect(stylesheet).toContain('.ornamentBubbles')
    expect(stylesheet).toContain('.ornamentHeadbandCorner')
    expect(stylesheet).toContain('.ornamentRibbonTab')
    expect(stylesheet).toContain('@media (max-width: 959px), print')
  })

  it('polishes semantic DSH components without CSS-drawn character ornaments', () => {
    expect(stylesheet).toContain("body[data-dsh-deepseek-workshop] [role='dialog']")
    expect(stylesheet).toContain("body[data-dsh-deepseek-workshop] [role='treeitem'][aria-selected='true']")
    expect(stylesheet).toContain("body[data-dsh-deepseek-workshop] [role='menu']")
    expect(stylesheet).toContain('body[data-dsh-deepseek-workshop] button')
    expect(stylesheet).toContain(
      "body[data-dsh-deepseek-workshop] :is(textarea, [contenteditable='true'], input:not([type]))",
    )
    expect(stylesheet).not.toContain('@keyframes deepseekCloudPaperFloat')
    expect(stylesheet).not.toContain('.cloud')
    expect(stylesheet).not.toContain('clip-path')
    expect(stylesheet).not.toContain('repeating-linear-gradient')
  })

  it('shows settings navigation hover feedback without a transition', () => {
    expect(stylesheet).toMatch(/\[role='dialog'\]\[data-dsh-frame='dialog'\] > nav button\s*\{[^}]*transition: none/)
    expect(stylesheet).toMatch(
      /\[role='dialog'\]\[data-dsh-frame='dialog'\] > nav button:hover:not\(:disabled\)\s*\{[^}]*transform: none/,
    )
  })

  it('uses the shared redrawn nine-slice frame with responsive and printable fallbacks', () => {
    for (const frame of [
      'selected-nav',
      'composer',
      'composer-shell',
      'dialog',
      'menu',
      'panel',
      'primary-button',
      'control',
      'surface',
      'message',
    ]) {
      expect(stylesheet).toContain(`[data-dsh-frame='${frame}']`)
    }
    expect(stylesheet).toContain("[data-dsh-message-role='user']")
    expect(stylesheet).toContain("[data-dsh-message-role='assistant']")
    expect(stylesheet).toContain('border-image-source: var(--dsw-frame-selected-nav)')
    expect(stylesheet).toContain('border-image-slice: 70 95 70 110 fill')
    expect(stylesheet).not.toContain('border-image-slice: 90 120 90 120 fill')
    expect(stylesheet).not.toContain('border-image-slice: 80 120 90 120 fill')
    expect(stylesheet).not.toContain('border-image-slice: 55 120 55 120 fill')
    expect(stylesheet).toContain('left: calc(var(--dsw-x) + var(--dsw-w) - 13px)')
    expect(stylesheet).toContain('transform: rotate(5deg) scaleX(-1)')
    expect(stylesheet).toContain('top: calc(var(--dsw-y) - 11px)')
    expect(stylesheet).toContain('left: calc(var(--dsw-x) + var(--dsw-w) + 7px)')
    expect(stylesheet).toContain('width: 48px')
    expect(stylesheet).toContain('height: 43px')
    expect(stylesheet).toContain('left: calc(var(--dsw-x) + var(--dsw-w) - 2px)')
    expect(stylesheet).toMatch(
      /background-position:\s*center,\s*calc\(50% \+ 80px\) center,\s*center,\s*center,\s*center\s*!important/,
    )
    expect(stylesheet).toContain('background-image: none !important')
  })

  it('renders non-message frame corners at visible, source-proportional sizes', () => {
    const frameWidths = {
      'selected-nav': '21px 28.5px 21px 33px',
      'composer-shell': '31.5px 42.75px 31.5px 49.5px',
      dialog: '28px 38px 28px 44px',
      menu: '21px 28.5px 21px 33px',
      panel: '28px 38px 28px 44px',
      'primary-button': '21px 28.5px 21px 33px',
      control: '14px 19px 14px 22px',
      surface: '21px 28.5px 21px 33px',
    }

    expect(stylesheet).toMatch(
      /\[data-dsh-frame\][^{]*\{[^}]*border-image-slice: 70 95 70 110 fill[^}]*border-image-width: 28px 38px 28px 44px/,
    )
    for (const [frame, width] of Object.entries(frameWidths)) {
      expect(stylesheet).toMatch(new RegExp(`\\[data-dsh-frame='${frame}'\\][\\s\\S]*?border-image-width: ${width}`))
    }

    expect(stylesheet).not.toContain('border: 1px solid')
    expect(stylesheet).toContain('border: 2px solid')
    expect(stylesheet).toMatch(
      /@media \(max-width: 959px\)[\s\S]*?\[data-dsh-frame\][\s\S]*?border-image-width: 14px 19px 14px 22px/,
    )
    expect(stylesheet).toMatch(/\[data-dsh-frame='message'\][^{]*\{[^}]*border-image-width: 30px/)
  })

  it('keeps compact conversation chrome proportional without changing the plain composer field', () => {
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='composer-shell'\][\s\S]*?border-width: 1px;[\s\S]*?border-image-width: 31.5px 42.75px 31.5px 49.5px/,
    )
    expect(stylesheet).toMatch(
      /\[data-slot='conversation\.session\.header'\] > \[data-dsh-frame='surface'\][\s\S]*?border-width: 1px;[\s\S]*?border-image-width: 14px 19px 14px 22px/,
    )
  })

  it('keeps the responsive composer frame larger than the conversation header', () => {
    expect(stylesheet).toMatch(
      /@media \(max-width: 959px\)[\s\S]*?\[data-dsh-frame='composer-shell'\]\s*\{[^}]*border-width: 1px[^}]*border-image-width: 17.5px 23.75px 17.5px 27.5px/,
    )
    expect(stylesheet).toMatch(
      /@media \(max-width: 959px\)[\s\S]*?\[data-slot='conversation\.session\.header'\]\s*>\s*\[data-dsh-frame='surface'\]\s*\{[^}]*border-width: 1px[^}]*border-image-width: 14px 19px 14px 22px/,
    )
    expect(stylesheet).not.toMatch(
      /:is\(\[data-dsh-frame='composer-shell'\], \[data-slot='conversation\.session\.header'\] > \[data-dsh-frame='surface'\]\)/,
    )
  })

  it('keeps settings frame artwork tight to its host boundaries', () => {
    expect(stylesheet).toMatch(
      /\[data-slot='sidebar\.settings'\]\s+\[role='dialog'\]\[data-dsh-frame='dialog'\][^{]*\{[^}]*border-image-outset: 12px 8px 12px 9px/,
    )
    expect(stylesheet).toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-frame='surface'\][^{]*\{[^}]*border-image-outset: 7px 4px 7px 5px/,
    )
    expect(stylesheet).toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-frame='control'\][^{]*\{[^}]*border-image-outset: 5px 3px 5px 3px/,
    )
    expect(stylesheet).not.toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-frame\]:not\(\[data-dsh-frame='dialog'\]\)/,
    )
  })

  it('keeps settings control artwork with spaced rows and content-sized controls', () => {
    expect(stylesheet).toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-control-row\][^{]*\{[^}]*gap: 16px !important[^}]*padding-inline: 10px !important/,
    )
    expect(stylesheet).toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-control-row\] > \[data-dsh-frame='control'\][^{]*\{[^}]*flex-basis: auto !important[^}]*min-width: min-content !important/,
    )
    expect(stylesheet).not.toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-frame='control'\][^{]*\{[^}]*margin-inline/,
    )
    expect(stylesheet).not.toMatch(/\[data-dsh-control-row\][^{]*\{[^}]*flex-basis: 0 !important/)
    expect(stylesheet).not.toMatch(/\[data-dsh-frame='control'\][^{]*\{[^}]*white-space: nowrap !important/)
  })

  it('keeps text clear of decorative frame artwork', () => {
    expect(stylesheet).toMatch(
      /:is\(textarea, \[contenteditable='true'\], input:not\(\[type\]\)\)\[data-dsh-frame='composer'\][^{]*\{[^}]*border-width: 1px[^}]*border-radius: 18px[^}]*border-image-source: none[^}]*box-shadow: none/,
    )
    expect(stylesheet).toMatch(
      /:is\(textarea, \[contenteditable='true'\], input:not\(\[type\]\)\)\[data-dsh-frame='composer'\]:focus[^{]*\{[^}]*border-color: var\(--dsw-alias-border-l2\)[^}]*box-shadow: none[^}]*transform: none/,
    )
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='composer-shell'\][^{]*\{[^}]*border-image-source: var\(--dsw-frame-composer\)[^}]*border-image-width: 31.5px 42.75px 31.5px 49.5px[^}]*border-image-outset: 10px 7px 10px 8px/,
    )
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='panel'\][^{]*\{[^}]*padding-block: 14px !important[^}]*padding-inline: 24px !important/,
    )
    expect(stylesheet).toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-frame='surface'\] > :first-child[^}]*\{[^}]*padding-inline-start: 16px !important/,
    )
    expect(stylesheet).toMatch(
      /\[data-slot='sidebar\.settings'\] \[data-dsh-frame='surface'\]:has\(> span > button\)[^{]*\{[^}]*padding-inline-end: 16px !important/,
    )
  })

  it('aligns message artwork to the message border box without a second inset outline', () => {
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='message'\][^{]*\{[^}]*border-image-source: var\(--dsw-frame-message\)[^}]*border-image-slice: 70 95 70 110 fill[^}]*border-image-width: 30px[^}]*border-image-outset: 12px 7px 12px 8px/,
    )
    expect(stylesheet).toMatch(
      /@media \(max-width: 959px\)[\s\S]*?\[data-dsh-frame='message'\][^{]*\{[^}]*border-image-width: 20px[^}]*border-image-outset: 8px 4px 8px 5px/,
    )
    expect(stylesheet).not.toMatch(
      /\[data-dsh-frame='message'\]\[data-dsh-message-role='(?:user|assistant)'\][^{]*\{[^}]*inset 0 0 0 2px/,
    )
  })

  it('calibrates frame outset to the normalized artwork rectangle without legacy compensation', () => {
    expect(stylesheet).toMatch(
      /\[data-dsh-frame\][^{]*\{[^}]*border-image-width: 28px 38px 28px 44px[^}]*border-image-outset: 8px 4px 8px 5px/,
    )
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='dialog'\][^{]*\{[^}]*border-image-width: 28px 38px 28px 44px[^}]*border-image-outset: 9px 5px 9px 6px/,
    )
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='panel'\][^{]*\{[^}]*border-image-width: 28px 38px 28px 44px[^}]*border-image-outset: 9px 5px 9px 6px/,
    )
    expect(stylesheet).toMatch(/\[data-dsh-frame='surface'\][^{]*\{[^}]*border-image-outset: 6px 3px 6px 4px/)
    expect(stylesheet).toMatch(/\[data-dsh-frame='control'\][^{]*\{[^}]*border-image-outset: 4px 2px 4px 2px/)
    expect(stylesheet).not.toContain('inset 2px 0 0')
    expect(stylesheet).not.toContain('4px 5px 0')
  })

  it('layers the generated ocean art only on the discovered sidebar surface', () => {
    expect(stylesheet).toContain('[data-dsh-sidebar-surface]')
    expect(stylesheet).toContain('var(--dsw-sidebar-ocean-background)')
    expect(stylesheet).toContain('center bottom')
    expect(stylesheet).toContain('[data-ds-dark-theme] [data-dsh-sidebar-surface]')
    expect(stylesheet).toContain('--dsw-specific-sidebar-fill: rgba(246, 249, 247, 0.36)')
    expect(stylesheet).toContain('--dsw-specific-sidebar-fill: rgba(28, 45, 66, 0.48)')
    expect(stylesheet).toContain('--dsw-specific-sidebar-nav-item-active: #e1f0f3')
    expect(stylesheet).toContain('--dsw-specific-sidebar-nav-item-active: #2b465f')
  })

  it('keeps slash commands readable in the composer', () => {
    expect(stylesheet).toMatch(
      /\[data-input-scroll\]:has\(\[data-dsh-frame='composer'\]\) \[data-input-backdrop\][\s\S]*?color: var\(--dsw-alias-label-primary\) !important/,
    )
    expect(stylesheet).toMatch(
      /\[data-dsh-frame='composer'\]::placeholder[\s\S]*?color: var\(--dsw-alias-label-primary\) !important/,
    )
    expect(stylesheet).toMatch(
      /:is\(textarea, \[contenteditable='true'\], input:not\(\[type\]\)\)\[data-dsh-frame='composer'\][^{]*\{[^}]*color: var\(--dsw-alias-label-primary\) !important[^}]*-webkit-text-fill-color: var\(--dsw-alias-label-primary\) !important/,
    )
    expect(stylesheet).toMatch(/\[data-dsh-frame='composer'\] \*:not\(\[class\*='_hlToken'\]\)/)
    expect(stylesheet).toMatch(/\[data-input-backdrop\]\s+\*:not\(\[class\*='_hlToken'\]\)/)
    expect(stylesheet).toMatch(
      /:is\(\[data-input-backdrop\], \[data-dsh-frame='composer'\]\) \[class\*='_hlToken'\]\s*\{[^}]*color: var\(--dsw-specific-command-token\) !important[^}]*-webkit-text-fill-color: var\(--dsw-specific-command-token\) !important/,
    )
    expect(stylesheet).toContain('--dsw-specific-command-token: #3aaef0')
    expect(stylesheet).toContain('--dsw-specific-command-token: #7cc8f2')
  })

  it('keeps the composer transparent over its mirrored input backdrop', () => {
    expect(stylesheet).toMatch(
      /\[data-input-scroll\]:has\(\[data-input-backdrop\]\)\s+:is\(textarea, input:not\(\[type\]\)\)\[data-dsh-frame='composer'\][^{]*\{[^}]*background-color: transparent !important[^}]*color: transparent !important[^}]*-webkit-text-fill-color: transparent !important[^}]*caret-color: var\(--dsw-alias-label-primary\) !important/,
    )
    expect(stylesheet).toMatch(
      /\[data-input-scroll\]:has\(\[data-input-backdrop\]\)\s+\[data-dsh-frame='composer-shell'\]:not\(:has\(\[data-input-backdrop\]\)\)[^{]*\{[^}]*background-color: transparent !important[^}]*border-image-slice: 70 95 70 110;/,
    )
  })
})

describe('app shell translucency', () => {
  it('keeps the full-viewport app frame translucent so the backdrop shows', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'src/client/deepseek-workshop.module.css'), 'utf8')
    expect(stylesheet).toMatch(/\[class\$='_frame'\][^{]*\{[^}]*background-color: var\(--dsw-specific-app-shell\)/)
    expect(stylesheet).toContain('--dsw-specific-app-shell: rgba(255, 254, 249, 0.2)')
    expect(stylesheet).toContain('--dsw-specific-app-shell: rgba(23, 36, 53, 0.2)')
  })
})
