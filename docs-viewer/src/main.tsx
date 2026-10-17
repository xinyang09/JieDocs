import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './pearl-theme.css'

const desktopRuntime = (window as Window & { fnsDesktop?: { isDesktop?: boolean } }).fnsDesktop
if (desktopRuntime?.isDesktop) {
  document.documentElement.dataset.shell = 'desktop'
  document.title = 'JieDocs'
}

const root = createRoot(document.getElementById('root')!)

function renderStorageError() {
  root.render(
    <main className="auth-checking">
      <div className="auth-checking-card">
        <strong>无法打开本地配置</strong>
        <span>请确认文档台服务正在运行，然后刷新页面。</span>
      </div>
    </main>,
  )
}

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
