import { describe, expect, it } from 'vitest'
import { failurePageUrl, loadingPageUrl } from '../src/failure-page.js'

function decodeDataPage(url: string): string {
  expect(url).toMatch(/^data:text\/html;charset=utf-8,/)
  return decodeURIComponent(url.slice(url.indexOf(',') + 1))
}

describe('desktop status pages', () => {
  it('renders normal startup as progress, without failure actions', () => {
    const html = decodeDataPage(loadingPageUrl('正在连接 <runtime>'))

    expect(html).toContain('<title>Convax Comic 启动中</title>')
    expect(html).toContain('<h1>Convax Comic 正在启动</h1>')
    expect(html).toContain('正在连接 &lt;runtime&gt;')
    expect(html).toContain('class="progress"')
    expect(html).toContain('--accent: #5c7a00')
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    expect(html).not.toContain('暂时无法连接运行时')
    expect(html).not.toContain('id="retry"')
    expect(html).not.toContain('window.convaxDesktop')
  })

  it('keeps retry, logs, and quit actions on a real failure page', () => {
    const html = decodeDataPage(failurePageUrl('退出码 <1>'))

    expect(html).toContain('<title>Convax Comic 启动失败</title>')
    expect(html).toContain('<h1>Convax Comic 暂时无法连接运行时</h1>')
    expect(html).toContain('退出码 &lt;1&gt;')
    expect(html).toContain('id="retry"')
    expect(html).toContain('id="logs"')
    expect(html).toContain('id="quit"')
    expect(html).toContain('window.convaxDesktop.retry()')
    expect(html).toContain('window.convaxDesktop.openLogs()')
    expect(html).toContain('window.convaxDesktop.quit()')
    expect(html).toContain('button:focus-visible')
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
    expect(html).not.toContain('class="progress"')
  })
})
