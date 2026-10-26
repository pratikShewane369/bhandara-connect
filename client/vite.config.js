import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resilientApiProxy } from './dev-api-proxy.js';
export default defineConfig({ plugins: [react(), tailwindcss(), resilientApiProxy()], server: { port: 5173 } });
