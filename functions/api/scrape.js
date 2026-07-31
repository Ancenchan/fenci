// functions/api/scrape.js
// POST /api/scrape  body: {"url": "https://projectsekai.fandom.com/wiki/..."}

import { fetchPage, extractSongName, sanitizeFilename, parseLyrics, generateHtml } from '../lib/scraper.js';
import { saveFile } from '../lib/github.js';

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: '请求体不是有效的 JSON' }, 400);
  }

  const url = (body.url || '').trim();
  if (!url) return json({ ok: false, error: '缺少参数 url' }, 400);
  if (!url.includes('projectsekai.fandom.com/wiki/')) {
    return json({ ok: false, error: 'URL 必须来自 projectsekai.fandom.com' }, 400);
  }

  const songName = extractSongName(url);
  const filename = sanitizeFilename(songName) + '.html';
  const cleanUrl = url.split('#')[0];

  try {
    // 1) 抓取页面
    const rawHtml = await fetchPage(url);

    // 2) 解析歌词
    const tabsData = parseLyrics(rawHtml);

    // 3) 生成 HTML
    const finalHtml = generateHtml(songName, cleanUrl, tabsData);

    // 4) 保存到 GitHub
    const result = await saveFile(env, filename, finalHtml);

    return json({
      ok: true,
      song_name: songName,
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
