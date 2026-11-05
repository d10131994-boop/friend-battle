import { supabaseClient } from '../client/supabaseClient'
import { normalizeDatabaseError } from '../errors/normalizeError'
import type {
  StorageFileEntry,
  StorageListOptions,
  StorageUploadOptions,
} from '../types/storage.types'

function withStorageError<T>(operation: string, action: () => Promise<T>): Promise<T> {
  return action().catch((error: unknown) => {
    throw normalizeDatabaseError(error, operation)
  })
}

function validateBucketAndPath(bucket: string, path?: string): void {
  if (typeof bucket !== 'string' || bucket.trim().length === 0) {
    throw new TypeError('Storage bucket name must be a non-empty string.')
  }

  if (path !== undefined && (typeof path !== 'string' || path.trim().length === 0)) {
    throw new TypeError('Storage path must be a non-empty string.')
  }
}

function validateStoragePagination(options: StorageListOptions): void {
  if (options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) || options.limit < 0)) {
    throw new RangeError('Storage list limit must be a non-negative safe integer.')
  }

  if (options.offset !== undefined &&
    (!Number.isSafeInteger(options.offset) || options.offset < 0)) {
    throw new RangeError('Storage list offset must be a non-negative safe integer.')
  }
}

export const storage = {
  async upload(
    bucket: string,
    path: string,
    file: File | Blob,
    options: StorageUploadOptions = {},
  ): Promise<string> {
    validateBucketAndPath(bucket, path)
    return withStorageError(`storage.upload:${bucket}/${path}`, async () => {
      const { data, error } = await supabaseClient.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: options.cacheControl,
          contentType: options.contentType,
          upsert: options.upsert ?? false,
        })

      if (error) throw error
      return data.path
    })
  },

  async download(bucket: string, path: string): Promise<Blob> {
    validateBucketAndPath(bucket, path)
    return withStorageError(`storage.download:${bucket}/${path}`, async () => {
      const { data, error } = await supabaseClient.storage.from(bucket).download(path)
      if (error) throw error
      return data
    })
  },

  getPublicUrl(bucket: string, path: string): string {
    validateBucketAndPath(bucket, path)
    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  async createSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string> {
    validateBucketAndPath(bucket, path)
    if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new RangeError('Signed URL expiration must be a positive safe integer.')
    }

    return withStorageError(`storage.createSignedUrl:${bucket}/${path}`, async () => {
      const { data, error } = await supabaseClient.storage
        .from(bucket)
        .createSignedUrl(path, expiresInSeconds)

      if (error) throw error
      return data.signedUrl
    })
  },

  async remove(bucket: string, paths: string[]): Promise<void> {
    validateBucketAndPath(bucket)
    if (!Array.isArray(paths) || paths.length === 0 ||
      paths.some((path) => typeof path !== 'string' || path.trim().length === 0)) {
      throw new TypeError('Storage remove requires a non-empty list of valid paths.')
    }

    return withStorageError(`storage.remove:${bucket}`, async () => {
      const { error } = await supabaseClient.storage.from(bucket).remove(paths)
      if (error) throw error
    })
  },

  async list(
    bucket: string,
    folder = '',
    options: StorageListOptions = {},
  ): Promise<StorageFileEntry[]> {
    validateBucketAndPath(bucket)
    validateStoragePagination(options)
    if (folder.length > 0 && folder.trim().length === 0) {
      throw new TypeError('Storage folder must be a valid path when provided.')
    }

    return withStorageError(`storage.list:${bucket}/${folder}`, async () => {
      const { data, error } = await supabaseClient.storage.from(bucket).list(folder, {
        limit: options.limit,
        offset: options.offset,
        search: options.search,
        sortBy: options.sortBy,
      })

      if (error) throw error

      return (data ?? []).map((file) => ({
        name: file.name,
        id: file.id,
        updatedAt: file.updated_at,
        createdAt: file.created_at,
        lastAccessedAt: file.last_accessed_at,
        metadata: file.metadata as Record<string, unknown> | null,
      }))
    })
  },
}
