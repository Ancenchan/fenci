// src/index.js
// Cloudflare Worker 入口：处理 API 路由，静态文件由 ASSETS 自动服务

import { fetchPage, extractSongName, sanitizeFilename, parseLyrics, generateHtml } from '../lib/scraper.js';
import { saveFile, listFiles, getFile, deleteFile } from '../lib/github.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── /api/ping ──────────────────────────────────
    if (path === '/api/ping') {
      return json({
        ok: true,
        message: 'pong',
        has_token: !!env.GITHUB_TOKEN,
        has_owner: !!env.GITHUB_OWNER,
        has_repo: !!env.GITHUB_REPO,
        env_keys: Object.keys(env),
      });
    }

    // ── /api/list ──────────────────────────────────
    if (path === '/api/list' && request.method === 'GET') {
      try {
        const files = await listFiles(env);
        return json({ ok: true, files });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ── /api/delete ────────────────────────────────
    if (path === '/api/delete' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ ok: false, error: '请求体不是有效的 JSON' }, 400);
      }
      const filename = (body.filename || '').trim();
      if (!filename) return json({ ok: false, error: '缺少参数 filename' }, 400);
      if (!filename.toLowerCase().endsWith('.html')) {
        return json({ ok: false, error: '只能删除 .html 文件' }, 400);
      }
      try {
        await deleteFile(env, filename);
        return json({ ok: true, filename });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ── /api/scrape ────────────────────────────────
    if (path === '/api/scrape' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ ok: false, error: '请求体不是有效的 JSON' }, 400);
      }

      const scrapeUrl = (body.url || '').trim();
      if (!scrapeUrl) return json({ ok: false, error: '缺少参数 url' }, 400);
      if (!scrapeUrl.includes('projectsekai.fandom.com/wiki/')) {
        return json({ ok: false, error: 'URL 必须来自 projectsekai.fandom.com' }, 400);
      }

      const pageName = extractSongName(scrapeUrl);
      const customName = (body.song_name || '').trim();
      const displayName = customName || pageName;
      const filename = sanitizeFilename(displayName) + '.html';
      const cleanUrl = scrapeUrl.split('#')[0];

      try {
        const rawHtml = await fetchPage(scrapeUrl);
        const tabsData = parseLyrics(rawHtml);
        const finalHtml = generateHtml(pageName, cleanUrl, tabsData);
        const result = await saveFile(env, filename, finalHtml);

        return json({
          ok: true,
          song_name: displayName,
          filename,
          tabs: tabsData.map(t => t.name),
          view_url: `/songs/${filename}`,
          size_bytes: new TextEncoder().encode(finalHtml).length,
          github_url: result.html_url,
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ── /songs/:filename ───────────────────────────
    if (path.startsWith('/songs/') && request.method === 'GET') {
      const rawFilename = path.split('/songs/')[1];
      // 前端用 encodeURIComponent(filename) 构造 URL，这里必须解码
      // 否则日文/特殊字符文件名会传给 GitHub API 时被二次编码 → 404
      let filename;
      try {
        filename = decodeURIComponent(rawFilename);
      } catch (_) {
        filename = rawFilename;
      }
      if (!filename || !filename.toLowerCase().endsWith('.html')) {
        return new Response('Not Found', { status: 404 });
      }
      try {
        const html = await getFile(env, filename);
        if (html === null) return new Response('Not Found', { status: 404 });
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

    // ── 其他路径：交给静态资源 ──────────────────────
    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
