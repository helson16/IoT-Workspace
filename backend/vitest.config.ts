import { defineConfig } from 'vitest/config';

// 内联空 PostCSS 配置, 阻止 vite 向上搜索到仓库根目录的 postcss.config.mjs
// (tailwind v4 插件会导致 "Invalid PostCSS Plugin" 启动错误)
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // config/index.ts 在 import 期做 JWT_SECRET 非空检查, 测试环境注入占位值
    env: {
      JWT_SECRET: 'unit-test-secret',
    },
  },
});
