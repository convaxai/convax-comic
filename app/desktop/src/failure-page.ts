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
      <button class="primary" id="retry">重试</button>
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
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --ink: #1b1d1a;
      --secondary: #68716b;
      --canvas: #f4f2ec;
      --surface: #fbfaf7;
      --surface-raised: #ffffff;
      --line: #dedbd4;
      --line-strong: #cbc8c1;
      --accent: #5c7a00;
      --accent-hover: #4c6600;
      --accent-soft: #e8efcf;
      --focus: #769b00;
      --spring: cubic-bezier(.34, 1.56, .64, 1);
      --smooth: cubic-bezier(.2, 0, 0, 1);
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 32px;
      background:
        radial-gradient(circle at 50% 42%, rgb(92 122 0 / 7%) 0, transparent 42%),
        var(--canvas);
      color: var(--ink);
    }
    main {
      width: min(520px, 100%);
      padding: 36px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 1px 0 rgb(27 29 26 / 5%), 0 18px 48px rgb(27 29 26 / 8%);
      animation: enter 360ms var(--spring) both;
    }
    .mark {
      position: relative;
      width: 44px;
      height: 44px;
      margin-bottom: 24px;
      border: 1px solid rgb(92 122 0 / 18%);
      border-radius: 15px;
      background: var(--accent-soft);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 65%);
    }
    .mark::before,
    .mark::after {
      content: "";
      position: absolute;
      border-radius: 999px;
      background: var(--accent);
    }
    .mark::before { width: 16px; height: 7px; top: 12px; left: 9px; transform: rotate(-18deg); }
    .mark::after { width: 19px; height: 7px; right: 8px; bottom: 11px; transform: rotate(-18deg); }
    h1 { margin: 0; font-size: 23px; line-height: 1.3; letter-spacing: -.02em; font-weight: 650; }
    p { margin: 12px 0 0; color: var(--secondary); font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; }
    nav { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
    button {
      min-height: 40px;
      padding: 9px 16px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface-raised);
      color: var(--ink);
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 1px 2px rgb(27 29 26 / 6%);
      transition: transform 160ms var(--spring), background-color 120ms var(--smooth), border-color 120ms var(--smooth), box-shadow 120ms var(--smooth);
    }
    button:hover { border-color: var(--line-strong); background: #f7f6f2; transform: translateY(-1px); }
    button:active { transform: translateY(0) scale(.98); }
    button.primary { border-color: var(--accent); background: var(--accent); color: #fff; box-shadow: 0 4px 12px rgb(92 122 0 / 18%); }
    button.primary:hover { border-color: var(--accent-hover); background: var(--accent-hover); }
    button:focus-visible { outline: 3px solid rgb(118 155 0 / 34%); outline-offset: 3px; }
    .progress { height: 6px; margin-top: 28px; overflow: hidden; border-radius: 999px; background: #e5e3dc; }
    .progress span { display: block; width: 38%; height: 100%; border-radius: inherit; background: var(--accent); animation: loading 1.35s var(--smooth) infinite; }
    @keyframes enter { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
    @keyframes loading { from { transform: translateX(-110%); } to { transform: translateX(290%); } }
    @media (max-width: 520px) {
      body { padding: 20px; }
      main { padding: 28px; border-radius: 20px; }
      nav { display: grid; }
      button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      main, .progress span { animation: none; }
      .progress span { width: 100%; }
      button { transition: none; }
    }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true"></div>
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
