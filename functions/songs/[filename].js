// functions/songs/[filename].js
// GET /songs/:filename → 从 GitHub 读取并返回歌词 HTML

import { getFile } from '../lib/github.js';

export async function onRequestGet({ env, params }) {
  const filename = params.filename;

  // 安全检查
  if (!filename || !filename.toLowerCase().endsWith('.html')) {
    return new Response('Not Found', { status: 404 });
  }

  try {
    const html = await getFile(env, filename);
    if (html === null) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}
