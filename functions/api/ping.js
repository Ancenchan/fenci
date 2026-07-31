// functions/api/ping.js
// 简单测试端点，无外部依赖，用于验证 Pages Functions 是否正常工作

export async function onRequestGet(context) {
  const env = context.env || {};
  return new Response(JSON.stringify({
    ok: true,
    message: 'pong',
    has_token: !!env.GITHUB_TOKEN,
    has_owner: !!env.GITHUB_OWNER,
    has_repo: !!env.GITHUB_REPO,
    env_keys: Object.keys(env),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
