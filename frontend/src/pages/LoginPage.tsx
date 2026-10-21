import { type FormEvent, useState } from 'react';
import { api, type ChallengeInfo } from '../api';

type Props = {
  notice?: string;
  onChallenge: (challenge: ChallengeInfo) => void;
};

export function LoginPage({ notice, onChallenge }: Props) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await api.login(loginId, password);
    setSubmitting(false);
    if (result.ok) {
      onChallenge(result.data);
    } else {
      setError(result.error.message);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h1>ログイン</h1>
      {notice !== undefined && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <label htmlFor="loginId">ログインID</label>
      <input id="loginId" value={loginId} onChange={e => setLoginId(e.target.value)} autoComplete="username" required />
      <label htmlFor="password">パスワード</label>
      <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? '確認中…' : 'ログイン'}
      </button>
    </form>
  );
}
