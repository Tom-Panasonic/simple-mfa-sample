import { useEffect, useState } from 'react';
import { api, type Me, type Session } from '../api';

type Props = {
  session: Session;
  onLogout: (notice?: string) => void;
};

export function HomePage({ session, onLogout }: Props) {
  const [me, setMe] = useState<Me | null>(null);

  // 表示のたびにサーバーでトークンを確かめる（期限切れならログインへ戻す）
  useEffect(() => {
    let active = true;
    void api.me(session.token).then(result => {
      if (!active) {
        return;
      }
      if (result.ok) {
        setMe(result.data);
      } else {
        onLogout('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
    });
    return () => {
      active = false;
    };
  }, [session.token, onLogout]);

  return (
    <div className="card">
      <h1>ログインしました</h1>
      {me === null ? (
        <p role="status">確認中…</p>
      ) : (
        <dl className="summary">
          <dt>ログインID</dt>
          <dd>{me.loginId}</dd>
          <dt>セッションの有効期限</dt>
          <dd>{new Date(me.expiresAt).toLocaleString('ja-JP')}</dd>
        </dl>
      )}
      <button type="button" onClick={() => onLogout()}>
        ログアウト
      </button>
    </div>
  );
}
