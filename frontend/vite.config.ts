import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 画面を置くパス（例 /mfa-sample）。deploy スクリプトが .env の BASE_PATH を渡す
const basePath = process.env.VITE_BASE_PATH ?? '';

// ローカル開発時は、デプロイ済みの CloudFront へ API を転送する
// 例: VITE_BASE_PATH=/mfa-sample VITE_API_PROXY=https://xxxx.cloudfront.net npm run dev -w frontend
const apiProxy = process.env.VITE_API_PROXY;

export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  server: apiProxy === undefined ? undefined : { proxy: { [`${basePath}/api`]: { target: apiProxy, changeOrigin: true } } },
});
