export type ApiError = { error: string; message: string; remaining?: number; retryAfterSec?: number };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

export type ChallengeInfo = {
  challengeId: string;
  maskedEmail: string;
  expiresInSec: number;
  resendCooldownSec: number;
  remainingResends: number;
};
export type ResendInfo = Omit<ChallengeInfo, 'challengeId'>;
export type Session = { token: string; loginId: string; expiresAt: number };
export type Me = { loginId: string; expiresAt: number };
export type AdminUser = { loginId: string; mfaEmail: string; failureCount: number; locked: boolean; updatedAt: number };

async function request<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  try {
    // BASE_URL は vite の base（例 /mfa-sample/）。API は その下の api/ にある
    const response = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const json = (await response.json()) as T | ApiError;
    return response.ok ? { ok: true, data: json as T } : { ok: false, status: response.status, error: json as ApiError };
  } catch {
    return { ok: false, status: 0, error: { error: 'NETWORK_ERROR', message: '通信に失敗しました。時間をおいて再度お試しください。' } };
  }
}

export const api = {
  login: (loginId: string, password: string) => request<ChallengeInfo>('POST', '/login', { body: { loginId, password } }),
  verify: (challengeId: string, code: string) => request<Session>('POST', '/mfa/verify', { body: { challengeId, code } }),
  resend: (challengeId: string) => request<ResendInfo>('POST', '/mfa/resend', { body: { challengeId } }),
  me: (token: string) => request<Me>('GET', '/me', { headers: { 'x-session-token': token } }),
  listUsers: () => request<{ users: AdminUser[] }>('GET', '/admin/users'),
  saveUser: (user: { loginId: string; password: string; mfaEmail: string }) =>
    request<{ loginId: string; created: boolean }>('PUT', '/admin/users', { body: user }),
};
