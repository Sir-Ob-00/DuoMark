import { useParams } from 'react-router-dom'
import { PublicTerminalDisplay } from './PublicTerminalDisplay'

export function TerminalPage() {
  const { terminalId } = useParams()
  return <PublicTerminalDisplay key={terminalId} terminalId={terminalId} />
}
