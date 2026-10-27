import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Check, ChevronRight, Info, Plus, Search, Ticket, UserRound, Users, X } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { formatNumber, searchPeople, type Person, type PickupState, type RegistrationResult } from '../domain/pickup'
interface Props { people: Person[]; state: PickupState; selected: string[]; setSelected: (ids: string[]) => void; result: RegistrationResult | null; busy: boolean; blocked: boolean; server: boolean; submit: () => void; next: () => void }
export default function Registration({ people, state, selected, setSelected, result, busy: submitting, blocked, server, submit, next }: Props) {
  const busy = submitting || blocked
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  const [active, setActive] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const chosen = people.filter(p => selected.includes(p.id)).sort((a,b) => selected.indexOf(a.id)-selected.indexOf(b.id))
  const candidates = useMemo(() => searchPeople(people, query).filter(p => !selected.includes(p.id)), [people, query, selected])
  const newCount = selected.filter(id => state.assignments[id] === undefined).length
  useEffect(() => { if (!result) input.current?.focus() }, [result])
  useEffect(() => { if (active !== null && open) document.getElementById(`candidate-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  useEffect(() => {
    const shortcut = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !composing.current && !result && !busy) { e.preventDefault(); submit() }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [submit, result, busy])
  function add(p: Person) {
    if (selected.includes(p.id) || result || busy) return
    setSelected([...selected, p.id]); setQuery(''); setActive(null); setOpen(true); input.current?.focus()
  }
  function keydown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || composing.current || e.ctrlKey) return
    if (e.key === 'Escape') { setOpen(false); setActive(null); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(true); setActive(i => {
        if (!candidates.length) return null
        if (i === null) return e.key === 'ArrowDown' ? 0 : candidates.length - 1
        return (i + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length
      })
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!query.trim() || !open) return
      const candidate = active !== null ? candidates[active] : candidates.length === 1 ? candidates[0] : undefined
      if (candidate) add(candidate)
    }
  }
  if (result) return <div className="result-layout">
    <section className="panel result-panel" aria-live="polite"><div className="result-check"><Check size={27}/></div>
      <h2>{result.number !== null ? `登记成功：${formatNumber(result.number)} 号` : '人员均已分配，无需发放新号码牌'}</h2>
      <p className="result-subtitle">{result.number !== null ? '请通知纸质发牌员，发放以下号码牌。' : '请将已有号码告知接人者。此次未占用新号码。'}</p>
      {result.number !== null && <div className="big-ticket"><span>本次发放号码牌</span><strong>{formatNumber(result.number)}</strong><span>{result.newlyAssigned.length} 位人员在此号码区块等待</span></div>}
      <div className="result-people">{result.newlyAssigned.length > 0 && <><h3><Users size={17}/>新分配人员 <Badge variant="secondary">{result.newlyAssigned.length} 人</Badge></h3>{result.newlyAssigned.map(id => {const p=people.find(p=>p.id===id)!;return <div className="result-person" key={id}><strong>{p.name}</strong><span>{p.company || '未填写公司'}</span><b>{formatNumber(result.number!)} 号</b></div>})}</>}
      {result.existing.length > 0 && <><h3 className="existing-heading"><Info size={17}/>已有号码，请一并告知</h3><p className="existing-summary">{result.existing.map(({id,number})=>`${people.find(p=>p.id===id)!.name}在 ${formatNumber(number)} 号`).join('，')}。</p>{result.existing.map(({id,number})=>{const p=people.find(p=>p.id===id)!;return <div className="result-person existing" key={id}><strong>{p.name}</strong><span>{p.company || '未填写公司'}</span><b>{formatNumber(number)} 号</b></div>})}</>}
      </div><Button className="next-button" size="lg" onClick={() => { setQuery(''); setActive(null); setOpen(true); next() }}>下一位接人者<ArrowRight size={18}/></Button>
    </section><aside className="result-side"><Ticket size={31}/><h3>号码区块，清晰告知</h3><p>接人者可以自由走动，被接者在所属号码区块等待。</p><p>已经分配的人员保持原号码，避免被重复安排。</p><div className="aside-divider"/><p>{server ? '以上是本次请求登记时的结果，已保存到数据库。之后的纠正请在名单管理中核对；纸质号码牌仅发放一次，恢复结果不会再次发号。' : '这是一条本地模拟登记结果。切换页面可继续核对，刷新浏览器会清空登记。'}</p></aside>
  </div>
  return <div className="registration-grid">
    <section className="panel search-panel"><div className="panel-heading"><span className="step-number">1</span><div><h2>查找被接人员</h2><p>按姓名、公司或学习小组搜索，点击即可添加。</p></div></div>
      <div className="search-field main-search"><Search size={21}/><Input disabled={busy} ref={input} value={query} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setActive(null); setOpen(true) }} onKeyDown={keydown} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} placeholder="输入姓名、公司或学习小组" aria-label="搜索姓名、公司或学习小组" role="combobox" aria-expanded={open} aria-controls="candidate-list" aria-autocomplete="list" aria-activedescendant={open && active !== null && candidates[active] ? `candidate-${active}` : undefined}/>{query && <button aria-label="清空搜索" onClick={() => { setQuery(''); setActive(null); input.current?.focus() }}><X size={18}/></button>}</div>
      <div className="candidate-heading"><span>{query ? `找到 ${candidates.length} 位候选人员` : '人员名单'}</span><span>姓名 / 公司 / 学习小组 / 号码归属</span></div>
      <div className="candidate-list" id="candidate-list" role="listbox" aria-label="候选人员">{open ? candidates.map((p, index) => <div role="option" aria-selected={active === index} id={`candidate-${index}`} key={p.id} className={`candidate ${active === index ? 'active' : ''}`}><button disabled={busy} onClick={() => add(p)} tabIndex={0} aria-label={`添加 ${p.name}，${p.company || '未填写公司'}`}><span className="person-avatar"><UserRound size={19}/></span><span className="candidate-person"><strong>{p.name}</strong><span>{p.company || '未填写公司'}</span>{p.source.learningGroup?.trim() && <span className="learning-group">{p.source.learningGroup}</span>}</span><span className="candidate-status">{state.assignments[p.id] === undefined ? <Badge variant="secondary" className="unassigned-badge">未分配</Badge> : <Badge variant="secondary" className="assigned-badge">{formatNumber(state.assignments[p.id])} 号 · 已分配</Badge>}<Plus size={17}/></span></button></div>) : <div className="empty-small">候选列表已收起，点击搜索框继续。</div>}{open && !candidates.length && <div className="empty-small"><Search size={27}/><p>没有可添加的匹配人员</p><span>请更换关键词，或检查是否已加入右侧名单。</span></div>}</div>
      <div className="keyboard-guide"><span><kbd>↑</kbd><kbd>↓</kbd>切换</span><span><kbd>Enter</kbd>添加</span><span><kbd>Esc</kbd>收起</span></div>
    </section>
    <section className="panel selection-panel"><div className="panel-heading"><span className="step-number">2</span><div><h2>本次迎接人员 <span className="selected-count">{selected.length}</span></h2><p>确认人员后，再分配号码牌。</p></div></div>
      <div className="selection-content">{chosen.length ? <><div className="selection-status"><span>{newCount} 位待分配</span>{chosen.length-newCount>0 && <span>{chosen.length-newCount} 位已有号码</span>}</div><div className="selected-list">{chosen.map(p => <div className="selected-person" key={p.id}><div className="selected-person-info"><strong>{p.name}</strong><p>{p.company || '未填写公司'}</p>{p.source.learningGroup?.trim() && <p className="learning-group">{p.source.learningGroup}</p>}</div><Badge variant="secondary" className={`selection-assignment ${state.assignments[p.id] === undefined ? 'is-new' : 'is-existing'}`}>{state.assignments[p.id] === undefined ? '将分配新号码' : `已有 ${formatNumber(state.assignments[p.id])} 号`}</Badge><Button variant="ghost" size="icon" disabled={busy} aria-label={`移除 ${p.name}，${p.company || '未填写公司'}`} onClick={() => { setSelected(selected.filter(id=>id!==p.id)); setActive(null); input.current?.focus() }}><X size={17}/></Button></div>)}</div></> : <div className="selection-empty"><span><Users size={31}/></span><h3>先添加要迎接的人</h3><p>在左侧搜索并添加人员<br/>可连续选择多位</p><div><Search size={14}/><ChevronRight size={13}/><Plus size={14}/><ChevronRight size={13}/><Ticket size={14}/></div></div>}</div>
      <div className="confirm-area"><div className="assignment-note"><Info size={16}/><p>{selected.length && !newCount ? '所选人员均有号码，确认后直接展示已有归属。' : '仅为尚未分配的人员发新号码。已有号码保持不变。'}</p></div><Button disabled={!selected.length || busy} size="lg" className="confirm-button" onClick={submit}><Check size={18}/>{submitting ? '正在登记…' : '确认登记'}<span><kbd>Ctrl</kbd> + <kbd>Enter</kbd></span></Button><p className="confirm-hint">号码在确认成功时生成，按登记顺序递增。</p></div>
    </section>
  </div>
}
