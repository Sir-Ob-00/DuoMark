import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import { AppRouter } from './app/router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="min-h-screen min-w-[320px] bg-cool-slate font-inter text-sm leading-6 text-ink antialiased [font-synthesis:none] [text-rendering:optimizeLegibility]">
      <AppRouter />
    </div>
  </StrictMode>,
)
