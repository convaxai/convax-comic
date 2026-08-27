function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

type StatusPageKind = 'failure' | 'loading'

function statusPageUrl(kind: StatusPageKind, message: string): string {
  const loading = kind === 'loading'
  const title = loading ? 'Convax Comic 正在启动' : 'Convax Comic 暂时无法连接运行时'
  const documentTitle = loading ? 'Convax Comic 启动中' : 'Convax Comic 启动失败'
  const actions = loading
    ? '<div class="progress" aria-hidden="true"><span></span></div>'
    : `<nav>
      <button id="retry">重试</button>
      <button id="logs">查看日志</button>
      <button id="quit">退出</button>
    </nav>`
  const script = loading
    ? ''
    : `<script>
    document.querySelector('#retry').addEventListener('click', () => window.convaxDesktop.retry())
    document.querySelector('#logs').addEventListener('click', () => window.convaxDesktop.openLogs())
    document.querySelector('#quit').addEventListener('click', () => window.convaxDesktop.quit())
  </script>`
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>${documentTitle}</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #111318; color: #e8ebf2; }
    main { width: min(560px, calc(100vw - 64px)); padding: 32px; border: 1px solid #30343d; border-radius: 16px; background: #191c23; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { color: #adb4c2; line-height: 1.6; overflow-wrap: anywhere; }
    nav { display: flex; gap: 10px; margin-top: 24px; }
    button { border: 0; border-radius: 8px; padding: 9px 14px; background: #303642; color: inherit; cursor: pointer; }
    button:first-child { background: #5d72e8; }
    .progress { height: 3px; margin-top: 24px; overflow: hidden; border-radius: 999px; background: #2b2f38; }
    .progress span { display: block; width: 42%; height: 100%; border-radius: inherit; background: #7c8df1; animation: loading 1.2s ease-in-out infinite alternate; }
    @keyframes loading { from { transform: translateX(-25%); } to { transform: translateX(165%); } }
    @media (prefers-reduced-motion: reduce) { .progress span { width: 100%; animation: none; } }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${escapeHtml(message)}</p>
    ${actions}
  </main>
  ${script}
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export function loadingPageUrl(message: string): string {
  return statusPageUrl('loading', message)
}

export function failurePageUrl(message: string): string {
  return statusPageUrl('failure', message)
}
