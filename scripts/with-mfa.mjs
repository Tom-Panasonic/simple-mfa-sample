// MFA 必須の AWS アカウント向け: MFA 付きの一時認証情報を取得してから deploy / seed / destroy を実行する
// 使い方: node scripts/with-mfa.mjs <認証アプリの6桁> deploy [seed]
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, aws, loadEnv, run } from './lib.mjs';

const [code, ...tasks] = process.argv.slice(2);
const scriptByTask = { deploy: 'scripts/deploy.mjs', seed: 'scripts/seed-user.mjs', destroy: 'scripts/destroy.mjs' };
if (code === undefined || !/^\d{6}$/.test(code) || tasks.length === 0 || !tasks.every(task => task in scriptByTask)) {
  throw new Error('使い方: node scripts/with-mfa.mjs <6桁のコード> deploy|seed|destroy [...]');
}

const env = loadEnv(['AWS_PROFILE', 'AWS_REGION', 'MFA_SERIAL']);
const json = aws(env, ['sts', 'get-session-token', '--serial-number', env.MFA_SERIAL, '--token-code', code, '--duration-seconds', '3600', '--output', 'json'], {
  capture: true,
});
const { Credentials } = JSON.parse(json);
console.log(`MFA 付きの一時認証情報を取得しました（有効期限 ${Credentials.Expiration}）`);

const childEnv = {
  ...process.env,
  AWS_ACCESS_KEY_ID: Credentials.AccessKeyId,
  AWS_SECRET_ACCESS_KEY: Credentials.SecretAccessKey,
  AWS_SESSION_TOKEN: Credentials.SessionToken,
};

// 一時認証情報では --profile を付けないため、プロファイルに設定した CA 証明書（社内プロキシ用など）も
// 環境変数で引き継ぐ。Node の fetch（seed）にも同じ証明書を渡す
const caBundle = run('aws', ['configure', 'get', 'ca_bundle', '--profile', env.AWS_PROFILE], { capture: true, allowFailure: true })?.trim();
if (caBundle) {
  childEnv.AWS_CA_BUNDLE = caBundle;
  childEnv.NODE_EXTRA_CA_CERTS = caBundle;
  console.log(`プロファイルの CA 証明書を使います: ${caBundle}`);
}

// NODE_EXTRA_CA_CERTS は Node の起動時にしか読まれないので、各タスクは子プロセスで動かす
for (const task of tasks) {
  const result = spawnSync(process.execPath, [resolve(ROOT, scriptByTask[task])], { cwd: ROOT, env: childEnv, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${task} が失敗しました（終了コード ${result.status}）`);
  }
}
