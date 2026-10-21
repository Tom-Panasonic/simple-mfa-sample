// 既存の CloudFront ディストリビューションに、このサンプル用のオリジンと振る舞いを足す・外す。
// 既存のオリジン・振る舞いには触れない（Id とパスパターンで自分の分だけを入れ替える）。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aws } from './lib.mjs';

// AWS マネージドポリシーの ID
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const ALL_VIEWER_EXCEPT_HOST_HEADER = 'b689b0a8-53d0-40ab-baf2-68738e2966ac';
const SECURITY_HEADERS = '67f7725c-6f97-4210-82d7-5512b31e9d03';

const items = (...values) => ({ Quantity: values.length, Items: values });

function names(env) {
  const prefix = env.STACK_NAME;
  return {
    siteOriginId: `${prefix}-site`,
    apiOriginId: `${prefix}-api`,
    sitePattern: `${env.BASE_PATH}/*`,
    apiPattern: `${env.BASE_PATH}/api/*`,
  };
}

function behavior(pathPattern, targetOriginId, extra) {
  return {
    PathPattern: pathPattern,
    TargetOriginId: targetOriginId,
    TrustedSigners: { Enabled: false, Quantity: 0 },
    TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    SmoothStreaming: false,
    Compress: true,
    LambdaFunctionAssociations: { Quantity: 0 },
    FunctionAssociations: { Quantity: 0 },
    FieldLevelEncryptionId: '',
    ...extra,
  };
}

function readConfig(env) {
  const json = aws(env, ['cloudfront', 'get-distribution-config', '--id', env.DISTRIBUTION_ID, '--output', 'json'], { capture: true });
  return JSON.parse(json);
}

function writeConfig(env, etag, config) {
  const dir = mkdtempSync(join(tmpdir(), 'mfa-sample-'));
  const file = join(dir, 'distribution-config.json');
  try {
    writeFileSync(file, JSON.stringify(config));
    aws(env, ['cloudfront', 'update-distribution', '--id', env.DISTRIBUTION_ID, '--if-match', etag, '--distribution-config', `file://${file}`, '--output', 'text', '--query', 'Distribution.Status']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 自分のオリジン・振る舞いを取り除いた設定を返す（既存の分はそのまま） */
function withoutOwn(config, n) {
  const origins = config.Origins.Items.filter(origin => origin.Id !== n.siteOriginId && origin.Id !== n.apiOriginId);
  const behaviors = (config.CacheBehaviors.Items ?? []).filter(b => b.PathPattern !== n.sitePattern && b.PathPattern !== n.apiPattern);
  return {
    ...config,
    Origins: { Quantity: origins.length, Items: origins },
    CacheBehaviors: behaviors.length === 0 ? { Quantity: 0 } : { Quantity: behaviors.length, Items: behaviors },
  };
}

/** サンプル用のオリジンと振る舞いを足す（何度実行しても同じ結果になる） */
export function attachToDistribution(env, outputs) {
  const { ETag, DistributionConfig } = readConfig(env);
  writeConfig(env, ETag, buildAttachedConfig(DistributionConfig, env, outputs));
}

/** 既存の設定に、サンプル用のオリジンと振る舞いを足した設定を返す（AWS は呼ばない） */
export function buildAttachedConfig(config, env, outputs) {
  const n = names(env);
  const base = withoutOwn(config, n);

  const siteOrigin = {
    Id: n.siteOriginId,
    DomainName: outputs.SiteBucketDomainName,
    OriginPath: '',
    CustomHeaders: { Quantity: 0 },
    S3OriginConfig: { OriginAccessIdentity: '' },
    OriginAccessControlId: env.ORIGIN_ACCESS_CONTROL_ID,
    ConnectionAttempts: 3,
    ConnectionTimeout: 10,
    OriginShield: { Enabled: false },
  };
  const apiOrigin = {
    Id: n.apiOriginId,
    // https://xxxx.lambda-url.ap-northeast-1.on.aws/ からホスト名だけを取り出す
    DomainName: new URL(outputs.FunctionUrl).host,
    OriginPath: '',
    CustomHeaders: { Quantity: 0 },
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'https-only',
      OriginSslProtocols: items('TLSv1.2'),
      OriginReadTimeout: 30,
      OriginKeepaliveTimeout: 5,
    },
    ConnectionAttempts: 3,
    ConnectionTimeout: 10,
    OriginShield: { Enabled: false },
  };

  // 振る舞いは上から順に評価されるので、/api/* を先に置く
  const apiBehavior = behavior(n.apiPattern, n.apiOriginId, {
    ViewerProtocolPolicy: 'https-only',
    AllowedMethods: { ...items('GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'), CachedMethods: items('GET', 'HEAD') },
    CachePolicyId: CACHING_DISABLED,
    // Host を送ると Function URL が受け付けないため、Host 以外を転送する
    OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_HEADER,
  });
  const siteBehavior = behavior(n.sitePattern, n.siteOriginId, {
    ViewerProtocolPolicy: 'redirect-to-https',
    AllowedMethods: { ...items('GET', 'HEAD'), CachedMethods: items('GET', 'HEAD') },
    CachePolicyId: CACHING_OPTIMIZED,
    ResponseHeadersPolicyId: SECURITY_HEADERS,
  });

  const behaviors = [apiBehavior, siteBehavior, ...(base.CacheBehaviors.Items ?? [])];
  const origins = [...base.Origins.Items, siteOrigin, apiOrigin];
  return {
    ...base,
    Origins: { Quantity: origins.length, Items: origins },
    CacheBehaviors: { Quantity: behaviors.length, Items: behaviors },
  };
}

/** サンプル用のオリジンと振る舞いを外す */
export function detachFromDistribution(env) {
  const n = names(env);
  const { ETag, DistributionConfig } = readConfig(env);
  writeConfig(env, ETag, withoutOwn(DistributionConfig, n));
}

export function waitDistributionDeployed(env) {
  aws(env, ['cloudfront', 'wait', 'distribution-deployed', '--id', env.DISTRIBUTION_ID]);
}

export function siteUrl(env) {
  const domain = aws(env, ['cloudfront', 'get-distribution', '--id', env.DISTRIBUTION_ID, '--query', 'Distribution.DomainName', '--output', 'text'], {
    capture: true,
  }).trim();
  // 既存のディストリビューションの DefaultRootObject は使えないので、index.html まで指定する
  return `https://${domain}${env.BASE_PATH}/index.html`;
}
