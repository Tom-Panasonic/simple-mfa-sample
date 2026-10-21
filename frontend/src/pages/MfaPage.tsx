import { type FormEvent, useEffect, useState } from 'react';
import { api, type ChallengeInfo, type Session } from '../api';

type Props = {
  challenge: ChallengeInfo;
  onSuccess: (session: Session) => void;
  onRestart: (notice: string) => void;
};

/** 認証コードを入力し直す必要がなく、ログインからやり直すべきエラー */
const RESTART_ERRORS = new Set(['CHALLENGE_INVALID', 'LOCKED']);

export function MfaPage({ challenge, onSuccess, onRestart }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(challenge.resendCooldownSec);
  const [remainingResends, setRemainingResends] = useState(challenge.remainingResends);
  const [maskedEmail, setMaskedEmail] = useState(challenge.maskedEmail);

  // 再送ボタンの残り秒数を1秒ごとに減らす
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCooldown(sec => sec - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    const result = await api.verify(challenge.challengeId, code);
    setSubmitting(false);
    if (result.ok) {
      onSuccess(result.data);
    } else if (RESTART_ERRORS.has(result.error.error)) {
      onRestart(result.error.message);
    } else {
      setError(result.error.message);
      setCode('');
    }
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    const result = await api.resend(challenge.challengeId);
    if (result.ok) {
      setCooldown(result.data.resendCooldownSec);
      setRemainingResends(result.data.remainingResends);
      setMaskedEmail(result.data.maskedEmail);
      setInfo('認証コードを再送しました。前のコードは使えません。');
      setCode('');
    } else if (RESTART_ERRORS.has(result.error.error)) {
      onRestart(result.error.message);
    } else {
      if (result.error.retryAfterSec !== undefined) {
        setCooldown(result.error.retryAfterSec);
      }
      if (result.error.error === 'RESEND_LIMIT') {
        setRemainingResends(0);
      }
      setError(result.error.message);
    }
  };

  const resendLabel = remainingResends <= 0 ? '再送の上限に達しました' : cooldown > 0 ? `再送できるまで ${cooldown} 秒` : `認証コードを再送（残り ${remainingResends} 回）`;

  return (
    <form className="card" onSubmit={submit}>
      <h1>認証コードの入力</h1>
      <p>
        <strong>{maskedEmail}</strong> に6桁の認証コードを送りました。有効期限は{challenge.expiresInSec / 60}分です。
      </p>
      <label htmlFor="code">認証コード</label>
      <input
        id="code"
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        required
      />
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {info !== null && (
        <p className="notice" role="status">
          {info}
        </p>
      )}
      <button type="submit" disabled={submitting || code.length !== 6}>
        {submitting ? '確認中…' : '認証する'}
      </button>
      <button type="button" className="secondary" onClick={resend} disabled={cooldown > 0 || remainingResends <= 0}>
        {resendLabel}
      </button>
      <button type="button" className="link" onClick={() => onRestart('ログインからやり直してください。')}>
        ログイン画面に戻る
      </button>
    </form>
  );
}
