import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 前端 /api 转发到本地后端，避免跨域、且后端只绑定 127.0.0.1
      '/api': 'http://127.0.0.1:8787',
      // 音乐盒静态文件也走后端（同源 iframe）
      '/musicbox': 'http://127.0.0.1:8787',
    },
  },
})
