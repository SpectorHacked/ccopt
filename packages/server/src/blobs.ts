/**
 * Blob store. Two backends behind one interface:
 *  - DiskBlobStore — local dev / single-box installs (CCOPT_DATA_DIR)
 *  - S3BlobStore  — any S3-compatible service: Cloudflare R2, Backblaze B2,
 *    AWS S3, MinIO. Pointers in Postgres are backend-agnostic keys.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface BlobStore {
  put(key: string, data: Buffer | string): Promise<string>;
  get(key: string): Promise<Buffer>;
}

export interface S3Settings {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3BlobStore implements BlobStore {
  private client: S3Client;

  constructor(private settings: S3Settings) {
    this.client = new S3Client({
      region: settings.region,
      ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer | string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: typeof data === 'string' ? Buffer.from(data) : data,
      }),
    );
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`empty blob: ${key}`);
    return Buffer.from(bytes);
  }
}

/** Pick the backend from env: S3 when CCOPT_S3_BUCKET is set, disk otherwise. */
export function createBlobStore(env: NodeJS.ProcessEnv, dataDir: string): BlobStore {
  if (env.CCOPT_S3_BUCKET) {
    const accessKeyId = env.CCOPT_S3_ACCESS_KEY_ID;
    const secretAccessKey = env.CCOPT_S3_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('CCOPT_S3_BUCKET is set but CCOPT_S3_ACCESS_KEY_ID / CCOPT_S3_SECRET_ACCESS_KEY are missing');
    }
    return new S3BlobStore({
      endpoint: env.CCOPT_S3_ENDPOINT,
      region: env.CCOPT_S3_REGION ?? 'auto',
      bucket: env.CCOPT_S3_BUCKET,
      accessKeyId,
      secretAccessKey,
    });
  }
  return new DiskBlobStore(dataDir);
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
