import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Button } from '../components/ui'
import duoMarkIcon from '../assets/DuoMark icon.png'

export function TerminalLayout() {
  const [fullscreenError, setFullscreenError] = useState<string | null>(null)

  async function enterFullscreen() {
    setFullscreenError(null)
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch (reason) {
      setFullscreenError(reason instanceof Error ? reason.message : 'Fullscreen mode is unavailable in this browser.')
    }
  }

  return <div className="flex min-h-screen flex-col bg-cool-slate bg-[radial-gradient(ellipse_at_50%_35%,rgb(15_118_110_/_6%),transparent_50%)]">
    <header className="flex min-h-[72px] items-center justify-between bg-deep-navy px-[clamp(1rem,4vw,3rem)] py-3 text-white max-sm:flex-col max-sm:items-start max-sm:gap-2">
      <div className="inline-flex items-center gap-2.5"><img className="size-[38px] rounded-[10px] bg-pale-teal p-1.5 object-contain" src={duoMarkIcon} alt="" aria-hidden="true" /><span><strong className="block font-manrope font-extrabold">DuoMark</strong><small className="block text-xs text-slate-300">Attendance terminal</small></span></div>
      <div className="flex items-center gap-4 max-sm:w-full max-sm:justify-between"><span className="inline-flex items-center gap-2 text-xs text-pale-teal"><span className="size-2 rounded-full bg-green-600" aria-hidden="true" />Terminal ready</span><Button className="text-white hover:bg-white/10" variant="quiet" onClick={() => void enterFullscreen()}>Toggle fullscreen</Button></div>
    </header>
    {fullscreenError && <p className="m-0 bg-error-bg px-4 py-2 text-center text-error" role="alert">{fullscreenError}</p>}
    <main className="flex flex-1 items-center justify-center px-4 py-4 sm:py-5"><Outlet /></main>
    <footer className="p-4 text-center text-xs text-muted-slate">Student attendance terminal · Staff sign-in is not required</footer>
  </div>
}
