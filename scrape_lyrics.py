#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Project SEKAI Wiki 歌词爬取工具
输入歌词页面 URL，自动生成带颜色和 Tab 切换的 HTML 文件。

依赖: pip install requests beautifulsoup4 lxml

用法:
  python scrape_lyrics.py <URL>
  python scrape_lyrics.py              # 交互式输入

示例:
  python scrape_lyrics.py https://projectsekai.fandom.com/wiki/RAD_DOGS
"""

import sys
import os
import re
import requests
from bs4 import BeautifulSoup

# ── 页面抓取 ──────────────────────────────────────────────

def fetch_page(url):
    """获取 wiki 页面 HTML"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) '
                       'Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.text


# ── 歌词解析 ──────────────────────────────────────────────

def parse_lyrics(html):
    """
    解析页面 HTML，提取 Lyrics 章节的 tabber 内容。
    返回 list of {name, html, active}
    """
    soup = BeautifulSoup(html, 'lxml')

    # 找到 Lyrics 标题（<h2 id="Lyrics"> 或 <span id="Lyrics">）
    lyrics_marker = soup.find(id='Lyrics')
    if not lyrics_marker:
        raise ValueError('页面中未找到 Lyrics 章节')

    # 找到 Lyrics 后面第一个 tabber 容器
    tabber = lyrics_marker.find_next('div', class_='tabber')
    if not tabber:
        raise ValueError('Lyrics 章节下未找到 tabber（该页面可能没有多语言歌词）')

    # 提取 tab 名（Romaji / Japanese / English …）
    tab_lis = tabber.select('.wds-tabs__tab')
    tab_names = [li.get('data-hash', f'Tab{i}') for i, li in enumerate(tab_lis)]

    # 提取每个 tab 面板的内容
    content_divs = tabber.select('.wds-tab__content')
    if len(content_divs) != len(tab_names):
        raise ValueError(f'Tab 数量({len(tab_names)})与内容数量({len(content_divs)})不匹配')

    results = []
    for name, cdiv in zip(tab_names, content_divs):
        is_current = 'wds-is-current' in (cdiv.get('class') or [])
        poem = cdiv.find('div', class_='poem')
        inner_html = clean_poem_html(poem) if poem else clean_poem_html(cdiv)
        results.append({'name': name, 'html': inner_html, 'active': is_current})

    return results


def clean_poem_html(poem):
    """清理 poem 元素，返回干净的 inner HTML 字符串"""
    # 移除 copy-to-clipboard-button（按钮）
    for btn in poem.select('.copy-to-clipboard-button'):
        btn.decompose()

    # unwrap copy-to-clipboard-text（保留内容，去掉外层 div）
    for wrapper in poem.select('.copy-to-clipboard-text'):
        wrapper.unwrap()

    # 移除空段落
    for p in poem.find_all('p', class_='mw-empty-elt'):
        p.decompose()

    # 移除角色图标：歌词里 <a href="/wiki/..."><img .../></a> 是角色头像，删除 img
    for img in poem.find_all('img'):
        img.decompose()

    # 移除只包含图标的空 <a> 链接（img 已删，a 内无文字则移除）
    for a in poem.find_all('a'):
        # 去掉 href 指向 wiki 内部页面的链接（角色图标链接），保留外部翻译署名链接
        href = a.get('href', '')
        text = a.get_text(strip=True)
        if href.startswith('/wiki/') and not text:
            a.decompose()
        else:
            for attr in list(a.attrs):
                if attr not in ('href', 'target', 'rel', 'style'):
                    del a[attr]

    # 清理 span 的 class / data-* 属性（只保留 style）
    for span in poem.find_all('span'):
        for attr in list(span.attrs):
            if attr not in ('style',):
                del span[attr]

    # 反复移除空的嵌套 span（图标删除后可能残留 <span></span>，需多轮清理）
    changed = True
    while changed:
        changed = False
        for span in poem.find_all('span'):
            if not span.get_text(strip=True) and not span.find(True):
                span.decompose()
                changed = True

    # 清理 p 标签的 class / data-* 属性
    for p in poem.find_all('p'):
        for attr in list(p.attrs):
            if attr not in ('style',):
                del p[attr]

    return poem.decode_contents().strip()


# ── HTML 生成 ─────────────────────────────────────────────

CSS = """\
  * { box-sizing: border-box; }
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
  footer a { color: #62d8d8; text-decoration: none; }\
"""

JS = """\
  var buttons = document.querySelectorAll('.tab-btn');
  var panels  = document.querySelectorAll('.tab-panel');
  buttons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.tab;
      buttons.forEach(function(b) { b.classList.toggle('active', b === btn); });
      panels.forEach(function(p) { p.classList.toggle('active', p.id === target); });
    });
  });\
"""


def generate_html(song_name, source_url, tabs_data):
    """生成完整的 HTML 文件内容"""
    # 如果没有 active 的 tab，优先选 Japanese，否则第一个
    if not any(t['active'] for t in tabs_data):
        for t in tabs_data:
            if t['name'].lower() == 'japanese':
                t['active'] = True
                break
        if not any(t['active'] for t in tabs_data):
            tabs_data[0]['active'] = True

    # 构建 tab 按钮
    tab_buttons = []
    panels = []
    for t in tabs_data:
        active_cls = ' active' if t['active'] else ''
        tab_id = re.sub(r'[^a-zA-Z0-9]', '', t['name'].lower())
        tab_buttons.append(
            f'    <li><button class="tab-btn{active_cls}" '
            f'data-tab="{tab_id}" role="tab">{t["name"]}</button></li>'
        )
        panels.append(
            f'  <div id="{tab_id}" class="tab-panel{active_cls}">\n'
            f'    <div class="poem">\n{t["html"]}\n    </div>\n'
            f'  </div>'
        )

    display_name = song_name.replace('_', ' ')
    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{display_name} - 歌词</title>
<style>
{CSS}
</style>
</head>
<body>
<div class="container">
  <h1>{display_name}</h1>
  <p class="subtitle">Project SEKAI Wiki</p>
  <ul class="tabs" role="tablist">
{chr(10).join(tab_buttons)}
  </ul>
{chr(10).join(panels)}
  <footer>Source: <a href="{source_url}" target="_blank" rel="noopener">Project SEKAI Wiki</a></footer>
</div>
<script>
{JS}
</script>
</body>
</html>'''


# ── 工具函数 ──────────────────────────────────────────────

def extract_song_name(url):
    """从 URL 提取歌曲名，如 RAD_DOGS"""
    # 去掉 #fragment
    url = url.split('#')[0].rstrip('/')
    name = url.split('/wiki/')[-1] if '/wiki/' in url else url.split('/')[-1]
    return name


def sanitize_filename(name):
    """将歌曲名转为安全的文件名"""
    return re.sub(r'[^\w\-]', '_', name)


# ── 主流程 ────────────────────────────────────────────────

def main():
    # 获取 URL
    if len(sys.argv) > 1:
        url = sys.argv[1].strip()
    else:
        print('Project SEKAI Wiki 歌词爬取工具')
        print('=' * 40)
        url = input('请输入歌词页面 URL: ').strip()

    if not url:
        print('错误: 未输入 URL')
        sys.exit(1)

    # 确保 URL 格式正确
    if 'projectsekai.fandom.com/wiki/' not in url:
        print('错误: URL 需要来自 projectsekai.fandom.com')
        sys.exit(1)

    song_name = extract_song_name(url)
    print(f'歌曲: {song_name}')

    # 抓取页面
    print('正在获取页面…')
    try:
        html = fetch_page(url)
    except requests.exceptions.RequestException as e:
        print(f'获取页面失败: {e}')
        sys.exit(1)
    print(f'页面大小: {len(html):,} 字节')

    # 解析歌词
    print('正在解析歌词…')
    try:
        tabs_data = parse_lyrics(html)
    except ValueError as e:
        print(f'解析失败: {e}')
        sys.exit(1)

    print(f'找到 {len(tabs_data)} 个标签页: {", ".join(t["name"] for t in tabs_data)}')

    # 生成 HTML
    print('正在生成 HTML 文件…')
    output_html = generate_html(song_name, url.split('#')[0], tabs_data)

    # 保存文件
    filename = sanitize_filename(song_name) + '.html'
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(output_html)

    print(f'\n✅ 已生成: {output_path}')
    print(f'   双击即可在浏览器中打开查看。')


if __name__ == '__main__':
    main()
