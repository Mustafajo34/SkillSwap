import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// Content Security Policy for production builds: even if script-like text
// ever got past input validation, the browser will only run this app's own
// scripts and only talk to the backend, Google Fonts and Unsplash. Added at
// build time only — Vite's dev server injects an inline script for hot
// reload that a strict policy would block.
function contentSecurityPolicy(apiUrl) {
  const api = new URL(apiUrl)
  const socket = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // style="" attributes (React inline styles) + Google Fonts CSS
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // profile photos come from the backend (/avatars/:id)
    `img-src 'self' data: blob: ${api.origin} https://images.unsplash.com`,
    `connect-src 'self' ${api.origin} ${socket}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  return {
    name: 'skillswap-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = env.VITE_API_URL || 'http://localhost:1989'
  return {
    plugins: [react(), tailwindcss(), contentSecurityPolicy(apiUrl)],
  }
})
