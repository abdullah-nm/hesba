import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { quoteApi } from './server/quote.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), quoteApi(env)],
    server: { host: '127.0.0.1', port: 5173 },
  };
});
