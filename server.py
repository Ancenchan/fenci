#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fenci 项目 Web 控制台后端。

启动：
  python server.py           # 默认 5000 端口
  python server.py 8765      # 指定端口

访问：
  http://localhost:5000/

API:
  POST  /api/scrape     body: {"url": "..."}       → 爬取歌词生成 HTML
  GET   /api/list                            → 列出已生成的歌词 HTML
  GET   /songs/<filename>                   → 打开某个已生成的 HTML
  GET   /                             → 前端控制台 (index.html)
"""

import os
import sys
import json
import re
import traceback
import requests  # 用于 except 分支捕获 RequestException
from flask import (
    Flask, request, jsonify, send_from_directory, send_file, abort
)

# 复用 scrape_lyrics.py 的函数
import scrape_lyrics

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)  # 我们自己处理静态文件


# ─────────────────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────────────────

def _generated_html_files():
    """列出当前目录下所有已生成的歌词 HTML 文件（排除 index.html / 其他模板）"""
    files = []
    for name in os.listdir(BASE_DIR):
        if not name.lower().endswith('.html'):
            continue
        if name.lower() == 'index.html':
            continue
        path = os.path.join(BASE_DIR, name)
        if not os.path.isfile(path):
            continue
        # 跳过 scrape_lyrics 生成以外的：简单判断文件大小 / 开头标记
        # 这里按修改时间倒序
        st = os.stat(path)
        files.append({
            'filename': name,
            'song_name': re.sub(r'\.html$', '', name, flags=re.I),
            'size': st.st_size,
            'mtime': int(st.st_mtime),
        })
    files.sort(key=lambda f: f['mtime'], reverse=True)
    return files


# ─────────────────────────────────────────────────────────
# 路由：前端
# ─────────────────────────────────────────────────────────

@app.route('/')
def index():
    """返回前端控制台 index.html"""
    index_path = os.path.join(BASE_DIR, 'index.html')
    if not os.path.exists(index_path):
        abort(404, 'index.html not found')
    return send_file(index_path)


@app.route('/favicon.ico')
def favicon():
    # 避免无关报错
    return ('', 204)


# ─────────────────────────────────────────────────────────
# 路由：已生成的 HTML 文件
# ─────────────────────────────────────────────────────────

@app.route('/songs/<path:filename>')
def view_song(filename):
    """直接打开某个已生成的歌词 HTML"""
    # 安全：限制只能是当前目录下的 .html 文件，不允许 ../
    filename = os.path.basename(filename)
    if not filename.lower().endswith('.html'):
        abort(400, 'only .html files allowed')
    full = os.path.join(BASE_DIR, filename)
    if not os.path.isfile(full):
        abort(404, f'{filename} not found')
    return send_file(full)


# ─────────────────────────────────────────────────────────
# 路由：API
# ─────────────────────────────────────────────────────────

@app.route('/api/list', methods=['GET'])
def api_list():
    """返回已生成的 HTML 文件列表"""
    return jsonify({
        'ok': True,
        'files': _generated_html_files(),
    })


@app.route('/api/scrape', methods=['POST'])
def api_scrape():
    """
    爬取并生成歌词 HTML。
    请求: {"url": "https://projectsekai.fandom.com/wiki/..."}
    响应: {"ok": true, "song_name": "...", "filename": "...", "tabs": [...]}
        或 {"ok": false, "error": "..."}
    """
    data = request.get_json(silent=True) or {}
    url = (data.get('url') or '').strip()

    if not url:
        return jsonify(ok=False, error='缺少参数 url'), 400

    if 'projectsekai.fandom.com/wiki/' not in url:
        return jsonify(ok=False, error='URL 必须来自 projectsekai.fandom.com'), 400

    song_name = scrape_lyrics.extract_song_name(url)
    filename = scrape_lyrics.sanitize_filename(song_name) + '.html'
    output_path = os.path.join(BASE_DIR, filename)

    try:
        # 1) 抓取页面
        raw_html = scrape_lyrics.fetch_page(url)

        # 2) 解析歌词（提取 tab 数据）
        tabs_data = scrape_lyrics.parse_lyrics(raw_html)

        # 3) 生成 HTML 内容
        final_html = scrape_lyrics.generate_html(
            song_name, url.split('#')[0], tabs_data
        )

        # 4) 写入文件
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_html)

        return jsonify({
            'ok': True,
            'song_name': song_name,
            'filename': filename,
            'tabs': [t['name'] for t in tabs_data],
            'view_url': f'/songs/{filename}',
            'size_bytes': len(final_html.encode('utf-8')),
        })

    except requests.exceptions.RequestException as e:
        return jsonify(ok=False, error=f'抓取页面失败: {e}'), 502
    except ValueError as e:
        return jsonify(ok=False, error=f'解析歌词失败: {e}'), 422
    except Exception as e:
        tb = traceback.format_exc()
        return jsonify(ok=False, error=f'未预期错误: {e}', traceback=tb), 500


# 全局错误处理器：确保 4xx/5xx 返回 JSON，便于前端展示
@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(405)
@app.errorhandler(500)
def _json_error(e):
    code = getattr(e, 'code', 500)
    # 跳过已经是 jsonify 的路由内错误响应（通过判断 description）
    return jsonify(ok=False, error=str(e)), code


# ─────────────────────────────────────────────────────────
# 启动
# ─────────────────────────────────────────────────────────

def main():
    # Render 会通过 PORT 环境变量指定端口；本地可用命令行参数覆盖
    port = int(os.environ.get('PORT', 5000))
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f'无效端口: {sys.argv[1]}，使用默认 {port}')

    print('=' * 50)
    print(' Fenci 歌词控制台已启动')
    print(f'  地址: http://localhost:{port}/')
    print(f'  目录: {BASE_DIR}')
    print('=' * 50)
    # 0.0.0.0 让外部网络可以访问（Render 必需）
    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)


if __name__ == '__main__':
    main()
