// 作ったものをすべて片付ける。既存の CloudFront からはこのサンプルの振る舞いだけを外す
import { detachFromDistribution, waitDistributionDeployed } from './distribution.mjs';
import { DEPLOY_KEYS, aws, loadEnv, stackOutputs } from './lib.mjs';

const env = loadEnv(DEPLOY_KEYS);

// 先に CloudFront から外す（外す前にバケットを消すと、オリジンが存在しない状態になる）
detachFromDistribution(env);
waitDistributionDeployed(env);

const outputs = stackOutputs(env);
aws(env, ['s3', 'rm', `s3://${outputs.SiteBucketName}`, '--recursive']);
aws(env, ['s3', 'rm', `s3://${outputs.DataBucketName}`, '--recursive']);
aws(env, ['cloudformation', 'delete-stack', '--stack-name', env.STACK_NAME]);
aws(env, ['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', env.STACK_NAME]);
console.log('削除しました。');
