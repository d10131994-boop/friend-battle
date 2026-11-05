import { dataService } from './core/dataService'
import { invokeFunction } from './core/edgeFunctionService'
import { rpc } from './core/rpcService'
import { realtime } from './realtime/realtimeService'
import { storage } from './storage/storageService'

export const database = {
  ...dataService,
  rpc,
  invokeFunction,
  storage,
  realtime,
}

export { storage, realtime, invokeFunction, rpc }
export { createRepository } from './repositories/createRepository'
export type { TableRepository } from './repositories/createRepository'
export { DatabaseError } from './errors/DatabaseError'
export type { DatabaseErrorOptions } from './errors/DatabaseError'
export type {
  DatabaseId,
  DatabaseRecord,
  DatabaseTableName,
} from './types/database.types'
export type {
  DatabaseFilter,
  DatabaseOrder,
  FilterOperator,
  QueryOptions,
} from './types/query.types'
export type {
  StorageFileEntry,
  StorageListOptions,
  StorageUploadOptions,
} from './types/storage.types'
export type {
  RealtimeCallback,
  RealtimeEvent,
  RealtimeSubscriptionOptions,
  RealtimeSubscriptionStatus,
  RealtimeBroadcastCallback,
  RealtimeBroadcastOptions,
} from './realtime/realtimeService'
