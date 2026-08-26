function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function failurePageUrl(message: string): string {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>Convax Comic 启动中</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #111318; color: #e8ebf2; }
    main { width: min(560px, calc(100vw - 64px)); padding: 32px; border: 1px solid #30343d; border-radius: 16px; background: #191c23; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { color: #adb4c2; line-height: 1.6; overflow-wrap: anywhere; }
    nav { display: flex; gap: 10px; margin-top: 24px; }
    button { border: 0; border-radius: 8px; padding: 9px 14px; background: #303642; color: inherit; cursor: pointer; }
    button:first-child { background: #5d72e8; }
  </style>
</head>
<body>
  <main>
    <h1>Convax Comic 暂时无法连接运行时</h1>
    <p>${escapeHtml(message)}</p>
    <nav>
      <button id="retry">重试</button>
      <button id="logs">查看日志</button>
      <button id="quit">退出</button>
    </nav>
  </main>
  <script>
    document.querySelector('#retry').addEventListener('click', () => window.convaxDesktop.retry())
    document.querySelector('#logs').addEventListener('click', () => window.convaxDesktop.openLogs())
    document.querySelector('#quit').addEventListener('click', () => window.convaxDesktop.quit())
  </script>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
