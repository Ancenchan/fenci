// lib/scraper.js
// JS 版歌词爬取逻辑（从 Python scrape_lyrics.py 移植）

/**
 * 获取 wiki 页面 HTML（通过 MediaWiki API，避免直接抓取被 403）
 */
export async function fetchPage(url) {
  const pageName = extractSongName(url);
  const apiUrl = `https://projectsekai.fandom.com/api.php?action=parse&page=${encodeURIComponent(pageName)}&format=json&prop=text&disablelimitreport=1&disableeditsection=1&disabletoc=1`;

  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`Wiki API HTTP ${resp.status}`);

  const data = await resp.json();
  if (data.error) throw new Error(`Wiki API: ${data.error.info || data.error.code}`);

  const html = data.parse?.text?.['*'];
  if (!html) throw new Error('Wiki API 返回空内容');

  return html;
}

/**
 * 从 URL 提取歌曲名
 */
export function extractSongName(url) {
  const clean = url.split('#')[0].replace(/\/$/, '');
  const parts = clean.split('/wiki/');
  return parts.length > 1 ? parts[parts.length - 1] : clean.split('/').pop();
}

/**
 * 文件名安全化
 */
export function sanitizeFilename(name) {
  return name.replace(/[^\w\-]/g, '_');
}

/**
 * 从页面 HTML 中解析歌词 tabber
 * 返回 [{ name, html, active }]
 */
export function parseLyrics(html) {
  // 找到 Lyrics 标记
  const lyricsIdx = html.indexOf('id="Lyrics"');
  if (lyricsIdx === -1) throw new Error('页面中未找到 Lyrics 章节');

  const afterLyrics = html.slice(lyricsIdx);

  // 找到第一个 tabber 容器
  const tabberMatch = afterLyrics.match(/<div[^>]*class="[^"]*tabber[^"]*"[^>]*>/);
  if (!tabberMatch) throw new Error('Lyrics 章节下未找到 tabber');

  const tabberStart = afterLyrics.indexOf(tabberMatch[0]);
  // 找到 tabber 的闭合 </div>（需要计算嵌套层级）
  const tabberHtml = extractDiv(afterLyrics, tabberStart);
  if (!tabberHtml) throw new Error('无法提取 tabber 内容');

  // 提取 tab 名（data-hash 属性）
  const tabNames = [];
  const tabRegex = /<li[^>]*class="[^"]*wds-tabs__tab[^"]*"[^>]*data-hash="([^"]*)"[^>]*>/g;
  let m;
  while ((m = tabRegex.exec(tabberHtml)) !== null) {
    tabNames.push(m[1]);
  }

  // 提取每个 tab 内容面板
  const contents = [];
  const contentRegex = /<div[^>]*class="[^"]*wds-tab__content[^"]*"[^>]*>/g;
  const contentDivs = [];
  let cm;
  while ((cm = contentRegex.exec(tabberHtml)) !== null) {
    const divStart = cm.index;
    const divContent = extractDiv(tabberHtml, divStart);
    if (divContent) contentDivs.push(divContent);
  }

  if (contentDivs.length !== tabNames.length) {
    throw new Error(`Tab 数量(${tabNames.length})与内容数量(${contentDivs.length})不匹配`);
  }

  const results = [];
  for (let i = 0; i < tabNames.length; i++) {
    const name = tabNames[i];
    const contentDiv = contentDivs[i];
    const isActive = /wds-is-current/.test(contentDivs[i].slice(0, 200));

    // 在 content 里找 poem
    const poemMatch = contentDiv.match(/<div[^>]*class="[^"]*poem[^"]*"[^>]*>/);
    let innerHtml;
    if (poemMatch) {
      const poemStart = contentDiv.indexOf(poemMatch[0]);
      innerHtml = extractDivInner(contentDiv, poemStart);
    } else {
      innerHtml = contentDiv;
    }

    innerHtml = cleanPoemHtml(innerHtml || '');
    results.push({ name, html: innerHtml, active: isActive });
  }

  return results;
}

/**
 * 从指定位置提取完整的 <div>...</div>（含外层 div）
 */
function extractDiv(html, startIdx) {
  const openTag = html.indexOf('<div', startIdx);
  if (openTag === -1) return null;
  const tagEnd = html.indexOf('>', openTag);
  if (tagEnd === -1) return null;

  let depth = 1;
  let pos = tagEnd + 1;
  while (depth > 0 && pos < html.length) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      pos = nextClose + 6;
    }
  }
  return html.slice(startIdx, pos);
}

/**
 * 提取 div 的内部内容（不含外层 div 标签）
 */
function extractDivInner(html, startIdx) {
  const full = extractDiv(html, startIdx);
  if (!full) return '';
  // 去掉第一个 <div ...> 和最后的 </div>
  const firstGt = full.indexOf('>');
  const lastClose = full.lastIndexOf('</div>');
  if (firstGt === -1 || lastClose === -1) return full;
  return full.slice(firstGt + 1, lastClose);
}

/**
 * 清理 poem HTML：去 img、去 wiki 链接、去 class/data 属性（保留 style）
 */
function cleanPoemHtml(html) {
  let s = html;

  // 移除 copy-to-clipboard-button
  s = s.replace(/<[^>]*class="[^"]*copy-to-clipboard-button[^"]*"[^>]*><\/[^>]*>/gi, '');
  // unwrap copy-to-clipboard-text
  s = s.replace(/<div[^>]*class="[^"]*copy-to-clipboard-text[^"]*"[^>]*>/gi, '')
       .replace(/<\/div>(?=\s*<p|(?<=<\/p>)\s*$)/gi, '');

  // 移除 mw-empty-elt 段落
  s = s.replace(/<p[^>]*class="[^"]*mw-empty-elt[^"]*"[^>]*>[\s\S]*?<\/p>/gi, '');

  // 移除所有 img 标签
  s = s.replace(/<img[^>]*>/gi, '');

  // 移除只含 wiki 内部链接的空 <a>（href="/wiki/..." 且无文字）
  s = s.replace(/<a[^>]*href="\/wiki\/[^"]*"[^>]*>\s*<\/a>/gi, '');

  // 清理 <a> 标签属性（只保留 href/target/rel/style）
  s = s.replace(/<a\s([^>]*)>/gi, (match, attrs) => {
    const kept = attrs
      .split(/\s+/)
      .filter(a => /^(href|target|rel|style)=/.test(a))
      .join(' ');
    return `<a ${kept}>`.replace(/\s+>/, '>');
  });

  // 清理 <span> 属性（只保留 style），并反复移除空 span
  for (let i = 0; i < 5; i++) {
    s = s.replace(/<span\s([^>]*)>/gi, (match, attrs) => {
      const kept = attrs
        .split(/\s+/)
        .filter(a => a.startsWith('style='))
        .join(' ');
      return kept ? `<span ${kept}>` : '<span>';
    });
    // 移除空 span
    s = s.replace(/<span\s*>\s*<\/span>/gi, '');
  }

  // 清理 <p> 属性（只保留 style）
  s = s.replace(/<p\s([^>]*)>/gi, (match, attrs) => {
    const kept = attrs
      .split(/\s+/)
      .filter(a => a.startsWith('style='))
      .join(' ');
    return kept ? `<p ${kept}>` : '<p>';
  });

  // 清理多余空行
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s;
}

// ── HTML 生成 ──────────────────────────────────

const CSS = `  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                 "Hiragino Sans", "Yu Gothic UI", "Microsoft YaHei", sans-serif;
    background: #1a1a2e; color: #eee; line-height: 1.7;
  }
  .container { max-width: 860px; margin: 0 auto; }
  h1 {
    text-align: center; font-size: 28px; margin: 0 0 8px;
    background: linear-gradient(90deg,#FF6699,#33CCBB,#FF7722,#0077DD);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .subtitle { text-align: center; color: #aaa; margin: 0 0 32px; font-size: 14px; }
  .tabs {
    display: flex; border-bottom: 2px solid #333; margin: 0; padding: 0; list-style: none;
  }
  .tab-btn {
    flex: 1; padding: 12px 16px; background: transparent; border: none;
    color: #bbb; cursor: pointer; font-size: 15px; font-weight: 600;
    border-bottom: 3px solid transparent; margin-bottom: -2px; transition: all .2s ease;
  }
  .tab-btn:hover { color: #fff; background: rgba(255,255,255,.04); }
  .tab-btn.active { color: #62d8d8; border-bottom-color: #62d8d8; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .poem {
    color: #fff; background: rgba(40,40,40,.9); text-shadow: 0 0 .5em #000;
    padding: 28px 32px; border-radius: 0 0 12px 12px; font-size: 15px;
    white-space: normal; word-break: break-word;
  }
  .poem p { margin: 0 0 12px; }
  .poem b { font-size: 16px; }
  ruby { display: inline-flex; flex-direction: column-reverse; align-items: center; line-height: 1; }
  ruby > rt { font-size: .55em; color: #bbb; line-height: 1.2; margin-bottom: 2px; }
  ruby > rp { display: none; }
  footer { text-align: center; color: #777; font-size: 12px; margin-top: 40px; }
  footer a { color: #62d8d8; text-decoration: none; }`;

const JS = `  var buttons = document.querySelectorAll('.tab-btn');
  var panels  = document.querySelectorAll('.tab-panel');
  buttons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.tab;
      buttons.forEach(function(b) { b.classList.toggle('active', b === btn); });
      panels.forEach(function(p) { p.classList.toggle('active', p.id === target); });
    });
  });`;

/**
 * 生成完整的 HTML 文件内容
 */
export function generateHtml(songName, sourceUrl, tabsData) {
  // 如果没有 active 的 tab，优先选 Japanese
  if (!tabsData.some(t => t.active)) {
    const jp = tabsData.find(t => t.name.toLowerCase() === 'japanese');
    if (jp) jp.active = true;
    else if (tabsData.length > 0) tabsData[0].active = true;
  }

  const tabButtons = [];
  const panels = [];
  for (const t of tabsData) {
    const activeCls = t.active ? ' active' : '';
    const tabId = t.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    tabButtons.push(
      `    <li><button class="tab-btn${activeCls}" data-tab="${tabId}" role="tab">${t.name}</button></li>`
    );
    panels.push(
      `  <div id="${tabId}" class="tab-panel${activeCls}">\n    <div class="poem">\n${t.html}\n    </div>\n  </div>`
    );
  }

  const displayName = songName.replace(/_/g, ' ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${displayName} - 歌词</title>
<style>
${CSS}
</style>
</head>
<body>
<div class="container">
  <h1>${displayName}</h1>
  <p class="subtitle">Project SEKAI Wiki</p>
  <ul class="tabs" role="tablist">
${tabButtons.join('\n')}
  </ul>
${panels.join('\n')}
  <footer>Source: <a href="${sourceUrl}" target="_blank" rel="noopener">Project SEKAI Wiki</a></footer>
</div>
<script>
${JS}
</script>
</body>
</html>`;
}
