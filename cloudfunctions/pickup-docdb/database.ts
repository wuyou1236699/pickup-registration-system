import cloudbase from '@cloudbase/node-sdk'
import type { DocumentDatabase, DocumentReader, DocumentTransaction } from './port'
type NativeDb = ReturnType<ReturnType<typeof cloudbase.init>['database']>
type NativeTransaction = Awaited<ReturnType<NativeDb['startTransaction']>>
function checked(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('INVALID_DATABASE_RESPONSE')
  const res = value as Record<string,unknown>
  if (typeof res.code === 'string' && res.code) throw Object.assign(new Error('DATABASE_OPERATION_FAILED'),{code:res.code})
  return res
}
function reader(source: Pick<NativeDb,'collection'> | NativeTransaction): DocumentReader {
  return { async get(collection,id) {
    let raw: unknown
    try { raw = await source.collection(collection).doc(id).get() }
    catch (e) { if (e && typeof e==='object' && 'code' in e && e.code === 'DOCUMENT_NOT_FOUND') return null; throw e }
    if (raw && typeof raw==='object' && 'code' in raw && raw.code === 'DOCUMENT_NOT_FOUND') return null
    const res = checked(raw)
    // SDK 3.18.3 returns an object in transactions, an array outside transactions.
    if (Array.isArray(res.data)) {
      if (res.data.length>1) throw new Error('INVALID_DATABASE_RESPONSE')
      return res.data[0] ?? null
    }
    if (res.data === null || res.data === undefined) return null
    if (typeof res.data !== 'object') throw new Error('INVALID_DATABASE_RESPONSE')
    return res.data
  } }
}
export function adaptDatabase(db: NativeDb): DocumentDatabase {
  return { ...reader(db), async startTransaction(): Promise<DocumentTransaction> {
    const tx = await db.startTransaction()
    return { ...reader(tx), async set(collection,id,data) {
      // The pinned SDK set signature takes the document directly, NOT {data:...}.
      // get() includes _id, while DocumentReference.set rejects that field.
      // The ID is already supplied by doc(id); never write it as document data.
      const document: Record<string,unknown>={...data}
      delete document._id
      checked(await tx.collection(collection).doc(id).set(document))
    }, async commit() { checked(await tx.commit()) }, async rollback() { checked(await tx.rollback(undefined)) } }
  } }
}
export function createDocumentDatabase(): DocumentDatabase {
  const env = process.env.PICKUP_DOCDB_ENV
  if (!env) throw new Error('DOCUMENT_DATABASE_NOT_CONFIGURED')
  // Event functions use platform-injected temporary credentials. No browser secret.
  return adaptDatabase(cloudbase.init({env}).database())
}
