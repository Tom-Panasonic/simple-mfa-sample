import { type FormEvent, useState } from 'react';
import { api, type AdminUser } from '../api';

/** ログインID・パスワード・MFAメールアドレスの登録画面（サンプルのため誰でも使える） */
export function AdminPage() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [mfaEmail, setMfaEmail] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = async () => {
    setError(null);
    const result = await api.listUsers();
    if (result.ok) {
      setUsers(result.data.users);
    } else {
      setUsers(null);
      setError(result.error.message);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    const result = await api.saveUser({ loginId, password, mfaEmail });
    setSubmitting(false);
    if (result.ok) {
      setInfo(result.data.created ? `${result.data.loginId} を登録しました。` : `${result.data.loginId} を更新しました（ロックも解除しました）。`);
      setPassword('');
      await loadUsers();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <h1>ユーザー登録</h1>
        <p className="hint">同じログインIDで登録すると更新になり、ロックも解除されます。</p>
        <label htmlFor="newLoginId">ログインID</label>
        <input id="newLoginId" value={loginId} onChange={e => setLoginId(e.target.value)} autoComplete="off" required />
        <label htmlFor="newPassword">パスワード（8文字以上、英大文字・英小文字・数字を含む）</label>
        <input id="newPassword" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required />
        <label htmlFor="mfaEmail">MFAメールアドレス（ほかのユーザーと重複不可）</label>
        <input id="mfaEmail" type="email" value={mfaEmail} onChange={e => setMfaEmail(e.target.value)} autoComplete="off" required />
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
        <button type="submit" disabled={submitting}>
          {submitting ? '保存中…' : '登録・更新'}
        </button>
        <button type="button" className="secondary" onClick={loadUsers}>
          登録済みユーザーを表示
        </button>
      </form>

      {users !== null && (
        <div className="card wide">
          <h2>登録済みユーザー</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">ログインID</th>
                <th scope="col">MFAメールアドレス</th>
                <th scope="col">失敗回数</th>
                <th scope="col">状態</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.loginId}>
                  <td>{user.loginId}</td>
                  <td>{user.mfaEmail}</td>
                  <td>{user.failureCount}</td>
                  <td className={user.locked ? 'error' : undefined}>{user.locked ? 'ロック中' : '利用可'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
