import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { presenceProxy } from './server/presenceProxy.ts';
export default defineConfig({ plugins: [react(), presenceProxy()], base: './', server: { host: '127.0.0.1', port: 5188, strictPort: true } });
