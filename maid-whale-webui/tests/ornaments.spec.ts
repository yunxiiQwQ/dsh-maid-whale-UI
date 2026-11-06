// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrnamentController, type OrnamentController } from '../src/client/ornaments.ts'

let controller: OrnamentController | undefined

function fixture(): HTMLTextAreaElement {
  document.body.innerHTML = `
    <nav role="tree">
      <button role="treeitem" aria-selected="true">Chat</button>
    </nav>
    <main>
      <h1>DeepSeek Harness</h1>
      <textarea aria-label="Message"></textarea>
    </main>
  `
  return document.querySelector('textarea')!
}

async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 40)
  })
}

afterEach(() => {
  controller?.dispose()
  controller = undefined
  document.body.innerHTML = ''
})

describe('ornament controller', () => {
  it('syncs idempotently, reacts to semantic targets, and disposes owned DOM', async () => {
    const input = fixture()
    controller = createOrnamentController(document.body, { wide: true })

    controller.sync()
    expect(document.querySelectorAll('img[data-dsh-ornament]')).toHaveLength(4)
    expect(document.querySelector('[data-dsh-ornament="bubbles"]')).not.toBeNull()
    expect(document.querySelectorAll('img[data-dsh-ornament][aria-hidden="true"]')).toHaveLength(4)

    controller.sync()
    expect(document.querySelectorAll('img[data-dsh-ornament]')).toHaveLength(4)

    input.focus()
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await tick()
    expect(document.querySelector('[data-dsh-ornament="bubbles"]')).toBeNull()
    expect(document.querySelector('[data-dsh-ornament="ribbonTab"]')).not.toBeNull()

    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    await tick()
    expect(document.querySelector('[data-dsh-ornament="apronCrest"]')).not.toBeNull()
    expect(document.querySelectorAll('img[data-dsh-ornament]')).toHaveLength(4)

    const before = document.querySelector<HTMLImageElement>('[data-dsh-ornament="bow"]')!.src
    controller.setMode('dark')
    expect(document.querySelector<HTMLImageElement>('[data-dsh-ornament="bow"]')!.src).not.toBe(before)

    controller.dispose()
    controller = undefined
    expect(document.querySelector('[data-skin-chrome="ornaments"]')).toBeNull()
    expect(document.querySelector('[data-dsh-ornament-target]')).toBeNull()
  })

  it('keeps only the narrow-screen ornament pair', () => {
    fixture()
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    controller = createOrnamentController(document.body, { wide: true })
    controller.sync()

    controller.setWide(false)

    expect(
      Array.from(
        document.querySelectorAll<HTMLImageElement>('img[data-dsh-ornament]'),
        (image) => image.dataset.dshOrnament,
      ),
    ).toEqual(['whaleTail', 'bow', 'headbandCorner'])
  })

  it('anchors the whale tail to the workspace label immediately before the tree area', () => {
    document.body.innerHTML = `
      <section>
        <header><span id="workspace-label">工作区</span></header>
        <div><div><div role="tree"><button role="treeitem">Chat</button></div></div></div>
      </section>
      <textarea aria-label="Message"></textarea>
    `
    controller = createOrnamentController(document.body, { wide: true })

    controller.sync()

    expect(document.querySelector('#workspace-label')?.getAttribute('data-dsh-ornament-target')).toBe('whaleTail')
    expect(document.querySelector('[role="tree"]')?.hasAttribute('data-dsh-ornament-target')).toBe(false)
  })

  it('removes sidebar ornaments when the sidebar hides and restores them when it opens', async () => {
    fixture()
    const sidebar = document.querySelector<HTMLElement>('[role="tree"]')!
    const sidebarOrnaments = () =>
      document.querySelectorAll('[data-dsh-ornament="whaleTail"], [data-dsh-ornament="bow"]')
    controller = createOrnamentController(document.body, { wide: true })
    controller.sync()
    expect(sidebarOrnaments()).toHaveLength(2)

    sidebar.style.display = 'none'
    await tick()
    expect(sidebarOrnaments()).toHaveLength(0)

    sidebar.style.removeProperty('display')
    await tick()
    expect(sidebarOrnaments()).toHaveLength(2)

    sidebar.remove()
    await tick()
    expect(sidebarOrnaments()).toHaveLength(0)
  })

  it('does not decorate a dialog that has transitioned out of view', () => {
    fixture()
    const fadingShell = document.createElement('div')
    fadingShell.style.opacity = '0.001'
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    fadingShell.append(dialog)
    document.body.append(fadingShell)
    controller = createOrnamentController(document.body, { wide: false })

    controller.sync()

    expect(
      Array.from(
        document.querySelectorAll<HTMLImageElement>('img[data-dsh-ornament]'),
        (image) => image.dataset.dshOrnament,
      ),
    ).toEqual(['whaleTail', 'bow'])
  })

  it('does not rescan the full tree for streamed text-only mutations', async () => {
    fixture()
    controller = createOrnamentController(document.body, { wide: true })
    await tick()
    const compute = vi.spyOn(window, 'getComputedStyle')

    document.querySelector('main')!.append(document.createTextNode('streamed response chunk'))
    await tick()

    expect(compute).not.toHaveBeenCalled()
    compute.mockRestore()
  })

  it('anchors the composer ornaments to the host field, never a plugin search box', () => {
    const input = fixture()
    const style = document.createElement('style')
    style.dataset.pluginCss = '@dsh-external/dsh-client-plugin-market/Market.module.css'
    style.textContent = '.market_root{display:block}'
    document.head.append(style)
    const pluginRoot = document.createElement('div')
    pluginRoot.className = 'market_root'
    const search = document.createElement('input')
    search.placeholder = '搜索插件...'
    pluginRoot.append(search)
    document.querySelector('main')!.before(pluginRoot)

    controller = createOrnamentController(document.body, { wide: true })
    controller.sync()

    expect(search.hasAttribute('data-dsh-ornament-target')).toBe(false)
    expect(input.getAttribute('data-dsh-ornament-target')).toBe('bubbles')

    style.remove()
  })
})
