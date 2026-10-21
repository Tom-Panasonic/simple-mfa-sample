import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ローカル開発時は、デプロイ済みの CloudFront へ /api を転送する
// 例: VITE_API_PROXY=https://xxxx.cloudfront.net npm run dev -w frontend
const apiProxy = process.env.VITE_API_PROXY;

export default defineConfig({
  plugins: [react()],
  server: apiProxy === undefined ? undefined : { proxy: { '/api': { target: apiProxy, changeOrigin: true } } },
});
