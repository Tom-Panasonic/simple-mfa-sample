const LOGIN_ID_REGEX = /^[\x21-\x7e]{5,80}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_REGEX = /^\d{6}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type LoginInput = { loginId: string; password: string };
export type VerifyInput = { challengeId: string; code: string };
export type ResendInput = { challengeId: string };
export type UserInput = { loginId: string; password: string; mfaEmail: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function field(body: unknown, name: string): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

export function parseLogin(body: unknown): Parsed<LoginInput> {
  const loginId = field(body, 'loginId');
  const password = field(body, 'password');
  if (loginId === undefined || loginId === '' || password === undefined || password === '') {
    return { ok: false, errors: ['ログインIDとパスワードを入力してください。'] };
  }
  return { ok: true, value: { loginId, password } };
}

export function parseVerify(body: unknown): Parsed<VerifyInput> {
  const challengeId = field(body, 'challengeId');
  const code = field(body, 'code');
  if (challengeId === undefined || !UUID_REGEX.test(challengeId)) {
    return { ok: false, errors: ['ログインからやり直してください。'] };
  }
  if (code === undefined || !CODE_REGEX.test(code)) {
    return { ok: false, errors: ['認証コードは6桁の数字で入力してください。'] };
  }
  return { ok: true, value: { challengeId, code } };
}

export function parseResend(body: unknown): Parsed<ResendInput> {
  const challengeId = field(body, 'challengeId');
  if (challengeId === undefined || !UUID_REGEX.test(challengeId)) {
    return { ok: false, errors: ['ログインからやり直してください。'] };
  }
  return { ok: true, value: { challengeId } };
}

/** MFAメールアドレスは大文字・小文字の違いで重複登録できないよう、小文字にそろえて保存する */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseUser(body: unknown): Parsed<UserInput> {
  const loginId = field(body, 'loginId') ?? '';
  const password = field(body, 'password') ?? '';
  const mfaEmail = normalizeEmail(field(body, 'mfaEmail') ?? '');
  const errors: string[] = [];

  if (!LOGIN_ID_REGEX.test(loginId)) {
    errors.push('ログインIDは半角英数字記号で5〜80文字にしてください。');
  }
  if (password.length < 8 || password.length > 64) {
    errors.push('パスワードは8〜64文字にしてください。');
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    errors.push('パスワードは英大文字・英小文字・数字をそれぞれ1文字以上含めてください。');
  }
  if (mfaEmail.length > 254 || !EMAIL_REGEX.test(mfaEmail)) {
    errors.push('MFAメールアドレスの形式が正しくありません。');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { loginId, password, mfaEmail } };
}

/** 画面に出す送信先は伏せ字にする（例: t***@example.com） */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (local === undefined || domain === undefined) {
    throw new Error('メールアドレスの形式が不正です');
  }
  return `${local.slice(0, 1)}***@${domain}`;
}
