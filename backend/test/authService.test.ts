import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AuthService } from '../src/authService';
import type { Mailer } from '../src/mailer';
import { POLICY } from '../src/policy';
import { MemoryDbStore } from '../src/store';

const ADMIN_KEY = 'a'.repeat(40);
const APP_SECRET = 'b'.repeat(40);
const USER = { loginId: 'user@example.com', password: 'Passw0rdX', mfaEmail: 'User@Example.com' };

class FakeMailer implements Mailer {
  readonly sent: { to: string; code: string }[] = [];
  async sendCode(to: string, code: string): Promise<void> {
    this.sent.push({ to, code });
  }
  get lastCode(): string {
    const last = this.sent.at(-1);
    if (last === undefined) {
      throw new Error('メールが送られていません');
    }
    return last.code;
  }
}

/** 正解と必ず違う6桁を作る */
const wrongCode = (code: string): string => (code === '000000' ? '111111' : '000000');

describe('AuthService', () => {
  let now: number;
  let mailer: FakeMailer;
  let service: AuthService;

  beforeEach(async () => {
    now = Date.UTC(2026, 0, 1);
    mailer = new FakeMailer();
    service = new AuthService(new MemoryDbStore(), mailer, APP_SECRET, ADMIN_KEY, () => now);
    assert.equal((await service.upsertUser(ADMIN_KEY, USER)).status, 200);
  });

  const login = async (password = USER.password) => service.login({ loginId: USER.loginId, password });
  const startChallenge = async (): Promise<string> => {
    const res = await login();
    assert.equal(res.status, 200);
    return res.body.challengeId as string;
  };

  it('パスワードが合うと、小文字にそろえたMFAメールアドレスへ6桁のコードを送る', async () => {
    const res = await login();
    assert.equal(res.status, 200);
    assert.equal(res.body.maskedEmail, 'u***@example.com');
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0]?.to, 'user@example.com');
    assert.match(mailer.lastCode, /^\d{6}$/);
  });

  it('正しいコードでトークンが発行され、me で確認できる', async () => {
    const challengeId = await startChallenge();
    const res = await service.verify({ challengeId, code: mailer.lastCode });
    assert.equal(res.status, 200);
    const me = service.me(res.body.token as string);
    assert.equal(me.status, 200);
    assert.equal(me.body.loginId, USER.loginId);
  });

  it('コードは1回しか使えない', async () => {
    const challengeId = await startChallenge();
    const code = mailer.lastCode;
    assert.equal((await service.verify({ challengeId, code })).status, 200);
    assert.equal((await service.verify({ challengeId, code })).body.error, 'CHALLENGE_INVALID');
  });

  it('有効期限を過ぎたコードは使えない', async () => {
    const challengeId = await startChallenge();
    now += POLICY.codeTtlMs;
    assert.equal((await service.verify({ challengeId, code: mailer.lastCode })).body.error, 'CHALLENGE_INVALID');
  });

  it('パスワード誤りでは残り回数を返し、存在しないIDでも同じ応答になる', async () => {
    const wrong = await login('WrongPass1');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.remaining, POLICY.maxFailures - 1);
    const unknown = await service.login({ loginId: 'nobody@example.com', password: 'WrongPass1' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.remaining, POLICY.maxFailures - 1);
  });

  it('パスワード成功だけでは失敗回数は消えず、MFA 成功で消える', async () => {
    await login('WrongPass1');
    const challengeId = await startChallenge();
    const failed = await service.verify({ challengeId, code: wrongCode(mailer.lastCode) });
    assert.equal(failed.body.remaining, POLICY.maxFailures - 2);
    assert.equal((await service.verify({ challengeId, code: mailer.lastCode })).status, 200);
    assert.equal((await login('WrongPass1')).body.remaining, POLICY.maxFailures - 1);
  });

  it('パスワードとコードの失敗が合計10回でロックされ、正しいパスワードでも入れない', async () => {
    for (let i = 0; i < 5; i++) {
      await login('WrongPass1');
    }
    // 1つのコードで試せるのは5回まで。5回目で失敗10回に達してロック
    const challengeId = await startChallenge();
    for (let i = 0; i < 4; i++) {
      assert.equal((await service.verify({ challengeId, code: wrongCode(mailer.lastCode) })).status, 401);
    }
    assert.equal((await service.verify({ challengeId, code: wrongCode(mailer.lastCode) })).status, 423);
    assert.equal((await login()).status, 423);
  });

  it('1つのコードで5回間違えると、そのコードは無効になる', async () => {
    const challengeId = await startChallenge();
    const code = mailer.lastCode;
    for (let i = 0; i < POLICY.maxCodeAttempts - 1; i++) {
      assert.equal((await service.verify({ challengeId, code: wrongCode(code) })).body.error, 'AUTH_FAILED');
    }
    assert.equal((await service.verify({ challengeId, code: wrongCode(code) })).body.error, 'CHALLENGE_INVALID');
    assert.equal((await service.verify({ challengeId, code })).body.error, 'CHALLENGE_INVALID');
  });

  it('再送は60秒待つ必要があり、再送すると古いコードは無効になる', async () => {
    const challengeId = await startChallenge();
    const firstCode = mailer.lastCode;

    const tooEarly = await service.resend({ challengeId });
    assert.equal(tooEarly.status, 429);
    assert.equal(tooEarly.body.retryAfterSec, 60);

    now += POLICY.resendCooldownMs;
    const resent = await service.resend({ challengeId });
    assert.equal(resent.status, 200);
    assert.equal(resent.body.remainingResends, POLICY.maxResends - 1);
    assert.equal(mailer.sent.length, 2);

    if (firstCode !== mailer.lastCode) {
      assert.equal((await service.verify({ challengeId, code: firstCode })).body.error, 'AUTH_FAILED');
    }
    assert.equal((await service.verify({ challengeId, code: mailer.lastCode })).status, 200);
  });

  it('再送は5回まで', async () => {
    const challengeId = await startChallenge();
    for (let i = 0; i < POLICY.maxResends; i++) {
      now += POLICY.resendCooldownMs;
      assert.equal((await service.resend({ challengeId })).status, 200);
    }
    now += POLICY.resendCooldownMs;
    assert.equal((await service.resend({ challengeId })).body.error, 'RESEND_LIMIT');
  });

  it('MFAメールアドレスは大文字・小文字を区別せずシステム全体で一意', async () => {
    const res = await service.upsertUser(ADMIN_KEY, { loginId: 'other-user', password: 'Passw0rdY', mfaEmail: 'USER@example.com' });
    assert.equal(res.status, 409);
  });

  it('ユーザーを更新するとロックが解除される', async () => {
    for (let i = 0; i < POLICY.maxFailures; i++) {
      await login('WrongPass1');
    }
    assert.equal((await login()).status, 423);
    await service.upsertUser(ADMIN_KEY, USER);
    assert.equal((await login()).status, 200);
  });

  it('管理用キーが違うと登録・一覧はできない', async () => {
    assert.equal((await service.upsertUser('x'.repeat(40), USER)).status, 403);
    assert.equal((await service.listUsers(undefined)).status, 403);
  });

  it('パスワードの形式チェック', async () => {
    assert.equal((await service.upsertUser(ADMIN_KEY, { ...USER, password: 'short1A' })).status, 400);
  });

  it('改ざん・期限切れのトークンは拒否する', async () => {
    const challengeId = await startChallenge();
    const token = (await service.verify({ challengeId, code: mailer.lastCode })).body.token as string;
    assert.equal(service.me(`${token}x`).status, 401);
    now += POLICY.sessionTtlMs;
    assert.equal(service.me(token).status, 401);
  });
});
