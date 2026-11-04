export interface StorageUploadOptions {
  cacheControl?: string
  contentType?: string
  upsert?: boolean
}

export interface StorageListOptions {
  limit?: number
  offset?: number
  search?: string
  sortBy?: {
    column: string
    order?: 'asc' | 'desc'
  }
}

export interface StorageFileEntry {
  name: string
  id: string | null
  updatedAt: string | null
  createdAt: string | null
  lastAccessedAt: string | null
  metadata: Record<string, unknown> | null
}
