import type { MutationRequest } from '../../shared/contracts'
import { Button } from './ui/button'

export default function PendingMutationNotice({pending, inFlight, recover}: {
  pending: MutationRequest | null
  inFlight: boolean
  recover: () => Promise<void>
}) {
  if (!pending) return null
  const action = pending.operation === 'register' ? '登记' : '纠正'
  if (inFlight) return <div role="status" className="mutation-progress">正在{action}，请稍候…</div>
  return <div role="alert" className="error-message">有一条{action}结果暂未确认。请恢复原请求结果，暂勿发牌。<Button onClick={recover}>恢复原请求结果</Button></div>
}
