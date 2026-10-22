import { Injectable } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AppConfig } from '../config/app-config.js';

/**
 * Local-disk artifact storage. Paths stored in the database are relative to
 * STORAGE_DIR, so the directory (or, later, an object store) can move freely.
 */
@Injectable()
export class ArtifactStorage {
  constructor(private readonly config: AppConfig) {}

  /** Relative path for a file produced by one test result. */
  resultFile(runId: string, resultId: string, fileName: string): string {
    return join('runs', runId, resultId, fileName);
  }

  /** Absolute path for a stored relative path; refuses anything outside the storage root. */
  absolute(relativePath: string): string {
    const root = this.config.storageDir;
    const absolutePath = resolve(root, relativePath);
    const rel = relative(root, absolutePath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Artifact path escapes the storage directory: ${relativePath}`);
    }
    return absolutePath;
  }

  async removeRuns(runIds: string[]): Promise<void> {
    await Promise.all(
      runIds.map((id) =>
        rm(this.absolute(join('runs', id)), { recursive: true, force: true }),
      ),
    );
  }
}
