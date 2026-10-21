// MFA 必須の AWS アカウント向け: MFA 付きの一時認証情報を取得してから deploy / seed / destroy を実行する
// 使い方: node scripts/with-mfa.mjs <認証アプリの6桁> deploy [seed]
import { aws, loadEnv } from './lib.mjs';

const [code, ...tasks] = process.argv.slice(2);
const allowedTasks = new Set(['deploy', 'seed', 'destroy']);
if (code === undefined || !/^\d{6}$/.test(code) || tasks.length === 0 || !tasks.every(task => allowedTasks.has(task))) {
  throw new Error('使い方: node scripts/with-mfa.mjs <6桁のコード> deploy|seed|destroy [...]');
}

const env = loadEnv(['AWS_PROFILE', 'AWS_REGION', 'MFA_SERIAL']);
const json = aws(env, ['sts', 'get-session-token', '--serial-number', env.MFA_SERIAL, '--token-code', code, '--duration-seconds', '3600', '--output', 'json'], {
  capture: true,
});
const { Credentials } = JSON.parse(json);
process.env.AWS_ACCESS_KEY_ID = Credentials.AccessKeyId;
process.env.AWS_SECRET_ACCESS_KEY = Credentials.SecretAccessKey;
process.env.AWS_SESSION_TOKEN = Credentials.SessionToken;
console.log(`MFA 付きの一時認証情報を取得しました（有効期限 ${Credentials.Expiration}）`);

const scriptByTask = { deploy: './deploy.mjs', seed: './seed-user.mjs', destroy: './destroy.mjs' };
for (const task of tasks) {
  await import(scriptByTask[task]);
}
