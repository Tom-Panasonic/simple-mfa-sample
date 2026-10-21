import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export type UserRecord = {
  passwordHash: string;
  mfaEmail: string;
  updatedAt: number;
};

export type FailureRecord = {
  count: number;
};

export type ChallengeRecord = {
  loginId: string;
  codeHash: string;
  expiresAt: number;
  lastSentAt: number;
  /** 初回送信を含む送信回数 */
  sendCount: number;
  attempts: number;
};

/** DB の代わりに S3 に置く JSON 1ファイルの中身 */
export type Db = {
  users: Record<string, UserRecord>;
  failures: Record<string, FailureRecord>;
  challenges: Record<string, ChallengeRecord>;
};

export function emptyDb(): Db {
  return { users: {}, failures: {}, challenges: {} };
}

export interface DbStore {
  read(): Promise<Db>;
  /** 読み込み → 変更 → 書き込みを1つの単位で行う。競合したら読み直して mutate をやり直す */
  update<T>(mutate: (db: Db) => T): Promise<T>;
}

const MAX_RETRIES = 5;

/**
 * S3 の条件付き書き込み（If-Match / If-None-Match）で楽観ロックをかけた JSON ストア。
 * Lambda が同時に動いても、後から書いた側が上書きして消すことはない。
 */
export class S3DbStore implements DbStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key = 'db.json',
  ) {}

  async read(): Promise<Db> {
    return (await this.load()).db;
  }

  async update<T>(mutate: (db: Db) => T): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const { db, etag } = await this.load();
      const result = mutate(db);
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.key,
            Body: JSON.stringify(db),
            ContentType: 'application/json',
            ...(etag === undefined ? { IfNoneMatch: '*' } : { IfMatch: etag }),
          }),
        );
        return result;
      } catch (error) {
        if (isWriteConflict(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error(`${this.key} の更新が ${MAX_RETRIES} 回競合しました`);
  }

  private async load(): Promise<{ db: Db; etag: string | undefined }> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key }));
      const text = await response.Body?.transformToString('utf-8');
      if (text === undefined) {
        throw new Error(`${this.key} の本文が空です`);
      }
      return { db: JSON.parse(text) as Db, etag: response.ETag };
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') {
        return { db: emptyDb(), etag: undefined };
      }
      throw error;
    }
  }
}

function isWriteConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  // 412: 条件不一致（他の書き込みが先に入った）、409: 同時の条件付き書き込みの衝突
  return status === 412 || status === 409;
}

/** テスト用のメモリ上のストア */
export class MemoryDbStore implements DbStore {
  private db: Db = emptyDb();

  async read(): Promise<Db> {
    return structuredClone(this.db);
  }

  async update<T>(mutate: (db: Db) => T): Promise<T> {
    const draft = structuredClone(this.db);
    const result = mutate(draft);
    this.db = draft;
    return result;
  }
}
