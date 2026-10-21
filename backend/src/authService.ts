import { randomUUID } from 'node:crypto';
import { generateCode, hashCode, hashPassword, safeEqual, signToken, verifyPassword, verifyToken } from './crypto';
import type { Mailer } from './mailer';
import { POLICY } from './policy';
import type { Db, DbStore } from './store';
import { maskEmail, parseLogin, parseResend, parseUser, parseVerify } from './validation';

export type ApiResponse = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>): ApiResponse => ({ status: 200, body });
const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}): ApiResponse => ({
  status,
  body: { error, message, ...extra },
});

const LOCKED = fail(423, 'LOCKED', 'アカウントがロックされています。管理者に連絡してください。');
const CHALLENGE_INVALID = fail(401, 'CHALLENGE_INVALID', '認証コードの有効期限が切れたか、無効になりました。ログインからやり直してください。');

function failedWithRemaining(message: string, remaining: number): ApiResponse {
  return fail(401, 'AUTH_FAILED', `${message}あと ${remaining} 回失敗するとアカウントがロックされます。`, { remaining });
}

/** 期限切れのチャレンジを掃除する（JSON が肥大化しないように） */
function purgeExpired(db: Db, now: number): void {
  for (const [id, challenge] of Object.entries(db.challenges)) {
    if (challenge.expiresAt <= now) {
      delete db.challenges[id];
    }
  }
}

function failureCount(db: Db, loginId: string): number {
  return db.failures[loginId]?.count ?? 0;
}

/** 失敗回数を1つ増やし、増やした後の回数を返す */
function addFailure(db: Db, loginId: string): number {
  const count = failureCount(db, loginId) + 1;
  db.failures[loginId] = { count };
  return count;
}

export class AuthService {
  /** 存在しないログインIDでも同じだけ時間をかけ、応答時間からIDの有無を推測させない */
  private readonly dummyHash: Promise<string> = hashPassword('dummy-password-for-timing');

  constructor(
    private readonly store: DbStore,
    private readonly mailer: Mailer,
    private readonly appSecret: string,
    private readonly adminKey: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** 1段目: ID・パスワードを照合し、成功したら認証コードをメールで送る */
  async login(body: unknown): Promise<ApiResponse> {
    const parsed = parseLogin(body);
    if (!parsed.ok) {
      return fail(400, 'BAD_REQUEST', parsed.errors.join(' '));
    }
    const { loginId, password } = parsed.value;

    // scrypt は重いので、競合時に何度もやり直す update の外で照合する
    const snapshot = await this.store.read();
    const userAtRead = snapshot.users[loginId];
    const passwordMatched = await verifyPassword(password, userAtRead?.passwordHash ?? (await this.dummyHash));

    const outcome = await this.store.update(db => {
      const now = this.now();
      purgeExpired(db, now);
      if (failureCount(db, loginId) >= POLICY.maxFailures) {
        return { kind: 'locked' } as const;
      }
      const user = db.users[loginId];
      // 照合後にパスワードが変わっていた場合も失敗扱いにする
      if (!passwordMatched || user === undefined || user.passwordHash !== userAtRead?.passwordHash) {
        const count = addFailure(db, loginId);
        return count >= POLICY.maxFailures ? ({ kind: 'locked' } as const) : ({ kind: 'failed', remaining: POLICY.maxFailures - count } as const);
      }
      // MFA 有効な今回は、パスワードが合っても失敗回数は消さない（MFA 成功時に消す）
      for (const [id, challenge] of Object.entries(db.challenges)) {
        if (challenge.loginId === loginId) {
          delete db.challenges[id];
        }
      }
      const challengeId = randomUUID();
      const code = generateCode();
      db.challenges[challengeId] = {
        loginId,
        codeHash: hashCode(this.appSecret, challengeId, code),
        expiresAt: now + POLICY.codeTtlMs,
        lastSentAt: now,
        sendCount: 1,
        attempts: 0,
      };
      return { kind: 'challenge', challengeId, code, email: user.mfaEmail } as const;
    });

    switch (outcome.kind) {
      case 'locked':
        return LOCKED;
      case 'failed':
        return failedWithRemaining('ログインIDまたはパスワードが正しくありません。', outcome.remaining);
      case 'challenge':
        await this.mailer.sendCode(outcome.email, outcome.code);
        return ok({
          challengeId: outcome.challengeId,
          maskedEmail: maskEmail(outcome.email),
          expiresInSec: POLICY.codeTtlMs / 1000,
          resendCooldownSec: POLICY.resendCooldownMs / 1000,
          remainingResends: POLICY.maxResends,
        });
    }
  }

  /** 2段目: 認証コードを検証し、成功したらセッショントークンを発行する */
  async verify(body: unknown): Promise<ApiResponse> {
    const parsed = parseVerify(body);
    if (!parsed.ok) {
      return fail(400, 'BAD_REQUEST', parsed.errors.join(' '));
    }
    const { challengeId, code } = parsed.value;

    const outcome = await this.store.update(db => {
      const now = this.now();
      purgeExpired(db, now);
      const challenge = db.challenges[challengeId];
      if (challenge === undefined) {
        return { kind: 'invalid' } as const;
      }
      const { loginId } = challenge;
      if (failureCount(db, loginId) >= POLICY.maxFailures) {
        delete db.challenges[challengeId];
        return { kind: 'locked' } as const;
      }
      if (safeEqual(challenge.codeHash, hashCode(this.appSecret, challengeId, code))) {
        delete db.challenges[challengeId];
        delete db.failures[loginId];
        return { kind: 'success', loginId, now } as const;
      }
      challenge.attempts += 1;
      const count = addFailure(db, loginId);
      if (count >= POLICY.maxFailures) {
        delete db.challenges[challengeId];
        return { kind: 'locked' } as const;
      }
      if (challenge.attempts >= POLICY.maxCodeAttempts) {
        delete db.challenges[challengeId];
        return { kind: 'invalid' } as const;
      }
      return { kind: 'failed', remaining: POLICY.maxFailures - count } as const;
    });

    switch (outcome.kind) {
      case 'invalid':
        return CHALLENGE_INVALID;
      case 'locked':
        return LOCKED;
      case 'failed':
        return failedWithRemaining('認証コードが正しくありません。', outcome.remaining);
      case 'success': {
        const exp = outcome.now + POLICY.sessionTtlMs;
        return ok({ token: signToken(this.appSecret, { sub: outcome.loginId, exp }), loginId: outcome.loginId, expiresAt: exp });
      }
    }
  }

  /** 認証コードの再送。古いコードは無効にし、待ち時間と回数の上限をかける */
  async resend(body: unknown): Promise<ApiResponse> {
    const parsed = parseResend(body);
    if (!parsed.ok) {
      return fail(400, 'BAD_REQUEST', parsed.errors.join(' '));
    }
    const { challengeId } = parsed.value;

    const outcome = await this.store.update(db => {
      const now = this.now();
      purgeExpired(db, now);
      const challenge = db.challenges[challengeId];
      const user = challenge === undefined ? undefined : db.users[challenge.loginId];
      if (challenge === undefined || user === undefined) {
        return { kind: 'invalid' } as const;
      }
      if (failureCount(db, challenge.loginId) >= POLICY.maxFailures) {
        delete db.challenges[challengeId];
        return { kind: 'locked' } as const;
      }
      const elapsed = now - challenge.lastSentAt;
      if (elapsed < POLICY.resendCooldownMs) {
        return { kind: 'cooldown', retryAfterSec: Math.ceil((POLICY.resendCooldownMs - elapsed) / 1000) } as const;
      }
      const resendsUsed = challenge.sendCount - 1;
      if (resendsUsed >= POLICY.maxResends) {
        return { kind: 'limit' } as const;
      }
      const code = generateCode();
      challenge.codeHash = hashCode(this.appSecret, challengeId, code);
      challenge.lastSentAt = now;
      challenge.expiresAt = now + POLICY.codeTtlMs;
      challenge.sendCount += 1;
      return { kind: 'sent', code, email: user.mfaEmail, remainingResends: POLICY.maxResends - (resendsUsed + 1) } as const;
    });

    switch (outcome.kind) {
      case 'invalid':
        return CHALLENGE_INVALID;
      case 'locked':
        return LOCKED;
      case 'cooldown':
        return fail(429, 'RESEND_COOLDOWN', `再送は ${outcome.retryAfterSec} 秒後にできます。`, { retryAfterSec: outcome.retryAfterSec });
      case 'limit':
        return fail(429, 'RESEND_LIMIT', '再送の上限に達しました。届いているコードを入力するか、ログインからやり直してください。');
      case 'sent':
        await this.mailer.sendCode(outcome.email, outcome.code);
        return ok({
          maskedEmail: maskEmail(outcome.email),
          expiresInSec: POLICY.codeTtlMs / 1000,
          resendCooldownSec: POLICY.resendCooldownMs / 1000,
          remainingResends: outcome.remainingResends,
        });
    }
  }

  /** セッショントークンの確認（ログイン後の画面で使う） */
  me(token: string | undefined): ApiResponse {
    const payload = token === undefined ? null : verifyToken(this.appSecret, token, this.now());
    if (payload === null) {
      return fail(401, 'UNAUTHENTICATED', 'ログインしてください。');
    }
    return ok({ loginId: payload.sub, expiresAt: payload.exp });
  }

  /** 管理: ユーザーの登録・更新。更新するとロックも解除される */
  async upsertUser(adminKey: string | undefined, body: unknown): Promise<ApiResponse> {
    if (!this.isAdmin(adminKey)) {
      return fail(403, 'FORBIDDEN', '管理用キーが正しくありません。');
    }
    const parsed = parseUser(body);
    if (!parsed.ok) {
      return fail(400, 'BAD_REQUEST', parsed.errors.join(' '));
    }
    const { loginId, password, mfaEmail } = parsed.value;
    const passwordHash = await hashPassword(password);

    const outcome = await this.store.update(db => {
      const duplicated = Object.entries(db.users).some(([id, user]) => id !== loginId && user.mfaEmail === mfaEmail);
      if (duplicated) {
        return { kind: 'duplicated' } as const;
      }
      const created = db.users[loginId] === undefined;
      db.users[loginId] = { passwordHash, mfaEmail, updatedAt: this.now() };
      delete db.failures[loginId];
      return { kind: 'saved', created } as const;
    });

    if (outcome.kind === 'duplicated') {
      return fail(409, 'DUPLICATED_EMAIL', 'このMFAメールアドレスは、ほかのユーザーで登録済みです。');
    }
    return ok({ loginId, created: outcome.created });
  }

  /** 管理: ユーザー一覧（ロック状態の確認用） */
  async listUsers(adminKey: string | undefined): Promise<ApiResponse> {
    if (!this.isAdmin(adminKey)) {
      return fail(403, 'FORBIDDEN', '管理用キーが正しくありません。');
    }
    const db = await this.store.read();
    const users = Object.entries(db.users)
      .map(([loginId, user]) => {
        const count = failureCount(db, loginId);
        return { loginId, mfaEmail: user.mfaEmail, failureCount: count, locked: count >= POLICY.maxFailures, updatedAt: user.updatedAt };
      })
      .sort((a, b) => a.loginId.localeCompare(b.loginId));
    return ok({ users });
  }

  private isAdmin(adminKey: string | undefined): boolean {
    return adminKey !== undefined && safeEqual(adminKey, this.adminKey);
  }
}
