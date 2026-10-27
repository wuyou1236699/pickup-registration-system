// Narrow application port. CloudBase operations below are always collection.doc(id).
export interface DocumentReader { get(collection: string, id: string): Promise<unknown | null> }
export interface DocumentTransaction extends DocumentReader {
  set(collection: string, id: string, data: object): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}
export interface DocumentDatabase extends DocumentReader { startTransaction(): Promise<DocumentTransaction> }
