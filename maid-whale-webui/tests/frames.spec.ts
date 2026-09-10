// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFrameController, type FrameController } from '../src/client/frames.ts'

let controller: FrameController | undefined

function fixture(): { dialog: HTMLElement; firstPanel: HTMLElement; secondPanel: HTMLElement } {
  document.body.innerHTML = `
    <nav role="tree"><button role="treeitem" aria-selected="true">Chat</button></nav>
    <main>
      <textarea aria-label="Message"></textarea>
      <section data-panel><h2>Workspace</h2></section>
      <section data-panel><h2>Activity</h2></section>
    </main>
    <section role="dialog"><button type="submit">Save</button></section>
    <div role="menu"><button role="menuitem">Open</button></div>
  `
  return {
    dialog: document.querySelector('[role="dialog"]')!,
    firstPanel: document.querySelectorAll<HTMLElement>('main > section')[0],
    secondPanel: document.querySelectorAll<HTMLElement>('main > section')[1],
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 40)
  })
}

function mountConversationCssModules(): void {
  const modules = [
    ['@deepseek-ai/dsh-client-ui-conversation/MessageItem.module.css', '.message_bubble{background:blue}'],
    [
      '@deepseek-ai/dsh-client-ui-conversation/AssistantMarkdown.module.css',
      '.assistant_root{display:flex}.assistant_body{display:flex}',
    ],
    ['@deepseek-ai/dsh-client-ui-conversation/ReasoningRow.module.css', '.reasoning_root{display:flex}'],
  ] as const
  for (const [id, css] of modules) {
    const style = document.createElement('style')
    style.dataset.pluginCss = id
    style.textContent = css
    document.head.append(style)
  }
}

/* Host chrome stylesheet: DSH-authored UI classes live under the
   dsh-client-ui scope and never count as plugin-authored. */
function mountNativeChromeCss(): HTMLElement {
  const style = document.createElement('style')
  style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-settings/Settings.module.css'
  style.textContent = '.settings_root{display:block}.settings_button{display:inline-block}'
  document.head.append(style)
  const host = document.createElement('div')
  host.className = 'settings_root'
  document.body.append(host)
  return host
}

/* Third-party plugin stylesheet: every class it declares marks a
   plugin-authored subtree that must keep its native borders. */
function mountForeignPluginCss(): HTMLElement {
  const style = document.createElement('style')
  style.dataset.pluginCss = '@dsh-external/dsh-client-plugin-market/Market.module.css'
  style.textContent = '.market_root{display:block}'
  document.head.append(style)
  const root = document.createElement('div')
  root.className = 'market_root'
  document.body.append(root)
  return root
}

afterEach(() => {
  controller?.dispose()
  controller = undefined
  document.body.innerHTML = ''
  document.body.style.cssText = ''
  document.head.querySelectorAll('style[data-plugin-css]').forEach((style) => {
    style.remove()
  })
})

describe('frame controller', () => {
  it('keeps only the outer frame in model custom settings', () => {
    const style = document.createElement('style')
    style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-settings-models/ModelsSection.module.css'
    style.textContent = '.models_customized{border-top:1px solid gray}'
    document.head.append(style)
    document.body.innerHTML = `
      <details open class="models_customized" data-dsh-frame="surface">
        <summary>自定义设置</summary>
        <input type="text" style="border:1px solid gray" data-dsh-frame="control">
        <section style="border:1px solid gray" data-dsh-frame="surface"><button type="submit">添加模型</button></section>
      </details>
      <button type="submit">Save</button>
    `
    controller = createFrameController(document.body)
    controller.sync()
    expect(document.querySelector('details')?.getAttribute('data-dsh-frame')).toBe('surface')
    expect(document.querySelector('details [data-dsh-frame]')).toBeNull()
    expect(document.querySelector('body > button')?.getAttribute('data-dsh-frame')).toBe('primary-button')
  })

  it('frames the native language row and selector', () => {
    const style = document.createElement('style')
    style.dataset.pluginCss = '@deepseek-ai/dsh-client-locale/LanguageRow.module.css'
    style.textContent = '.locale_row{border-bottom:1px solid gray}.locale_selector{border:none}'
    document.head.append(style)
    document.body.innerHTML = '<div class="locale_row">语言<button class="locale_selector">中文</button></div>'
    controller = createFrameController(document.body)
    expect(document.querySelector('.locale_row')?.getAttribute('data-dsh-frame')).toBe('surface')
    expect(document.querySelector('button')?.getAttribute('data-dsh-frame')).toBe('control')
  })

  it('frames the borderless InputBar card across repeated scans', () => {
    const style = document.createElement('style')
    style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-conversation/InputBar.module.css'
    style.textContent = '.input_card{border:0}.input_scroll{border:0}'
    document.head.append(style)
    document.body.innerHTML =
      '<div class="input_card"><div class="input_scroll"><div contenteditable="true"></div></div><button>Send</button></div>'
    controller = createFrameController(document.body)
    controller.sync()
    expect(document.querySelector('.input_card')?.getAttribute('data-dsh-frame')).toBe('composer-shell')
    expect(document.querySelector('.input_scroll')?.hasAttribute('data-dsh-frame')).toBe(false)
  })

  it('frames conversation code blocks while preserving foreign plugin code blocks', () => {
    document.body.innerHTML =
      '<div data-slot="conversation.view"><div class="md-code-block"><pre><code>npx astro preview status</code></pre></div></div>'
    const foreign = mountForeignPluginCss()
    foreign.innerHTML = '<div data-slot="conversation.view"><div class="md-code-block"><pre>example</pre></div></div>'
    controller = createFrameController(document.body)
    expect(document.querySelector('.md-code-block')?.getAttribute('data-dsh-frame')).toBe('panel')
    expect(foreign.querySelector('[data-dsh-frame]')).toBeNull()
  })

  it('keeps trajectory cells and controls unframed and removes existing decorations', () => {
    const style = document.createElement('style')
    style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-trajectory/views.module.css'
    style.textContent = '.trajectory_root{display:block}'
    document.head.append(style)
    document.body.innerHTML = `
      <div class="trajectory_root">
        <table><tbody><tr>
          <td style="border:1px solid gray" data-dsh-frame="surface">Assistant</td>
          <td style="border:1px solid gray">Message</td>
        </tr></tbody></table>
        <button type="submit" style="border:1px solid gray">Search</button>
      </div>
      <button type="submit">Send</button>
    `
    controller = createFrameController(document.body)
    controller.sync()
    expect(document.querySelector('.trajectory_root [data-dsh-frame]')).toBeNull()
    expect(document.querySelector('body > button')?.getAttribute('data-dsh-frame')).toBe('primary-button')
  })

  it('marks semantic targets idempotently and updates every frame resource by mode', () => {
    const { firstPanel, secondPanel } = fixture()
    controller = createFrameController(document.body)

    controller.sync()
    controller.sync()

    expect(document.querySelectorAll('[data-dsh-frame="selected-nav"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-dsh-frame="composer"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-dsh-frame="dialog"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-dsh-frame="menu"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-dsh-frame="panel"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-dsh-frame="primary-button"]')).toHaveLength(1)
    expect(firstPanel.dataset.dshFrame).toBe('panel')
    expect(secondPanel.dataset.dshFrame).toBe('panel')

    const lightDialog = document.body.style.getPropertyValue('--dsw-frame-dialog')
    const lightMessage = document.body.style.getPropertyValue('--dsw-frame-message')
    expect(lightDialog).toContain('data:image/webp;base64,')
    expect(lightMessage).toContain('data:image/webp;base64,')
    for (const property of [
      '--dsw-frame-selected-nav',
      '--dsw-frame-composer',
      '--dsw-frame-dialog',
      '--dsw-frame-menu',
      '--dsw-frame-panel',
      '--dsw-frame-primary-button',
    ]) {
      expect(document.body.style.getPropertyValue(property)).toBe(lightMessage)
    }
    controller.setMode('dark')
    expect(document.body.style.getPropertyValue('--dsw-frame-dialog')).not.toBe(lightDialog)
    expect(document.body.style.getPropertyValue('--dsw-frame-message')).not.toBe(lightMessage)
  })

  it('decorates bordered elements on the host UI and skips plugin subtrees', () => {
    fixture()
    mountNativeChromeCss()
    const pluginRoot = mountForeignPluginCss()
    const hostButton = document.createElement('button')
    hostButton.textContent = 'Secondary action'
    hostButton.style.border = '1px solid rgb(20, 30, 40)'
    const borderedSurface = document.createElement('article')
    borderedSurface.style.border = '2px solid rgb(20, 30, 40)'
    const borderlessButton = document.createElement('button')
    borderlessButton.textContent = 'Plain action'
    borderlessButton.style.border = '0 none transparent'
    document.body.append(hostButton, borderedSurface, borderlessButton)

    const pluginButton = document.createElement('button')
    pluginButton.textContent = 'Install'
    pluginButton.style.border = '1px solid rgb(20, 30, 40)'
    // A plugin page may reuse host-styled components; ancestry still wins.
    const reusedHostButton = document.createElement('button')
    reusedHostButton.textContent = 'Host-styled tab'
    reusedHostButton.className = 'settings_button'
    reusedHostButton.style.border = '1px solid rgb(20, 30, 40)'
    pluginRoot.append(pluginButton, reusedHostButton)

    controller = createFrameController(document.body)
    controller.sync()

    expect(hostButton.dataset.dshFrame).toBe('control')
    expect(borderedSurface.dataset.dshFrame).toBe('surface')
    expect(borderlessButton.hasAttribute('data-dsh-frame')).toBe(false)
    expect(pluginButton.hasAttribute('data-dsh-frame')).toBe(false)
    expect(reusedHostButton.hasAttribute('data-dsh-frame')).toBe(false)
  })

  it('marks rows holding two or more control frames so spacing rules can keep artwork apart', () => {
    fixture()
    const row = document.createElement('div')
    const first = document.createElement('button')
    first.textContent = 'Light'
    first.style.border = '1px solid rgb(20, 30, 40)'
    const second = document.createElement('button')
    second.textContent = 'Dark'
    second.style.border = '1px solid rgb(20, 30, 40)'
    row.append(first, second)
    const loneParent = document.createElement('div')
    const lone = document.createElement('button')
    lone.textContent = 'Solo'
    lone.style.border = '1px solid rgb(20, 30, 40)'
    loneParent.append(lone)
    document.body.append(row, loneParent)

    controller = createFrameController(document.body)
    controller.sync()

    expect(first.dataset.dshFrame).toBe('control')
    expect(second.dataset.dshFrame).toBe('control')
    expect(row.hasAttribute('data-dsh-control-row')).toBe(true)
    expect(lone.dataset.dshFrame).toBe('control')
    expect(loneParent.hasAttribute('data-dsh-control-row')).toBe(false)

    second.remove()
    controller.sync()
    expect(row.hasAttribute('data-dsh-control-row')).toBe(false)

    controller.dispose()
    controller = undefined
    expect(document.querySelector('[data-dsh-control-row]')).toBeNull()
  })

  it('reads each element style at most once per synchronization pass', () => {
    fixture()
    const shell = document.createElement('div')
    let current = shell
    for (let depth = 0; depth < 8; depth += 1) {
      const next = document.createElement('div')
      current.append(next)
      current = next
    }
    const bordered = document.createElement('button')
    bordered.textContent = 'Deep'
    bordered.style.border = '1px solid rgb(20, 30, 40)'
    current.append(bordered)
    document.body.append(shell)

    const compute = vi.spyOn(window, 'getComputedStyle')
    controller = createFrameController(document.body)
    compute.mockClear()
    controller.sync()

    expect(bordered.dataset.dshFrame).toBe('control')
    // The uncached walk would read one style per ancestor per element (the
    // depth-8 button alone costs 9); the pass memo must cap the whole scan at
    // one read per element plus the body root.
    expect(compute.mock.calls.length).toBeLessThanOrEqual(document.body.querySelectorAll('*').length + 1)
    compute.mockRestore()
  })

  it('does not rescan the full tree for streamed text-only mutations', async () => {
    fixture()
    controller = createFrameController(document.body)
    await tick()
    const compute = vi.spyOn(window, 'getComputedStyle')

    document.querySelector('main')!.append(document.createTextNode('streamed response chunk'))
    await tick()

    expect(compute).not.toHaveBeenCalled()
    compute.mockRestore()
  })

  it('does not frame bordered inline links inside conversation content', () => {
    fixture()
    const sourceLink = document.createElement('a')
    sourceLink.href = 'https://example.com/source'
    sourceLink.textContent = 'DeepSeek Open Sources'
    sourceLink.style.borderBottom = '1px solid currentColor'
    document.querySelector('main')!.append(sourceLink)

    controller = createFrameController(document.body)
    controller.sync()

    expect(sourceLink.hasAttribute('data-dsh-frame')).toBe(false)
  })

  it('leaves third-party plugin interfaces untouched regardless of their class names', () => {
    fixture()
    const market = mountForeignPluginCss()
    market.innerHTML = `
      <input placeholder="搜索插件...">
      <div>
        <button>全部</button>
        <button>UI 增强</button>
      </div>
      <article>
        <div>
          <button>详情</button>
          <button>安装</button>
        </div>
      </article>
    `
    market.querySelectorAll<HTMLElement>('input, div, article, button').forEach((target) => {
      target.style.border = '1px solid rgb(20, 30, 40)'
    })

    controller = createFrameController(document.body)
    controller.sync()

    expect(market.querySelectorAll('[data-dsh-frame]')).toHaveLength(0)
    expect(market.querySelectorAll('[data-dsh-control-row]')).toHaveLength(0)
  })

  it('never adopts plugin search fields as the composer', () => {
    fixture()
    const pluginRoot = mountForeignPluginCss()
    document.querySelector('main')!.before(pluginRoot)
    const search = document.createElement('input')
    search.placeholder = '搜索插件...'
    pluginRoot.append(search)

    controller = createFrameController(document.body)
    controller.sync()

    expect(search.hasAttribute('data-dsh-frame')).toBe(false)
    expect(document.querySelector('textarea')!.dataset.dshFrame).toBe('composer')
  })

  it('never frames the skin chrome injected by this plugin', () => {
    fixture()
    const chrome = document.createElement('button')
    chrome.dataset.skinChrome = 'pet-toggle'
    chrome.textContent = 'Skin toggle'
    chrome.style.border = '2px solid rgb(20, 30, 40)'
    document.body.append(chrome)

    controller = createFrameController(document.body)
    controller.sync()

    expect(chrome.hasAttribute('data-dsh-frame')).toBe(false)
  })

  it('promotes the nearest bordered composer ancestor to a dedicated shell frame', () => {
    fixture()
    const textarea = document.querySelector('textarea')!
    const shell = document.createElement('div')
    shell.style.border = '1px solid rgb(20, 30, 40)'
    textarea.replaceWith(shell)
    shell.append(textarea)

    controller = createFrameController(document.body)
    controller.sync()

    expect(textarea.dataset.dshFrame).toBe('composer')
    expect(shell.dataset.dshFrame).toBe('composer-shell')
  })

  it('frames sent messages and final assistant replies without framing reasoning-only rows', () => {
    fixture()
    mountConversationCssModules()
    const userMessage = document.createElement('div')
    userMessage.className = 'message_bubble'
    userMessage.textContent = 'Sent message'
    const assistantReply = document.createElement('div')
    assistantReply.className = 'assistant_root'
    assistantReply.innerHTML =
      '<div class="assistant_body"><div class="reasoning_root">Think before answering</div><article data-final-reply>Final reply</article></div>'
    const finalReply = assistantReply.querySelector<HTMLElement>('[data-final-reply]')!
    const reasoningOnly = document.createElement('div')
    reasoningOnly.className = 'assistant_root'
    reasoningOnly.innerHTML = '<div class="assistant_body"><div class="reasoning_root">Think</div></div>'
    document.querySelector('main')!.append(userMessage, assistantReply, reasoningOnly)

    controller = createFrameController(document.body)
    controller.sync()

    expect(userMessage.dataset.dshFrame).toBe('message')
    expect(userMessage.dataset.dshMessageRole).toBe('user')
    expect(assistantReply.hasAttribute('data-dsh-frame')).toBe(false)
    expect(finalReply.dataset.dshFrame).toBe('message')
    expect(finalReply.dataset.dshMessageRole).toBe('assistant')
    expect(assistantReply.querySelector('.reasoning_root')?.hasAttribute('data-dsh-frame')).toBe(false)
    expect(reasoningOnly.hasAttribute('data-dsh-frame')).toBe(false)
    expect(reasoningOnly.hasAttribute('data-dsh-message-role')).toBe(false)
  })

  it('keeps existing message markers stable across repeated synchronization', async () => {
    fixture()
    mountConversationCssModules()
    const assistantReply = document.createElement('div')
    assistantReply.className = 'assistant_root'
    assistantReply.innerHTML = '<div class="assistant_body"><article data-final-reply>Final reply</article></div>'
    const finalReply = assistantReply.querySelector<HTMLElement>('[data-final-reply]')!
    document.querySelector('main')!.append(assistantReply)
    controller = createFrameController(document.body)

    const changedAttributes: string[] = []
    const observer = new MutationObserver((records) => {
      changedAttributes.push(...records.flatMap((record) => record.attributeName ?? []))
    })
    observer.observe(finalReply, {
      attributes: true,
      attributeFilter: ['data-dsh-frame', 'data-dsh-message-role'],
    })

    controller.sync()
    controller.sync()
    await Promise.resolve()
    observer.disconnect()

    expect(finalReply.dataset.dshFrame).toBe('message')
    expect(finalReply.dataset.dshMessageRole).toBe('assistant')
    expect(changedAttributes).toEqual([])
  })

  it('ignores hidden targets, nested panels, and unnamed icon-only primary buttons', () => {
    fixture()
    const fadingShell = document.createElement('div')
    fadingShell.style.opacity = '0.001'
    const hiddenDialog = document.createElement('section')
    hiddenDialog.setAttribute('role', 'dialog')
    fadingShell.append(hiddenDialog)
    document.body.append(fadingShell)

    const outer = document.createElement('section')
    outer.dataset.settingsSection = ''
    const inner = document.createElement('section')
    inner.dataset.settingsSection = ''
    outer.append(inner)
    document.querySelector('main')!.append(outer)

    const iconOnly = document.createElement('button')
    iconOnly.dataset.variant = 'primary'
    iconOnly.innerHTML = '<svg></svg>'
    document.body.append(iconOnly)

    controller = createFrameController(document.body)
    controller.sync()

    expect(hiddenDialog.hasAttribute('data-dsh-frame')).toBe(false)
    expect(outer.dataset.dshFrame).toBe('panel')
    expect(inner.hasAttribute('data-dsh-frame')).toBe(false)
    expect(iconOnly.hasAttribute('data-dsh-frame')).toBe(false)
  })

  it('mounts delayed targets and removes markers, variables, observers, and scheduled work', async () => {
    const { dialog } = fixture()
    document.querySelector('[role="menu"]')?.remove()
    controller = createFrameController(document.body)

    const lateMenu = document.createElement('div')
    lateMenu.setAttribute('role', 'menu')
    document.body.append(lateMenu)
    await tick()
    expect(lateMenu.dataset.dshFrame).toBe('menu')

    dialog.parentElement!.style.opacity = '0.001'
    controller.sync()
    expect(dialog.hasAttribute('data-dsh-frame')).toBe(false)

    controller.dispose()
    controller = undefined
    expect(document.querySelector('[data-dsh-frame]')).toBeNull()
    for (const property of [
      '--dsw-frame-selected-nav',
      '--dsw-frame-composer',
      '--dsw-frame-dialog',
      '--dsw-frame-message',
      '--dsw-frame-menu',
      '--dsw-frame-panel',
      '--dsw-frame-primary-button',
    ]) {
      expect(document.body.style.getPropertyValue(property)).toBe('')
    }

    const afterDispose = document.createElement('div')
    afterDispose.setAttribute('role', 'menu')
    document.body.append(afterDispose)
    await tick()
    expect(afterDispose.hasAttribute('data-dsh-frame')).toBe(false)
  })
})
