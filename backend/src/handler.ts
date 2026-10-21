import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { AuthService, type ApiResponse } from './authService';
import { SesMailer } from './mailer';
import { S3DbStore } from './store';

/** Lambda Function URL のイベント（使う項目だけ） */
type FunctionUrlEvent = {
  rawPath: string;
  body?: string;
  isBase64Encoded: boolean;
  headers: Record<string, string | undefined>;
  requestContext: { http: { method: string } };
};

type FunctionUrlResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

let service: AuthService | undefined;

function getService(): AuthService {
  if (service === undefined) {
    service = new AuthService(
      new S3DbStore(new S3Client({}), requiredEnv('DATA_BUCKET')),
      new SesMailer(new SESv2Client({}), requiredEnv('MAIL_FROM')),
      requiredEnv('APP_SECRET'),
      requiredEnv('ADMIN_KEY'),
    );
  }
  return service;
}

function toResult(response: ApiResponse): FunctionUrlResult {
  return {
    statusCode: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(response.body),
  };
}

function parseBody(event: FunctionUrlEvent): unknown {
  if (event.body === undefined || event.body === '') {
    return {};
  }
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(text);
}

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  const method = event.requestContext.http.method;
  // CloudFront の <BASE_PATH>/api/* から来るので、先頭の <BASE_PATH>/api を外してルーティングする
  const apiPrefix = `${requiredEnv('BASE_PATH')}/api`;
  if (!event.rawPath.startsWith(`${apiPrefix}/`)) {
    return toResult({ status: 404, body: { error: 'NOT_FOUND', message: 'Not Found' } });
  }
  const path = event.rawPath.slice(apiPrefix.length);
  const route = `${method} ${path}`;

  let body: unknown;
  try {
    body = parseBody(event);
  } catch {
    return toResult({ status: 400, body: { error: 'BAD_REQUEST', message: 'リクエストの形式が正しくありません。' } });
  }

  try {
    const auth = getService();
    switch (route) {
      case 'POST /login':
        return toResult(await auth.login(body));
      case 'POST /mfa/verify':
        return toResult(await auth.verify(body));
      case 'POST /mfa/resend':
        return toResult(await auth.resend(body));
      case 'GET /me':
        return toResult(auth.me(event.headers['x-session-token']));
      case 'GET /admin/users':
        return toResult(await auth.listUsers(event.headers['x-admin-key']));
      case 'PUT /admin/users':
        return toResult(await auth.upsertUser(event.headers['x-admin-key'], body));
      default:
        return toResult({ status: 404, body: { error: 'NOT_FOUND', message: 'Not Found' } });
    }
  } catch (error) {
    console.error('予期しないエラー', { route, error });
    return toResult({ status: 500, body: { error: 'INTERNAL_ERROR', message: 'サーバーでエラーが発生しました。' } });
  }
}
