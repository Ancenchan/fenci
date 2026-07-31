// functions/api/list.js
// GET /api/list  → 列出 GitHub 仓库 lyrics/ 目录下的所有歌词文件

import { listFiles } from '../_lib/github.js';

export async function onRequestGet({ env }) {
  try {
    const files = await listFiles(env);
    return json({ ok: true, files });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
