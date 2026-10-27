// Local browser fixture only; no CloudBase connection or credentials.
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import FormalAuthGate from '../../src/components/FormalAuthGate'
import type { CloudBasePickupRepository } from '../../src/services/cloudbase-repository'
let lost: (() => void) | undefined
const allowed = ['staff01', 'staff02', 'staff03', 'staff04', 'auditor']
const repository = {
  get currentUsername() { return sessionStorage.getItem('fake-user') || '' },
  async restoreAuthorization() {
    const user = sessionStorage.getItem('fake-user')
    if (!user || user === 'anonymous') return false
    if (!allowed.includes(user)) throw new Error('此账号未获授权')
    return true
  },
  async login(username: string, password: string) {
    if (password !== 'fake-password') throw new Error('登录失败')
    sessionStorage.setItem('fake-user', username)
    if (!allowed.includes(username)) throw new Error('此账号未获授权')
  },
  async logout() { sessionStorage.removeItem('fake-user') },
  watchSession(callback: () => void) {
    lost = callback
    const listener = () => { sessionStorage.removeItem('fake-user'); lost?.() }
    window.addEventListener('fake-session-lost', listener)
    return () => { window.removeEventListener('fake-session-lost', listener); lost = undefined }
  },
} as unknown as CloudBasePickupRepository
function PrivatePage({ logout, username }: { logout: () => Promise<void>; username: string }) {
  useEffect(() => {
    document.body.dataset.syncing = 'true'
    return () => { document.body.dataset.syncing = 'false' }
  }, [])
  return <div>虚构名单<span>当前用户：{username}</span><ButtonLogout logout={logout}/></div>
}
function ButtonLogout({ logout }: { logout: () => Promise<void> }) { return <button onClick={() => void logout()}>退出登录</button> }
createRoot(document.getElementById('root')!).render(<FormalAuthGate repository={repository}>{(logout, username) => <PrivatePage logout={logout} username={username}/>}</FormalAuthGate>)
