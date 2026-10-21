// テスト → ビルド → CloudFormation → Lambda のコード差し替え → React の配置 までを一括で行う
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { ROOT, aws, loadEnv, run, stackOutputs, stackStatus } from './lib.mjs';

const env = loadEnv(['AWS_PROFILE', 'AWS_REGION', 'STACK_NAME', 'MAIL_FROM', 'ADMIN_KEY', 'APP_SECRET']);

run('npm', ['test']);
run('npm', ['run', 'build']);

// 初回作成に失敗したスタックは更新できないので、消してから作り直す
const status = stackStatus(env);
if (status === 'ROLLBACK_COMPLETE' || status === 'ROLLBACK_FAILED') {
  console.log(`スタックが ${status} のため削除してから作り直します`);
  aws(env, ['cloudformation', 'delete-stack', '--stack-name', env.STACK_NAME]);
  aws(env, ['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', env.STACK_NAME]);
}

aws(env, [
  'cloudformation',
  'deploy',
  '--template-file',
  'infra/template.yaml',
  '--stack-name',
  env.STACK_NAME,
  '--capabilities',
  'CAPABILITY_IAM',
  '--no-fail-on-empty-changeset',
  '--tags',
  `Project=${env.STACK_NAME}`,
  '--parameter-overrides',
  `MailFrom=${env.MAIL_FROM}`,
  `AdminKey=${env.ADMIN_KEY}`,
  `AppSecret=${env.APP_SECRET}`,
]);

const outputs = stackOutputs(env);

// Lambda: esbuild で1ファイルにした index.js を zip にして差し替える
const zipPath = resolve(ROOT, 'backend/dist/function.zip');
const zip = new AdmZip();
zip.addLocalFile(resolve(ROOT, 'backend/dist/index.js'));
zip.writeZip(zipPath);
aws(env, ['lambda', 'update-function-code', '--function-name', outputs.FunctionName, '--zip-file', `fileb://${zipPath}`, '--output', 'text', '--query', 'LastUpdateStatus']);
aws(env, ['lambda', 'wait', 'function-updated', '--function-name', outputs.FunctionName]);

// React: S3 に置いて CloudFront のキャッシュを消す
aws(env, ['s3', 'sync', 'frontend/dist', `s3://${outputs.SiteBucketName}`, '--delete']);
aws(env, ['cloudfront', 'create-invalidation', '--distribution-id', outputs.DistributionId, '--paths', '/*', '--output', 'text', '--query', 'Invalidation.Id']);

writeFileSync(resolve(ROOT, 'deploy-output.json'), `${JSON.stringify(outputs, null, 2)}\n`);
console.log(`\nデプロイしました: ${outputs.SiteUrl}`);
console.log('初期ユーザーを登録する場合は npm run seed を実行してください。');
