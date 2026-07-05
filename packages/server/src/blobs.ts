/**
 * Blob store with an S3-shaped interface. MVP backend: local disk under
 * CCOPT_DATA_DIR. Swapping in S3 later means implementing these three methods
 * against @aws-sdk/client-s3 — pointers in Postgres stay unchanged.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

export interface BlobStore {
  put(key: string, data: Buffer | string): Promise<string>;
  get(key: string): Promise<Buffer>;
}

export class DiskBlobStore implements BlobStore {
  constructor(private root: string) {}

  private resolve(key: string): string {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(normalize(this.root))) throw new Error(`invalid blob key: ${key}`);
    return p;
  }

  async put(key: string, data: Buffer | string): Promise<string> {
    const p = this.resolve(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFileSync(this.resolve(key));
  }
}
