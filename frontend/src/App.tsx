import { useCallback, useEffect, useState } from 'react';
import type { ChallengeInfo, Session } from './api';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MfaPage } from './pages/MfaPage';

const SESSION_KEY = 'simple-mfa-session';

type Step = { kind: 'login'; notice?: string } | { kind: 'mfa'; challenge: ChallengeInfo } | { kind: 'home'; session: Session };

function loadSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw === null ? null : (JSON.parse(raw) as Session);
}

/** 画面は3つ（ログイン → 認証コード → ログイン後）と管理画面だけなので、ルーターは使わずハッシュで切り替える */
export function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [step, setStep] = useState<Step>(() => {
    const session = loadSession();
    return session === null ? { kind: 'login' } : { kind: 'home', session };
  });

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // HomePage の useEffect の依存になるので、再描画のたびに作り直さない
  const logout = useCallback((notice?: string) => {
    sessionStorage.removeItem(SESSION_KEY);
    setStep({ kind: 'login', notice });
  }, []);

  return (
    <div className="layout">
      <header className="header">
        <span className="brand">Simple MFA Sample</span>
        <nav>
          <a href="#/">ログイン</a>
          <a href="#/admin">ユーザー登録</a>
        </nav>
      </header>
      <main className="main">
        {hash === '#/admin' ? (
          <AdminPage />
        ) : step.kind === 'login' ? (
          <LoginPage notice={step.notice} onChallenge={challenge => setStep({ kind: 'mfa', challenge })} />
        ) : step.kind === 'mfa' ? (
          <MfaPage
            challenge={step.challenge}
            onSuccess={session => {
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
              setStep({ kind: 'home', session });
            }}
            onRestart={notice => setStep({ kind: 'login', notice })}
          />
        ) : (
          <HomePage session={step.session} onLogout={logout} />
        )}
      </main>
    </div>
  );
}
