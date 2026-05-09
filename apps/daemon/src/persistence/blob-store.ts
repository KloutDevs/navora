/**
 * BlobStore - File-based cache for screenshots and DOM snapshots
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import type { Logger } from "@navora/shared";
import { ok, err, type Result } from "@navora/shared";

export type BlobKind = "screenshot" | "dom_snapshot" | "console_logs" | "network_logs";

export interface BlobMetadata {
  id: string;
  kind: BlobKind;
  profileId: string;
  toolCallId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: Date;
  expiresAt: string;
}

export interface BlobStore {
  /**
   * Write a blob to the store
   */
  write(
    data: Buffer,
    kind: BlobKind,
    options: {
      profileId: string;
      toolCallId?: string;
      mimeType: string;
      expiresInMs?: number;
    }
  ): Result<BlobMetadata, Error>;

  /**
   * Read a blob from the store
   */
  read(id: string): Result<Buffer, Error>;

  /**
   * Get blob metadata
   */
  getMetadata(id: string): Result<BlobMetadata, Error>;

  /**
   * Delete a blob from the store
   */
  delete(id: string): Result<void, Error>;

  /**
   * Delete all expired blobs
   */
  deleteExpired(): Result<number, Error>;

  /**
   * List all blobs for a profile
   */
  listForProfile(profileId: string, limit?: number): Result<BlobMetadata[], Error>;

  /**
   * Close the store and release resources
   */
  close(): void;
}

interface BlobStoreOptions {
  basePath: string;
  logger?: Logger;
}

/**
 * Create a no-op logger for cases when no logger is provided
 */
export function createNoOpLogger(): Logger {
  const noOpLogger: Logger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => noOpLogger,
  };
  return noOpLogger;
}

/**
 * Create a new BlobStore instance
 */
export function createBlobStore(options: BlobStoreOptions): BlobStore {
  const { basePath, logger = createNoOpLogger() } = options;

  // Ensure base directory exists
  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  // Calculate SHA256 hash of blob data
  function computeSha256(data: Buffer): string {
    return createHash("sha256").update(data).digest("hex");
  }

  // Get the directory for a profile
  function getProfileDir(profileId: string): string {
    return join(basePath, profileId);
  }

  // Get the full file path for a blob
  function getBlobPath(profileId: string, filename: string): string {
    const dir = getProfileDir(profileId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return join(dir, filename);
  }

  // Read metadata from JSON sidecar file
  function readMetadata(profileId: string, blobId: string): BlobMetadata | null {
    const metaPath = join(getProfileDir(profileId), `${blobId}.meta.json`);
    if (!existsSync(metaPath)) {
      return null;
    }
    try {
      const content = readFileSync(metaPath, "utf-8");
      const meta = JSON.parse(content);
      return {
        ...meta,
        createdAt: new Date(meta.createdAt),
        expiresAt: meta.expiresAt ? new Date(meta.expiresAt) : undefined,
      };
    } catch {
      return null;
    }
  }

  // Write metadata to JSON sidecar file
  function writeMetadata(profileId: string, meta: BlobMetadata): void {
    const metaPath = join(getProfileDir(profileId), `${meta.id}.meta.json`);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  // Delete metadata file
  function deleteMetadata(profileId: string, blobId: string): void {
    const metaPath = join(getProfileDir(profileId), `${blobId}.meta.json`);
    if (existsSync(metaPath)) {
      unlinkSync(metaPath);
    }
  }

  return {
    write(data, kind, opts): Result<BlobMetadata, Error> {
      try {
        const id = generateId();
        const filename = `${id}${getExtensionForMimeType(opts.mimeType)}`;
        const sha256 = computeSha256(data);
        const byteSize = data.length;
        const createdAt = new Date();
        const expiresAt = opts.expiresInMs
          ? new Date(createdAt.getTime() + opts.expiresInMs).toISOString()
          : "";

        const metadata: BlobMetadata = {
          id,
          kind,
          profileId: opts.profileId,
          toolCallId: opts.toolCallId ?? "",
          filename,
          mimeType: opts.mimeType,
          byteSize,
          sha256,
          createdAt: createdAt,
          expiresAt: expiresAt,
        };

        // Write the blob file
        const blobPath = getBlobPath(opts.profileId, filename);
        writeFileSync(blobPath, data);

        // Write the metadata sidecar
        writeMetadata(opts.profileId, metadata);

        logger.debug(`BlobStore: wrote ${id} (${byteSize} bytes)`);
        return ok(metadata);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger?.error?.(`BlobStore: write failed - ${errMsg}`);
        return err(error instanceof Error ? error : new Error(errMsg));
      }
    },

    read(id): Result<Buffer, Error> {
      try {
        // We need the profileId from metadata - this requires scanning
        // For now, scan all profile directories
        const profileDirs = existsSync(basePath)
          ? readdirSync(basePath).filter((d) => statSync(join(basePath, d)).isDirectory())
          : [];

        for (const profileId of profileDirs) {
          const meta = readMetadata(profileId, id);
          if (meta) {
            const blobPath = getBlobPath(profileId, meta.filename);
            if (existsSync(blobPath)) {
              const data = readFileSync(blobPath);
              logger.debug?.(`BlobStore: read ${id}`);
              return ok(data);
            }
          }
        }

        logger?.warn?.(`BlobStore: blob not found ${id}`);
        return err(new Error(`Blob not found: ${id}`));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger?.error?.(`BlobStore: read failed - ${errMsg}`);
        return err(error instanceof Error ? error : new Error(errMsg));
      }
    },

    getMetadata(id): Result<BlobMetadata, Error> {
      try {
        const profileDirs = existsSync(basePath)
          ? readdirSync(basePath).filter((d) => statSync(join(basePath, d)).isDirectory())
          : [];

        for (const profileId of profileDirs) {
          const meta = readMetadata(profileId, id);
          if (meta) {
            return ok(meta);
          }
        }

        return err(new Error(`Metadata not found: ${id}`));
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },

    delete(id): Result<void, Error> {
      try {
        const profileDirs = existsSync(basePath)
          ? readdirSync(basePath).filter((d) => statSync(join(basePath, d)).isDirectory())
          : [];

        let deleted = false;
        for (const profileId of profileDirs) {
          const meta = readMetadata(profileId, id);
          if (meta) {
            const blobPath = getBlobPath(profileId, meta.filename);
            if (existsSync(blobPath)) {
              unlinkSync(blobPath);
            }
            deleteMetadata(profileId, id);
            deleted = true;
            logger.debug?.(`BlobStore: deleted ${id}`);
            break;
          }
        }

        return deleted ? ok(undefined) : err(new Error(`Blob not found: ${id}`));
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },

    deleteExpired(): Result<number, Error> {
      try {
        let deletedCount = 0;
        const now = new Date();

        const profileDirs = existsSync(basePath)
          ? readdirSync(basePath).filter((d) => statSync(join(basePath, d)).isDirectory())
          : [];

        for (const profileId of profileDirs) {
          const metaFiles = readdirSync(getProfileDir(profileId)).filter(
            (f) => f.endsWith(".meta.json")
          );

          for (const metaFile of metaFiles) {
            const blobId = metaFile.replace(".meta.json", "");
            const meta = readMetadata(profileId, blobId);
            if (meta?.expiresAt && new Date(meta.expiresAt) <= now) {
              const blobPath = getBlobPath(profileId, meta.filename);
              if (existsSync(blobPath)) {
                unlinkSync(blobPath);
              }
              deleteMetadata(profileId, blobId);
              deletedCount++;
            }
          }
        }

        logger.debug?.(`BlobStore: deleted ${deletedCount} expired blobs`);
        return ok(deletedCount);
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },

    listForProfile(profileId, limit = 100): Result<BlobMetadata[], Error> {
      try {
        const dir = getProfileDir(profileId);
        if (!existsSync(dir)) {
          return ok([]);
        }

        const metaFiles = readdirSync(dir).filter((f) => f.endsWith(".meta.json"));
        const results: BlobMetadata[] = [];

        for (const metaFile of metaFiles) {
          const blobId = metaFile.replace(".meta.json", "");
          const meta = readMetadata(profileId, blobId);
          if (meta) {
            results.push(meta);
          }
          if (limit && results.length >= limit) {
            break;
          }
        }

        return ok(results.slice(0, limit));
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },

    close(): void {
      logger.debug?.("BlobStore: closed");
    },
  };
}

// ULID-like ID generator (simplified)
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}${random}`;
}

// Get file extension for MIME type
function getExtensionForMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "text/html": ".html",
    "application/json": ".json",
    "text/plain": ".txt",
  };
  return mimeToExt[mimeType] || ".bin";
}