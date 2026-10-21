// 作ったリソースをすべて消す（バケットは空にしないと消せないので先に空にする）
import { aws, loadEnv, stackOutputs } from './lib.mjs';

const env = loadEnv(['AWS_PROFILE', 'AWS_REGION', 'STACK_NAME']);
const outputs = stackOutputs(env);

aws(env, ['s3', 'rm', `s3://${outputs.SiteBucketName}`, '--recursive']);
aws(env, ['s3', 'rm', `s3://${outputs.DataBucketName}`, '--recursive']);
aws(env, ['cloudformation', 'delete-stack', '--stack-name', env.STACK_NAME]);
aws(env, ['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', env.STACK_NAME]);
console.log('削除しました。');
