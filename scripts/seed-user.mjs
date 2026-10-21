// .env の SEED_* を、登録 API（PUT <BASE_PATH>/api/admin/users）で初期ユーザーとして登録する
import { loadEnv, stackOutputs } from './lib.mjs';

const env = loadEnv(['AWS_PROFILE', 'AWS_REGION', 'STACK_NAME', 'BASE_PATH', 'ADMIN_KEY', 'SEED_LOGIN_ID', 'SEED_PASSWORD', 'SEED_MFA_EMAIL']);
const outputs = stackOutputs(env);

// CloudFront を通さず Function URL を直接呼ぶ（Lambda は BASE_PATH/api を外してルーティングする）
const url = new URL(`${env.BASE_PATH}/api/admin/users`, outputs.FunctionUrl);
const response = await fetch(url, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', 'x-admin-key': env.ADMIN_KEY },
  body: JSON.stringify({ loginId: env.SEED_LOGIN_ID, password: env.SEED_PASSWORD, mfaEmail: env.SEED_MFA_EMAIL }),
});
const body = await response.json();
if (!response.ok) {
  throw new Error(`登録に失敗しました（${response.status}）: ${body.message}`);
}
console.log(`${body.created ? '登録' : '更新'}しました: ${body.loginId}`);
