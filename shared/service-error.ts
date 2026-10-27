export class ServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly uncertain = false) { super(message) }
}
