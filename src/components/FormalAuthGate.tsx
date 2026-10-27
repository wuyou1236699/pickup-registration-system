import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloudBasePickupRepository } from '../services/cloudbase-repository'
import { Button } from './ui/button'
import { Input } from './ui/input'

export default function FormalAuthGate({ repository, children }: { repository: CloudBasePickupRepository; children: (logout: () => Promise<void>, username: string) => ReactNode }) {
  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const [message, setMessage] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const epoch = useRef(0)
  const [logoutFailed, setLogoutFailed] = useState(false)
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    const version = epoch.current
    try { unsubscribe = repository.watchSession(() => { epoch.current++; if (active) setAuthorized(false) }) }
    catch (error) { setMessage(error instanceof Error ? error.message : '连接未配置') }
    repository.restoreAuthorization().then(value => { if (active && version === epoch.current) setAuthorized(value) }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : '无法恢复会话') }).finally(() => { if (active) setChecking(false) })
    return () => { active = false; unsubscribe?.() }
  }, [repository])
  async function logout() {
    epoch.current++
    setAuthorized(false)
    try { await repository.logout(); setLogoutFailed(false); setMessage('已退出登录') }
    catch { setLogoutFailed(true); setMessage('退出未完成，请重试退出；本页已停止同步') }
  }
  if (authorized) return children(logout, repository.currentUsername)
  return <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50"><form className="w-full max-w-sm rounded-xl border bg-white p-8 space-y-5" onSubmit={async event => {
    event.preventDefault()
    if (checking) return
    setChecking(true); setMessage('')
    const version = epoch.current
    try { await repository.login(username.trim(), password); setPassword(''); if (version === epoch.current) setAuthorized(true) }
    catch (error) { setPassword(''); setMessage(error instanceof Error ? error.message : '登录失败') }
    finally { setChecking(false) }
  }}><h1 className="text-2xl font-bold">接人系统登录</h1><p className="text-sm text-slate-600">请使用预先授权的账号登录。</p><label className="block">用户名<Input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required disabled={checking}/></label><label className="block">密码<Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={checking}/></label>{message && <p role="alert" className="text-sm text-red-700">{message}</p>}{logoutFailed && <Button type="button" variant="outline" onClick={() => void logout()}>重试退出</Button>}<Button className="w-full" disabled={checking}>{checking ? '正在验证会话…' : '登录'}</Button></form></main>
}
