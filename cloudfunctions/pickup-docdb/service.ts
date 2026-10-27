import { createHash } from 'node:crypto'
import type { MutationResponse, Person, RegistrationResult, RevisionInfo, RosterInfo, ServiceSnapshot } from '../../shared/contracts'
import { ServiceError } from '../../shared/service-error'
import { rosterHash, validateMutation, validateRoster } from '../../shared/server-validation'
import type { DocumentDatabase, DocumentReader, DocumentTransaction } from './port'

const BLOCK_SIZE = 50, MAX_PEOPLE = 200, MAX_DOC_BYTES = 512 * 1024
interface Control extends RosterInfo { schema: 1; nextNumber: number; revision: number; blocks: number }
interface Entry { id: string; number: number | null; version: number }
interface Loaded { control: Control; people: Person[]; blocks: Entry[][] }
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v==='object' && !Array.isArray(v) }
function consistent(): never { throw new ServiceError('DOCUMENT_INCONSISTENT','数据库完整性校验失败，已停止操作') }
function controlValue(v: unknown): Control {
  if (!object(v) || v.schema!==1 || !Number.isSafeInteger(v.nextNumber) || Number(v.nextNumber)<1 || Number(v.nextNumber)>1000000 || !Number.isSafeInteger(v.revision) || Number(v.revision)<0 || typeof v.hash!=='string' || !/^[a-f0-9]{64}$/.test(v.hash) || typeof v.version!=='string' || typeof v.demo!=='boolean' || !Number.isInteger(v.count) || Number(v.count)<1 || Number(v.count)>MAX_PEOPLE || v.blocks!==Math.ceil(Number(v.count)/BLOCK_SIZE)) consistent()
  return v as unknown as Control
}
function code(error: unknown) { return object(error) && typeof error.code==='string' ? error.code : '' }
function bounded(data: object) { if (Buffer.byteLength(JSON.stringify(data))>MAX_DOC_BYTES) throw new ServiceError('DOCUMENT_TOO_LARGE','名单或记录过大，尚未提交'); return data }

export class DocumentPickupService {
  readonly dataCollection: string
  readonly requestsCollection: string
  constructor(private readonly db: DocumentDatabase, prefix: string, private readonly fault?: (point: string)=>void) {
    if (!/^pickup_docdb_[a-z0-9_]{1,30}$/.test(prefix)) throw new Error('独立集合前缀必须以 pickup_docdb_ 开头')
    this.dataCollection=`${prefix}_data`; this.requestsCollection=`${prefix}_requests`
  }
  private async transaction<T>(work: (tx: DocumentTransaction)=>Promise<T>, readOnly=false): Promise<T> {
    for(let attempt=0;;attempt++) {
      const tx=await this.db.startTransaction()
      let committing=false
      try {
        const result=await work(tx)
        this.fault?.('before-commit')
        committing=true; await tx.commit(); return result
      } catch(error) {
        let rollbackFailed=false
        try { await tx.rollback() } catch { rollbackFailed=true }
        // Only the documented explicit conflict is safe to retry automatically.
        if(code(error)==='DATABASE_TRANSACTION_CONFLICT') {
          if(attempt<2) { await new Promise(r=>setTimeout(r,20*2**attempt+Math.random()*20)); continue }
          // A prior invocation of this UUID may still be running after a timeout.
          // Conflict exhaustion proves this attempt failed, not that prior attempts failed.
          throw new ServiceError('TRANSACTION_BUSY','登记竞争较多，请稍后恢复原请求，勿重新发牌',true)
        }
        if((committing || rollbackFailed) && !readOnly) throw new ServiceError('RESULT_UNKNOWN','提交结果尚未确定，请恢复原请求，勿重新发牌',true)
        throw error
      }
    }
  }
  private async control(reader: DocumentReader) {
    const value=await reader.get(this.dataCollection,'control')
    if(value===null) throw new ServiceError('NOT_INITIALIZED','尚未初始化名单，请联系现场负责人')
    return controlValue(value)
  }
  private async load(reader: DocumentReader, control?: Control): Promise<Loaded> {
    const c=control ?? await this.control(reader)
    const catalog=await reader.get(this.dataCollection,'catalog')
    if(!object(catalog) || catalog.hash!==c.hash || catalog.version!==c.version) consistent()
    const people=validateRoster(catalog.people,c.version,c.count)
    if(rosterHash(people,c.version)!==c.hash) consistent()
    const blocks: Entry[][]=[]
    for(let i=0;i<c.blocks;i++) {
      const block=await reader.get(this.dataCollection,`assign:${i}`)
      if(!object(block) || block.rosterHash!==c.hash || !Array.isArray(block.entries) || block.entries.length!==people.slice(i*BLOCK_SIZE,(i+1)*BLOCK_SIZE).length) consistent()
      const entries: Entry[]=[]
      for(let j=0;j<block.entries.length;j++) {
        const e=block.entries[j]
        if(!object(e) || e.id!==people[i*BLOCK_SIZE+j].id || !Number.isSafeInteger(e.version) || Number(e.version)<0 || (e.number!==null && (!Number.isSafeInteger(e.number) || Number(e.number)<1 || Number(e.number)>=c.nextNumber))) consistent()
        entries.push({id:String(e.id),version:Number(e.version),number:e.number as number|null})
      }
      blocks.push(entries)
    }
    return {control:c,people,blocks}
  }
  private snapshotOf(loaded: Loaded): ServiceSnapshot {
    const {control:c,people,blocks}=loaded
    const assignments: Record<string,number>=Object.create(null), versions: Record<string,number>=Object.create(null)
    for(const e of blocks.flat()) { versions[e.id]=e.version; if(e.number!==null) assignments[e.id]=e.number }
    // Ticket creation and counter advancement are atomic; issued tickets never delete.
    // Therefore historical issued numbers are exactly 1..nextNumber-1, including empties.
    return {people,state:{assignments,versions,issuedNumbers:Array.from({length:c.nextNumber-1},(_,i)=>i+1),nextNumber:c.nextNumber,revision:c.revision,batches:[]},roster:{version:c.version,hash:c.hash,count:c.count,demo:c.demo},generatedAt:new Date().toISOString()}
  }
  snapshot(): Promise<ServiceSnapshot> { return this.transaction(async tx=>this.snapshotOf(await this.load(tx)),true) }
  async revision(): Promise<RevisionInfo> {
    const c=await this.control(this.db)
    return {revision:c.revision,rosterHash:c.hash,generatedAt:new Date().toISOString()}
  }
  async initialize(input: unknown, version: string, count: number, demo: boolean) {
    if(count>MAX_PEOPLE) throw new ServiceError('ROSTER_LIMIT','此原型仅支持最多200位固定名单人员')
    const people=validateRoster(input,version,count), hash=rosterHash(people,version)
    if(demo && !people.every(p=>p.id.startsWith('demo-') && /^示例(学员|志工)\d{3}$/.test(p.name) && (p.company==='志工' || /^虚构企业\d{2}$/.test(p.company)))) throw new ServiceError('NOT_DEMO','示例导入拒绝真实人员')
    bounded({people,version,hash})
    return this.transaction(async tx=>{
      const old=await tx.get(this.dataCollection,'control')
      if(old!==null) {
        const c=controlValue(old)
        if(c.hash!==hash || c.version!==version || c.count!==count || c.demo!==demo) throw new ServiceError('ALREADY_INITIALIZED','已有其他名单，拒绝覆盖登记')
        await this.load(tx,c); return {reused:true,hash}
      }
      if(await tx.get(this.dataCollection,'catalog')!==null) throw new ServiceError('NOT_EMPTY','存在名单残留，拒绝初始化')
      const blocks=Math.ceil(count/BLOCK_SIZE)
      for(let i=0;i<blocks;i++) if(await tx.get(this.dataCollection,`assign:${i}`)!==null) throw new ServiceError('NOT_EMPTY','存在归属残留，拒绝初始化')
      const c: Control={schema:1,version,hash,count,demo,blocks,nextNumber:1,revision:0}
      await tx.set(this.dataCollection,'control',c)
      await tx.set(this.dataCollection,'catalog',{people,version,hash})
      for(let i=0;i<blocks;i++) await tx.set(this.dataCollection,`assign:${i}`,{rosterHash:hash,entries:people.slice(i*BLOCK_SIZE,(i+1)*BLOCK_SIZE).map(p=>({id:p.id,number:null,version:0}))})
      return {reused:false,hash}
    })
  }
  async mutate(input: unknown): Promise<MutationResponse> {
    const req=validateMutation(input)
    const payload=req.operation==='register' ? {...req,ids:[...req.ids].sort()} : req
    const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    return this.transaction(async tx=>{
      const c=await this.control(tx)
      const previous=await tx.get(this.requestsCollection,req.requestId)
      if(previous!==null) {
        if(!object(previous) || previous.payloadHash!==hash) throw new ServiceError('REQUEST_REUSED','同一请求标识不能用于不同操作')
        return {result:previous.result as RegistrationResult|null,snapshot:this.snapshotOf(await this.load(tx,c)),replayed:true}
      }
      if(c.hash!==req.rosterHash) throw new ServiceError('ROSTER_CHANGED','名单版本已变化，请刷新核对')
      // Writing the shared control document creates a DB write-conflict anchor.
      // This is neither a cloud-function memory lock nor a query-then-write race.
      c.revision++; await tx.set(this.dataCollection,'control',c)
      const loaded=await this.load(tx,c), entries=new Map(loaded.blocks.flat().map(e=>[e.id,e]))
      const ids=req.operation==='register' ? req.ids : [req.id]
      if(ids.some(id=>!entries.has(id))) throw new ServiceError('PERSON_NOT_FOUND','名单中不存在所选人员')
      const touched=new Set<number>(), changes:{id:string;from:number|null;to:number|null}[]=[]
      let result: RegistrationResult|null=null
      const touch=(id:string)=>touched.add(Math.floor(loaded.people.findIndex(p=>p.id===id)/BLOCK_SIZE))
      if(req.operation==='register') {
        const fresh=ids.filter(id=>entries.get(id)!.number===null)
        const existing=ids.filter(id=>entries.get(id)!.number!==null).map(id=>({id,number:entries.get(id)!.number!}))
        const number=fresh.length ? c.nextNumber : null
        if(number!==null) {
          if(number>999999) throw new ServiceError('NUMBER_LIMIT','号码已达到上限')
          const ticketId=`ticket:${number}`
          if(await tx.get(this.dataCollection,ticketId)!==null) consistent()
          await tx.set(this.dataCollection,ticketId,{number,requestId:req.requestId,createdAt:new Date().toISOString()})
          this.fault?.('after-ticket')
          for(const id of fresh) { const e=entries.get(id)!; e.number=number;e.version++;touch(id);changes.push({id,from:null,to:number}) }
          c.nextNumber++; await tx.set(this.dataCollection,'control',c)
        }
        result={number,newlyAssigned:fresh,existing}
      } else {
        const e=entries.get(req.id)!
        if(e.version!==req.expectedVersion) throw new ServiceError('ASSIGNMENT_CONFLICT','此人员已被其他窗口修改，请核对最新归属后再纠正')
        if(req.target!==null && (req.target>=c.nextNumber || await tx.get(this.dataCollection,`ticket:${req.target}`)===null)) throw new ServiceError('TICKET_NOT_FOUND','只能移入已发放号码')
        changes.push({id:req.id,from:e.number,to:req.target})
        if(e.number!==req.target) {e.number=req.target;e.version++;touch(req.id)}
      }
      for(const i of [...touched].sort((a,b)=>a-b)) await tx.set(this.dataCollection,`assign:${i}`,bounded({rosterHash:c.hash,entries:loaded.blocks[i]}))
      // The UUID document is both the immutable idempotency receipt and audit record.
      await tx.set(this.requestsCollection,req.requestId,bounded({payloadHash:hash,operation:req.operation,result,changes,createdAt:new Date().toISOString()}))
      return {result,snapshot:this.snapshotOf(loaded),replayed:false}
    })
  }
}
