import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Мультистраничная сборка: основное приложение (index.html) + админ-панель (admin.html).
// На GitHub Pages деплоится в /app/, поэтому админка доступна по /app/admin.html.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
