// テスト → ビルド → CloudFormation → Lambda のコード差し替え → React の配置 → 既存 CloudFront への相乗り までを一括で行う
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { attachToDistribution, siteUrl, waitDistributionDeployed } from './distribution.mjs';
import { DEPLOY_KEYS, ROOT, aws, loadEnv, run, stackOutputs, stackStatus } from './lib.mjs';

const env = loadEnv(DEPLOY_KEYS);

run('npm', ['test']);
// 画面は BASE_PATH の下に置くので、ビルド時にも同じパスを渡す
process.env.VITE_BASE_PATH = env.BASE_PATH;
run('npm', ['run', 'build']);

// 初回作成に失敗したスタックは更新できないので、消してから作り直す
const status = stackStatus(env);
if (status === 'ROLLBACK_COMPLETE' || status === 'ROLLBACK_FAILED' || status === 'DELETE_FAILED') {
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
  `DistributionId=${env.DISTRIBUTION_ID}`,
  `BasePath=${env.BASE_PATH}`,
]);

const outputs = stackOutputs(env);

// Lambda: esbuild で1ファイルにした index.js を zip にして差し替える
const zipPath = resolve(ROOT, 'backend/dist/function.zip');
const zip = new AdmZip();
zip.addLocalFile(resolve(ROOT, 'backend/dist/index.js'));
zip.writeZip(zipPath);
aws(env, ['lambda', 'update-function-code', '--function-name', outputs.FunctionName, '--zip-file', `fileb://${zipPath}`, '--output', 'text', '--query', 'LastUpdateStatus']);
aws(env, ['lambda', 'wait', 'function-updated', '--function-name', outputs.FunctionName]);

// React: CloudFront は受け取ったパスのまま S3 を読むので、BASE_PATH と同じプレフィックスに置く
const prefix = env.BASE_PATH.replace(/^\//, '');
aws(env, ['s3', 'sync', 'frontend/dist', `s3://${outputs.SiteBucketName}/${prefix}`, '--delete']);

// 既存の CloudFront に、このサンプル用のオリジンと振る舞いを足す
attachToDistribution(env, outputs);
aws(env, ['cloudfront', 'create-invalidation', '--distribution-id', env.DISTRIBUTION_ID, '--paths', `${env.BASE_PATH}/*`, '--output', 'text', '--query', 'Invalidation.Id']);
console.log('CloudFront への反映を待っています（数分かかります）');
waitDistributionDeployed(env);

const result = { ...outputs, SiteUrl: siteUrl(env) };
writeFileSync(resolve(ROOT, 'deploy-output.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nデプロイしました: ${result.SiteUrl}`);
console.log('初期ユーザーを登録する場合は npm run seed を実行してください。');
