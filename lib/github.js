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
 * 构造 Contents API URL：目录段不编码，filename 段单独 encodeURIComponent
 * filename 可为空（用于列目录）
 */
function contentsUrl(owner, repo, lyricsDir, filename, branch) {
  const seg = filename
    ? `${lyricsDir}/${encodeURIComponent(filename)}`
    : lyricsDir;
  return `${API_BASE}/${owner}/${repo}/contents/${seg}?ref=${branch}`;
}

/**
 * 保存文件到 GitHub（如果已存在则更新）
 */
export async function saveFile(env, filename, content) {
  const { token, owner, repo, branch, lyricsDir } = getEnv(env);
  const getUrl = contentsUrl(owner, repo, lyricsDir, filename, branch);
  const putUrl = contentsUrl(owner, repo, lyricsDir, filename, branch);

  // 先检查文件是否已存在（获取 sha 用于更新）
  let sha = null;
  try {
    const checkResp = await fetch(getUrl, {
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

  const resp = await fetch(putUrl, {
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
 * 带 4 次重试（间隔 1 秒）：应对 PUT 后 GitHub API 同步延迟导致的瞬时 404
 */
export async function getFile(env, filename) {
  const { token, owner, repo, branch, lyricsDir } = getEnv(env);
  const url = contentsUrl(owner, repo, lyricsDir, filename, branch);
  const hdrs = headers(token);

  const MAX_RETRY = 4;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const resp = await fetch(url, { headers: hdrs });

    if (resp.ok) {
      const data = await resp.json();
      // GitHub API 返回 base64 编码的内容
      const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
      return decoded;
    }

    if (resp.status === 404) {
      // 文件刚 PUT 完可能短暂 404，等 1 秒后重试
      if (attempt < MAX_RETRY - 1) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return null;
    }

    const data = await resp.json().catch(() => ({}));
    throw new Error(data.message || `GitHub API error: ${resp.status}`);
  }
  return null;
}

/**
 * 删除歌词文件
 */
export async function deleteFile(env, filename) {
  const { token, owner, repo, branch, lyricsDir } = getEnv(env);
  const url = contentsUrl(owner, repo, lyricsDir, filename, branch);

  // 先获取文件的 sha（删除需要 sha）
  let sha = null;
  try {
    const checkResp = await fetch(url, {
      headers: headers(token),
    });
    if (checkResp.ok) {
      const data = await checkResp.json();
      sha = data.sha;
    }
  } catch (_) { /* 文件不存在 */ }

  if (!sha) throw new Error(`文件 ${filename} 不存在`);

  const resp = await fetch(url, {
    method: 'DELETE',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Delete lyrics: ${filename}`,
      sha,
      branch,
    }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.message || `GitHub API error: ${resp.status}`);
  }

  return { ok: true, filename };
}
