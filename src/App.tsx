import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Check, ChevronRight, ClipboardList, Download, ListFilter, MapPin, Search, Ticket, Users, X } from 'lucide-react'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Badge } from './components/ui/badge'
import { emptyState, formatNumber, type Person, type PickupState, type RegistrationResult } from './domain/pickup'
import type { MutationRequest, ServiceSnapshot } from '../shared/contracts'
import roster from '@pickup-roster'
import { LocalPickupRepository } from './services/pickup-repository'
import { clearPending, HttpPickupRepository, readPending, RepositoryError, savePending } from './services/http-repository'
import { CloudBasePickupRepository } from './services/cloudbase-repository'
import Registration from './components/Registration'
import PendingMutationNotice from './components/PendingMutationNotice'
import FormalAuthGate from './components/FormalAuthGate'
import { downloadExport, downloadEmergencyExport } from './services/export'

const localRepository = new LocalPickupRepository(roster)
const serverRepository = __PICKUP_CLOUDBASE__ ? new CloudBasePickupRepository(__PICKUP_API__, __PICKUP_FORMAL__) : new HttpPickupRepository(__PICKUP_API__)
export default function App() {
  return __PICKUP_FORMAL__ && serverRepository instanceof CloudBasePickupRepository ? <FormalAuthGate repository={serverRepository}>{(logout, username) => <PickupApp onLogout={logout} username={username}/>}</FormalAuthGate> : <PickupApp/>
}
function PickupApp({ onLogout, username }: { onLogout?: () => Promise<void>; username?: string }) {
  const [page, setPage] = useState(location.pathname.startsWith('/manage') ? 'manage' : 'register')
  const [people, setPeople] = useState<Person[]>(__PICKUP_SERVER__ ? [] : roster)
  const [state, setState] = useState(__PICKUP_SERVER__ ? emptyState() : localRepository.getSnapshot())
  const [snapshot, setSnapshot] = useState<ServiceSnapshot | null>(null)
  const [pending, setPending] = useState<MutationRequest | null>(null)
  const [mutationInFlight, setMutationInFlight] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [lastSync, setLastSync] = useState('')
  const newest = useRef(-1)
  const currentHash = useRef('')
  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  function applySnapshot(s: ServiceSnapshot) {
    if ((s.state.revision ?? 0) < newest.current) return
    newest.current = s.state.revision ?? 0
    currentHash.current = s.roster.hash
    setPeople(s.people); setState(s.state); setSnapshot(s); setLastSync(s.generatedAt); setSyncError('')
  }
  async function refresh() {
    if (!__PICKUP_SERVER__) return
    try { applySnapshot(await serverRepository.getSnapshot()) }
    catch (e) { setSyncError(e instanceof Error ? e.message : '无法获取最新名单') }
  }
  useEffect(() => {
    if (!__PICKUP_SERVER__) return
    try { const req = readPending(__PICKUP_API__); setPending(req); if (req?.operation === 'register') setSelected(req.ids) }
    catch (e) { setStorageBlocked(true); setError(e instanceof Error ? e.message : '未完成请求记录异常') }
    let active = true, fetching = false
    const poll = async () => {
      if (!active || fetching) return
      fetching = true
      try {
        if(__PICKUP_REVISION_SYNC__ && newest.current>=0) {
          const version=await serverRepository.getRevision()
          if(!active) return
          if(version.revision===newest.current && version.rosterHash===currentHash.current) {setLastSync(version.generatedAt);setSyncError('');return}
        }
        const s = await serverRepository.getSnapshot(); if (active) applySnapshot(s)
      }
      catch (e) { if (active) setSyncError(e instanceof Error ? e.message : '无法获取最新名单') }
      finally { fetching = false }
    }
    void poll()
    const timer = setInterval(() => { if (!document.hidden) void poll() },__PICKUP_REVISION_SYNC__ ? 5000 : 3000)
    window.addEventListener('focus',poll)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus',poll) }
  }, [])
  useEffect(() => {
    const pop = () => setPage(location.pathname.startsWith('/manage') ? 'manage' : 'register')
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  function navigate(next: string) { history.pushState({}, '', next === 'manage' ? '/manage' : '/'); setPage(next); setError('') }
  async function perform(req: MutationRequest) {
    // A persisted pending mutation prevents changing payload / retry ID after timeout.
    savePending(__PICKUP_API__,req); setPending(req); setMutationInFlight(true)
    try {
      const outcome = await serverRepository.mutate(req)
      applySnapshot(outcome.snapshot)
      clearPending(__PICKUP_API__); setPending(null)
      if (req.operation === 'register') setResult(outcome.result)
      else { setResult(null); setSelected([]) }
    } catch (e) {
      if (e instanceof RepositoryError && !e.uncertain) { clearPending(__PICKUP_API__); setPending(null); await refresh() }
      throw e
    } finally {
      setMutationInFlight(false)
    }
  }
  async function submit() {
    if (!selected.length || result || lock.current || pending || storageBlocked || (__PICKUP_SERVER__ && !snapshot)) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (__PICKUP_SERVER__) await perform({operation:'register',requestId:crypto.randomUUID(),rosterHash:snapshot!.roster.hash,ids:selected})
      else { setResult(await localRepository.register(selected)); setState(localRepository.getSnapshot()) }
    }
    catch (e) { setError(e instanceof Error ? e.message : '登记失败，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  async function recover() {
    if (!pending || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await perform(pending) }
    catch (e) { setError(e instanceof Error ? e.message : '结果尚未确定，请继续使用原请求恢复') }
    finally { lock.current = false; setBusy(false) }
  }
  async function correct(id: string, target: number | null, expectedVersion: number) {
    if (pending || storageBlocked || lock.current) throw new Error('请先恢复未完成请求的结果')
    lock.current = true
    try {
      if (__PICKUP_SERVER__) await perform({operation:'correct',requestId:crypto.randomUUID(),rosterHash:snapshot!.roster.hash,id,target,expectedVersion})
      else { await localRepository.correct(id, target); setState(localRepository.getSnapshot()) }
    } finally { lock.current = false }
    if (result) { setResult(null); setSelected([]) }
  }
  async function exportSnapshot(): Promise<ServiceSnapshot> {
    if (__PICKUP_SERVER__) { const s = await serverRepository.getSnapshot(); applySnapshot(s); return s }
    return { people, state:localRepository.getSnapshot(), roster:{version:'local',hash:'',count:people.length,demo:__PICKUP_DEMO__},generatedAt:new Date().toISOString() }
  }
  const blocked = !!pending || storageBlocked || (__PICKUP_SERVER__ && !snapshot)
  return <div className="app-shell">
    <header className="topbar"><div className="top-inner">
      <a className="brand" href="/" onClick={e => { e.preventDefault(); navigate('register') }}><span className="brand-icon"><MapPin size={21}/></span><span>现场接人<span className="brand-sub">活动接待工作台</span></span></a>
      <nav aria-label="主要导航"><a href="/" aria-current={page === 'register' ? 'page' : undefined} onClick={e => { e.preventDefault(); navigate('register') }}><Ticket size={17}/>接人登记</a><a href="/manage" aria-current={page === 'manage' ? 'page' : undefined} onClick={e => { e.preventDefault(); navigate('manage') }}><ClipboardList size={17}/>名单管理</a></nav>
      <Badge variant="outline" className="local-badge"><span className="status-dot"/>{__PICKUP_CLOUDBASE__ ? 'CloudBase 云端' : __PICKUP_DOCDB_SIMULATION__ ? '文档库本地模拟' : __PICKUP_SERVER__ ? '共享数据库' : '本地模拟'}</Badge>
      {onLogout && <><span className="text-sm text-slate-600 whitespace-nowrap">当前用户：{username || '已登录'}</span><Button variant="outline" disabled={busy || mutationInFlight || !!pending} onClick={() => void onLogout()}>退出登录</Button></>}
    </div></header>
    <div className="simulation-strip">{__PICKUP_SERVER__ ? `${__PICKUP_DOCDB_SIMULATION__ ? '文档库事务模拟（非真实云端）' : '服务端登记'} · ${lastSync ? `最近同步 ${new Date(lastSync).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'})} · ${__PICKUP_REVISION_SYNC__ ? '每 5 秒检查版本' : '每 3 秒更新'}` : '正在连接数据库…'}` : '本地模拟 · 仅当前浏览器内有效，刷新后清空登记；不支持多人同步或并发安全。'}</div>
    <main className="main-container">
      <div className="page-heading"><div><div className="eyebrow">活动现场 / {page === 'register' ? '接待登记' : '会场名单'}</div><h1>{page === 'register' ? '接人登记' : '名单管理'}</h1><p>{page === 'register' ? '找到要迎接的人，确认登记后通知发牌员。' : '查看人员归属、核对号码分组，导出会场安排。'}</p></div><div className="roster-note"><Users size={17}/><span>{(__PICKUP_SERVER__ ? snapshot?.roster.demo : __PICKUP_DEMO__) ? '虚构示例名单' : __PICKUP_SERVER__ ? '服务端名单' : '真实名单已导入'}<strong>{people.length} 位人员</strong></span></div></div>
      {error && <div role="alert" className="error-message">{error}</div>}
      {syncError && <div role="alert" className="error-message">{syncError}。当前显示可能较旧；切换到离线 Excel 登记时，请通知全部工作人员停止线上发号。<Button variant="outline" onClick={refresh}>刷新名单</Button></div>}
      <PendingMutationNotice pending={pending} inFlight={mutationInFlight} recover={recover}/>
      {page === 'register' ? <Registration people={people} state={state} selected={selected} setSelected={setSelected} result={result} busy={busy} blocked={blocked} server={__PICKUP_SERVER__} submit={submit} next={() => { setSelected([]); setResult(null); setError('') }}/> : <Management people={people} state={state} correct={correct} exportSnapshot={exportSnapshot} server={__PICKUP_SERVER__} blocked={blocked}/>}
      <footer>现场接人登记 · {__PICKUP_SERVER__ ? '服务端登记' : '本地业务原型'} <span>{__PICKUP_SERVER__ ? `名单版本：${snapshot?.roster.version || '加载中'}` : __PICKUP_DEMO__ ? '名单来源：虚构示例 · 学员及志工' : '名单来源：最终签到表 · 学员及志工'}</span></footer>
    </main>
  </div>
}

function Management({people, state, correct, exportSnapshot, server, blocked}: {people: Person[]; state: PickupState; correct: (id: string, target: number | null, expectedVersion: number) => Promise<void>; exportSnapshot: () => Promise<ServiceSnapshot>; server: boolean; blocked: boolean}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('people')
  const [editing, setEditing] = useState<string | null>(null)
  const [target, setTarget] = useState('unassigned')
  const [editingVersion, setEditingVersion] = useState(0)
  useEffect(() => { if (editing) setEditingVersion(state.versions?.[editing] ?? 0) }, [editing])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const q = query.trim().toLowerCase()
  const matches = people.filter(p => {
    const number = state.assignments[p.id]
    return (!q || `${p.name} ${p.company} ${number === undefined ? '' : formatNumber(number)}`.toLowerCase().includes(q)) && (filter === 'all' || (filter === 'unassigned' ? number === undefined : number === Number(filter)))
  })
  const assigned = Object.keys(state.assignments).length
  async function save(id: string) {
    if (busy || blocked) return
    setBusy(true); setError('')
    try { await correct(id, target === 'unassigned' ? null : Number(target), editingVersion); setEditing(null); setMessage(server ? '已更新服务端归属，登记页与导出名单已同步。' : '已更新本地分配，登记页与导出名单已同步。') }
    catch(e) { setError(e instanceof Error ? e.message : '纠正失败'); if (e instanceof RepositoryError && e.code === 'ASSIGNMENT_CONFLICT') setEditing(null) }
    finally { setBusy(false) }
  }
  async function exportFile(emergency = false) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const s = await exportSnapshot(), date = new Date(s.generatedAt), label = server ? '服务端快照' : '本地模拟'
      if (emergency) { await downloadEmergencyExport(s.people,s.state,date,label); setMessage(`已导出应急台账：全部 ${s.people.length} 人及全部已发号码。切换离线登记前，请通知所有工作人员停止线上发号。`) }
      else { await downloadExport(s.people,s.state,date,label); setMessage(`已导出 ${Object.keys(s.state.assignments).length} 位已分配人员。`) }
    }
    catch { setError('导出失败，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="panel management-panel">
    <div className="management-header"><div className="view-tabs"><Button variant={view === 'people' ? 'default' : 'ghost'} onClick={() => setView('people')}><Users size={16}/>全部人员</Button><Button variant={view === 'groups' ? 'default' : 'ghost'} onClick={() => setView('groups')}><Ticket size={16}/>号码分组</Button></div><div className="export-actions"><Button variant="outline" disabled={!assigned || busy} onClick={() => exportFile()}><Download size={16}/>导出会场 Excel</Button><Button variant="outline" disabled={busy} onClick={() => exportFile(true)}><Download size={16}/>导出应急台账</Button></div></div>
    <div className="management-tools"><div className="search-field"><Search size={19}/><Input aria-label="查询名单" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索姓名、公司或号码牌"/>{query && <button aria-label="清空名单查询" onClick={() => setQuery('')}><X size={16}/></button>}</div><label className="filter-field"><ListFilter size={17}/><select aria-label="分配状态筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部分配状态</option><option value="unassigned">未分配人员</option>{state.issuedNumbers.map(n => <option key={n} value={n}>{formatNumber(n)} 号</option>)}</select></label></div>
    <div className="table-summary">共 {people.length} 人 <span>已分配 {assigned} 人 · 未分配 {people.length - assigned} 人</span><span className="ml-auto">当前显示 {matches.length} 人</span></div>
    {message && <div role="status" className="success-message"><Check size={16}/>{message}</div>}{error && <div role="alert" className="error-message">{error}</div>}
    {view === 'people' ? <div className="table-scroll"><table><thead><tr><th>姓名</th><th>公司</th><th>分配状态</th><th>号码牌</th><th className="right">操作</th></tr></thead><tbody>{matches.map(p => <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.company || '未填写公司'}</td><td><Badge variant="secondary" className={state.assignments[p.id] !== undefined ? 'assigned-badge' : 'unassigned-badge'}>{state.assignments[p.id] !== undefined ? '已分配' : '未分配'}</Badge></td><td className="table-number">{state.assignments[p.id] === undefined ? '—' : `${formatNumber(state.assignments[p.id])} 号`}</td><td className="right"><Button variant="ghost" size="sm" aria-label={`纠正 ${p.name}，${p.company || '未填写公司'}`} onClick={() => { setEditing(p.id); setTarget(state.assignments[p.id] === undefined ? 'unassigned' : String(state.assignments[p.id])); setMessage(''); setError('') }}><ArrowLeftRight size={14}/>纠正</Button></td></tr>)}</tbody></table>{!matches.length && <div className="empty-small">没有匹配的人员，请调整搜索或筛选。</div>}</div> : <div className="groups-scroll">{state.issuedNumbers.filter(n => filter === 'all' || filter === String(n)).map(n => {
      const members = matches.filter(p => state.assignments[p.id] === n)
      const total = people.filter(p => state.assignments[p.id] === n).length
      if (q && !members.length) return null
      return <div className="group-row" key={n}><div className="group-ticket"><Ticket size={19}/><strong>{formatNumber(n)}</strong><span>{total} 人</span></div><div className="group-members">{members.map(p => <div key={p.id}><strong>{p.name}</strong><span>{p.company || '未填写公司'}</span></div>)}{!total && <p>此号码暂无人员，已发放的编号继续保留。</p>}</div></div>
    })}{filter === 'unassigned' ? <div className="empty-small">未分配人员尚无号码分组，可在「全部人员」中查看。</div> : !state.issuedNumbers.length ? <div className="empty-small"><Ticket size={28}/><p>还没有号码分组，完成首次登记后即可查看。</p></div> : !matches.some(p => state.assignments[p.id] !== undefined) && q ? <div className="empty-small">没有匹配的号码分组。</div> : null}</div>}
    <div className="panel-footnote">会场 Excel：仅已分配人员，按号码排序。应急台账：全部人员及全部已发号码（含空号），离线登记前请停止线上发号。生成时间使用北京时间。</div>
    {editing && (() => { const p = people.find(p => p.id === editing)!; return <div className="correction-panel"><div><strong>{server ? '纠正归属' : '模拟纠正'} · {p.name}</strong><p>{p.company || '未填写公司'}</p><p>当前：{state.assignments[p.id] === undefined ? '未分配' : `${formatNumber(state.assignments[p.id])} 号`} <ChevronRight size={13} className="inline"/> 选择新的归属。撤销后编号保留。</p></div><div className="correction-controls"><select aria-label="纠正后的号码" value={target} onChange={e => setTarget(e.target.value)}><option value="unassigned">撤销分配（未分配）</option>{state.issuedNumbers.map(n => <option key={n} value={n}>{formatNumber(n)} 号</option>)}</select><Button disabled={busy || blocked} onClick={() => save(p.id)}><Check size={16}/>保存纠正</Button><Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>取消</Button></div></div> })()}
  </section>
}
