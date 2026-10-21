import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { POLICY } from './policy';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SCRYPT_KEYLEN = 64;

/** パスワードを scrypt でハッシュ化する。形式: scrypt$<salt>$<hash>（base64url） */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = stored.split('$');
  if (algorithm !== 'scrypt' || saltText === undefined || hashText === undefined) {
    throw new Error('パスワードハッシュの形式が不正です');
  }
  const expected = Buffer.from(hashText, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(saltText, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** 6桁の認証コードを暗号論的に安全な乱数で作る */
export function generateCode(): string {
  return randomInt(0, 10 ** POLICY.codeDigits)
    .toString()
    .padStart(POLICY.codeDigits, '0');
}

/** 認証コードは平文で保存せず、チャレンジIDと結びつけた HMAC で保存する */
export function hashCode(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('base64url');
}

/** 長さに関係なく定数時間で比較する（ハッシュしてから比べる） */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

export type SessionPayload = { sub: string; exp: number };

/** HMAC 署名付きの簡易セッショントークン。形式: <payload>.<signature>（base64url） */
export function signToken(secret: string, payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyToken(secret: string, token: string, now: number): SessionPayload | null {
  const [body, signature] = token.split('.');
  if (body === undefined || signature === undefined) {
    return null;
  }
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || payload.exp <= now) {
    return null;
  }
  return payload;
}
