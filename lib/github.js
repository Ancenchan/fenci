// functions/_lib/github.js
// 通过 GitHub Contents API 保存/列出/读取歌词文件

const API_BASE = 'https://api.github.com/repos';

function getEnv(env) {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER || 'Ancenchan';
  const repo = env.GITHUB_REPO || 'fenci';
  const branch = env.GITHUB_BRANCH || 'main';
  const lyricsDir = env.LYRICS_DIR || 'lyrics';
  if (!token) throw new Error('未配置 GITHUB_TOKEN 环境变量');
  return { token, owner, repo, branch, lyricsDir };
}

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'fenci-cloudflare-pages',
  };
}

/**
 * 保存文件到 GitHub（如果已存在则更新）
 */
export async function saveFile(env, filename, content) {
  const { token, owner, repo, branch, lyricsDir } = getEnv(env);
  const path = `${lyricsDir}/${filename}`;

  // 先检查文件是否已存在（获取 sha 用于更新）
  let sha = null;
  try {
    const checkResp = await fetch(`${API_BASE}/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, {
      headers: headers(token),
    });
    if (checkResp.ok) {
      const data = await checkResp.json();
      sha = data.sha;
    }
  } catch (_) { /* 文件不存在，正常 */ }

  // base64 编码内容
  const encoded = btoa(unescape(encodeURIComponent(content)));

  const body = {
    message: sha ? `Update lyrics: ${filename}` : `Add lyrics: ${filename}`,
    content: encoded,
    branch,
  };
  if (sha) body.sha = sha;

  const resp = await fetch(`${API_BASE}/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.message || `GitHub API error: ${resp.status}`);
  }

  return {
    path: data.content.path,
    sha: data.content.sha,
    html_url: data.content.html_url,
  };
}

/**
 * 列出 lyrics 目录下的所有 HTML 文件
 */
export async function listFiles(env) {
  const { token, owner, repo, branch, lyricsDir } = getEnv(env);

  const resp = await fetch(`${API_BASE}/${owner}/${repo}/contents/${lyricsDir}?ref=${branch}`, {
    headers: headers(token),
  });

  if (resp.status === 404) {
    // 目录还不存在
    return [];
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.message || `GitHub API error: ${resp.status}`);
  }

  const items = await resp.json();
  if (!Array.isArray(items)) return [];

  return items
    .filter(item => item.type === 'file' && item.name.endsWith('.html'))
    .map(item => ({
      filename: item.name,
      song_name: item.name.replace(/\.html$/i, ''),
      size: item.size,
      sha: item.sha,
      url: item.html_url,
    }))
    .reverse(); // 最新的在前（GitHub API 默认按名字排序，这里简单反转）
}

/**
 * 读取单个歌词文件内容
 */
export async function getFile(env, filename) {
  const { token, owner, repo, branch, lyricsDir } = getEnv(env);
  const path = `${lyricsDir}/${filename}`;

  const resp = await fetch(`${API_BASE}/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, {
    headers: headers(token),
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.message || `GitHub API error: ${resp.status}`);
  }

  const data = await resp.json();
  // GitHub API 返回 base64 编码的内容
  const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  return decoded;
}
