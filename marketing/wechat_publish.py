#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""公众号全自动发布:文案从 cn/06-wechat-mp.md 抽取,凭证读 ~/.config/md2wechat/config.yaml。

流程:access_token → 上传封面(assets/screenshot.png,永久素材) → 新建草稿(draft/add)
     → 尝试正式发布(freepublish/submit;个人未认证主体无此权限时,自动停在草稿箱)。
用法: python3 marketing/wechat_publish.py [--dry]   # --dry 只渲染 HTML 预览,不碰 API
"""
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from html import escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish as pub  # noqa: E402  复用成稿抽取

CONF = os.path.expanduser("~/.config/md2wechat/config.yaml")
REPO = pub.REPO


def creds():
    txt = open(CONF, encoding="utf-8").read()
    appid = re.search(r'appid:\s*"?([^"\n]+)"?', txt).group(1).strip()
    secret = re.search(r'secret:\s*"?([^"\n]+)"?', txt).group(1).strip()
    return appid, secret


def api_get(path):
    appid, secret = creds()
    url = ("https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential"
           "&appid=%s&secret=%s" % (appid, secret))
    tok = json.load(urllib.request.urlopen(url, timeout=20))["access_token"]
    return path.replace("{}", tok)


def call(path_fmt, payload=None, post_json=True):
    url = api_get(path_fmt)
    if payload is None:
        return json.load(urllib.request.urlopen(url, timeout=30))
    data = json.dumps(payload, ensure_ascii=False).encode() if post_json else payload
    req = urllib.request.Request(url, data=data)
    return json.load(urllib.request.urlopen(req, timeout=60))


# ---------- markdown → 公众号 HTML(内联样式,最小口径) ----------

def md2html(md):
    out, in_code, code_buf, ul = [], False, [], False
    def flush_ul():
        nonlocal ul
        if ul:
            out.append("</ul>")
            ul = False
    for raw in md.split("\n"):
        ln = raw.rstrip()
        if ln.startswith("```"):
            if in_code:
                out.append("<pre style=\"background:#f7f7f7;padding:12px;border-radius:4px;"
                           "font-size:14px;overflow-x:auto;line-height:1.5\"><code>%s</code></pre>"
                           % escape("\n".join(code_buf)))
                code_buf, in_code = [], False
            else:
                flush_ul()
                in_code = True
            continue
        if in_code:
            code_buf.append(ln)
            continue
        if not ln.strip():
            flush_ul()
            continue
        m = re.match(r"^(#{2,4})\s+(.*)$", ln)
        if m:
            flush_ul()
            lvl = len(m.group(1))
            out.append('<h%d style="font-size:%dpx;font-weight:700;margin:1.4em 0 .7em">%s</h%d>'
                       % (lvl, 20 - (lvl - 2) * 2, inline(m.group(2)), lvl))
            continue
        m = re.match(r"^!\[(.*?)\]\((.*?)\)", ln.strip())
        if m:
            flush_ul()
            label = m.group(1) or "配图"
            out.append('<p style="color:#888;font-size:14px">【插入截图:%s】</p>' % escape(label))
            continue
        m = re.match(r"^>\s?(.*)$", ln)
        if m:
            flush_ul()
            out.append('<blockquote style="border-left:3px solid #ddd;margin:1em 0;padding:.4em 1em;'
                       'color:#555;background:#fafafa">%s</blockquote>' % inline(m.group(1)))
            continue
        m = re.match(r"^[-•]\s+(.*)$", ln)
        if m:
            if not ul:
                out.append('<ul style="padding-left:1.4em">')
                ul = True
            out.append("<li>%s</li>" % inline(m.group(1)))
            continue
        flush_ul()
        out.append("<p>%s</p>" % inline(ln))
    flush_ul()
    return "\n".join(out)


def inline(s):
    s = escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`",
               r'<code style="background:#f2f2f2;padding:1px 5px;border-radius:3px;'
               r'font-size:90%">\1</code>', s)
    s = re.sub(r"\[(.*?)\]\((https?://[^)]+)\)", r'\1(<a href="%2" style="color:#576b95">%2</a>)'
               .replace("%2", "\\2"), s)
    return s


def main():
    title, body_md = pub.PLATS["wechat"]["get"](pub.PLATS["wechat"]["file"])
    digest = re.search(r"摘要\(117 字内\)\*{0,2}[:：]\s*(.+)",
                       open(os.path.join(HERE, pub.PLATS["wechat"]["file"]), encoding="utf-8")
                       .read()).group(1).strip()[:118]
    html = md2html(body_md)
    if "--dry" in sys.argv:
        print("TITLE:", title)
        print("DIGEST:", digest)
        print(html[:1200], "\n…(dry 结束)")
        return
    # 1) 封面(已有同名素材直接复用?简单起见每次新增)
    img = os.path.join(HERE, "..", "assets", "screenshot.png")
    mp = subprocess.run(
        ["curl", "-s", "--max-time", "60",
         "-F", "media=@%s" % img,
         api_get("https://api.weixin.qq.com/cgi-bin/material/add_material?access_token={}&type=image")],
        capture_output=True, text=True)
    r = json.loads(mp.stdout)
    assert "media_id" in r, "封面上传失败: %s" % r
    thumb = r["media_id"]
    # 2) 草稿
    r = call("https://api.weixin.qq.com/cgi-bin/draft/add?access_token={}", {"articles": [{
        "title": title, "author": "yanghai", "digest": digest,
        "content": html, "thumb_media_id": thumb,
        "content_source_url": REPO, "need_open_comment": 1, "only_fans_can_comment": 0}]})
    assert "media_id" in r, "草稿创建失败: %s" % r
    draft_id = r["media_id"]
    print("✔ 草稿已创建:", draft_id)
    # 3) 正式发布(未认证主体会失败 → 停草稿箱,一键后台发布)
    r = call("https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token={}",
             {"media_id": draft_id})
    if r.get("errcode") == 0:
        print("✅ 已正式发布!回执:", r.get("publish_id"))
    else:
        print("ℹ 账号无 API 发布权限(errcode %s) —— 内容已全部进【草稿箱】,"
              "mp.weixin.qq.com → 草稿箱 → 这头条 → 发布,一次点击。" % r.get("errcode"))


if __name__ == "__main__":
    main()
