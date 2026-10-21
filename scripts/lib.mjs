// デプロイ用スクリプトの共通処理（追加の依存を増やさないよう Node 標準だけで書く）
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');

/** deploy / destroy に必要な .env のキー */
export const DEPLOY_KEYS = [
  'AWS_PROFILE',
  'AWS_REGION',
  'STACK_NAME',
  'MAIL_FROM',
  'APP_SECRET',
  'DISTRIBUTION_ID',
  'ORIGIN_ACCESS_CONTROL_ID',
  'BASE_PATH',
];

/** .env を読み込む。未設定の必須キーがあれば止める */
export function loadEnv(requiredKeys) {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) {
    throw new Error('.env がありません。.env.example をコピーして作成してください。');
  }
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) {
      env[match[1]] = match[2];
    }
  }
  const missing = requiredKeys.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`.env に次の値を設定してください: ${missing.join(', ')}`);
  }
  return env;
}

/** コマンドを実行する。失敗したら止める（allowFailure なら null を返す） */
export function run(command, args, { capture = false, allowFailure = false } = {}) {
  console.log(`> ${command} ${args.filter(arg => !arg.includes('Key=') && !arg.includes('Secret=')).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    // テンプレートに日本語コメントがあるため、Windows でも AWS CLI に UTF-8 で読ませる
    env: { ...process.env, AWS_CLI_FILE_ENCODING: 'UTF-8' },
    stdio: capture ? ['ignore', 'pipe', allowFailure ? 'pipe' : 'inherit'] : 'inherit',
    // Windows で npm（npm.cmd）を呼ぶにはシェルが必要
    shell: process.platform === 'win32' && command === 'npm',
  });
  if (result.status !== 0) {
    if (allowFailure) {
      return null;
    }
    throw new Error(`${command} が失敗しました（終了コード ${result.status}）`);
  }
  return capture ? result.stdout : '';
}

/**
 * AWS CLI を呼ぶ。with-mfa.mjs で MFA 付きの一時認証情報が環境変数に入っているときは、
 * --profile を付けずにそちらを使う
 */
export function aws(env, args, options) {
  const profile = process.env.AWS_SESSION_TOKEN === undefined ? ['--profile', env.AWS_PROFILE] : [];
  return run('aws', [...args, ...profile, '--region', env.AWS_REGION], options);
}

/** スタックの状態を返す。スタックが無ければ null */
export function stackStatus(env) {
  const text = aws(env, ['cloudformation', 'describe-stacks', '--stack-name', env.STACK_NAME, '--query', 'Stacks[0].StackStatus', '--output', 'text'], {
    capture: true,
    allowFailure: true,
  });
  return text === null ? null : text.trim();
}

/** スタックの Outputs を { キー: 値 } で返す */
export function stackOutputs(env) {
  const json = aws(env, ['cloudformation', 'describe-stacks', '--stack-name', env.STACK_NAME, '--query', 'Stacks[0].Outputs', '--output', 'json'], {
    capture: true,
  });
  return Object.fromEntries(JSON.parse(json).map(output => [output.OutputKey, output.OutputValue]));
}
