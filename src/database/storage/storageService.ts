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

export const storage = {
  async upload(
    bucket: string,
    path: string,
    file: File | Blob,
    options: StorageUploadOptions = {},
  ): Promise<string> {
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
    return withStorageError(`storage.download:${bucket}/${path}`, async () => {
      const { data, error } = await supabaseClient.storage.from(bucket).download(path)
      if (error) throw error
      return data
    })
  },

  getPublicUrl(bucket: string, path: string): string {
    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  async createSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return withStorageError(`storage.createSignedUrl:${bucket}/${path}`, async () => {
      const { data, error } = await supabaseClient.storage
        .from(bucket)
        .createSignedUrl(path, expiresInSeconds)

      if (error) throw error
      return data.signedUrl
    })
  },

  async remove(bucket: string, paths: string[]): Promise<void> {
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
