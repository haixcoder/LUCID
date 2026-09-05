#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Lucid 发布流水线:从 marketing/ 成稿抽取标题/正文 → 预填平台发帖 URL → 打开浏览器 + 剪贴板。

用法:
  python3 marketing/publish.py check                 # 验证全平台抽取结果(不碰浏览器)
  python3 marketing/publish.py <平台>                # 执行一个平台的发布流程
  python3 marketing/publish.py all                   # 按推荐顺序逐个走(Enter 下一个,q 退出)
  python3 marketing/publish.py <平台> --dry          # 只打印计划

平台: hn reddit reddit2 x devto v2ex linuxdo juejin zhihu jike wechat xhs ph

全自动通道(可选,默认仍是"预填+剪贴板+你点发布"):
  export DEVTO_API_KEY=***   → dev.to 直接发布(https://dev.to/settings/extensions)
  export V2EX_TOKEN=***      → V2EX 直接发帖(https://www.v2ex.com/settings/tokens)
没有账号态/凭证的平台无法替你点最终发布 —— 浏览器登录态在你本机,脚本把一切准备到最后一步。
"""
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = "https://github.com/haixcoder/LUCID"
IS_MAC = sys.platform == "darwin"


def _clip(text):
    subprocess.run(["pbcopy" if IS_MAC else "xclip", "-selection", "clipboard"]
                   if not IS_MAC else ["pbcopy"],
                   input=text.encode("utf-8"), check=True)


def _open(url):
    subprocess.run(["open" if IS_MAC else "xdg-open", url], check=True)


# ---------- 抽取层:成稿 .md 是内容唯一来源,防双份漂移 ----------

def _fences(path):
    """返回 [(start,end)] 顶层围栏的 (开,闭) 行号对。"""
    lines = _read(path).split("\n")
    out, start = [], None
    for i, ln in enumerate(lines):
        if ln.startswith("```"):
            if start is None:
                start = i
            else:
                out.append((start, i))
                start = None
    return [(s, e) for s, e in out]


def _read(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return f.read()


def fence_content(path, idx):
    """第 idx 个 ``` 围栏内部文本。"""
    lines = _read(path).split("\n")
    s, e = _fences(path)[idx]
    return "\n".join(lines[s + 1:e]).strip()


def heading_section(path, heading, stop_pat):
    """从 ## heading 之后取到首个匹配 stop_pat 的行(不含);用于正文是明文的稿子。"""
    lines = _read(path).split("\n")
    start = end = None
    for i, ln in enumerate(lines):
        if start is None and ln.strip() == f"## {heading}":
            start = i + 1
        elif start is not None and ln.strip().startswith(stop_pat):
            end = i
            break
    seg = lines[start:end if end is not None else len(lines)]
    # 去掉尾部遗留的 --- 分隔线
    while seg and seg[-1].strip() in ("", "---"):
        seg.pop()
    return "\n".join(seg).strip()


def first_line(text):
    return text.split("\n")[0].strip()


# ---------- 平台定义 ----------
# 每项: file, 抽取 lambda → (title, body), URL lambda → 预填地址或 None, 备注

PLATS = {
    "hn": dict(
        file="overseas/01-hacker-news-show-hn.md",
        get=lambda p: (fence_content(p, 0), fence_content(p, 2)),
        url=lambda t, b: "https://news.ycombinator.com/submit?title=%s&url=%s" % (
            urllib.parse.quote(t), urllib.parse.quote(REPO)),
        clip="body",
        note="HN 的 text 框无 GET 预填:正文已进剪贴板,粘贴后 Submit。标题已预填。"),
    "reddit": dict(
        file="overseas/02-reddit-claudeai.md",
        get=lambda p: (fence_content(p, 0), fence_content(p, 1)),
        url=lambda t, b: "https://www.reddit.com/r/ClaudeAI/submit?selftext=true&title=%s&text=%s" % (
            urllib.parse.quote(t), urllib.parse.quote(b)),
        clip=None,
        note="标题+正文全预填 → 登录态下点 Post 即可。r/ClaudeAI 置顶规则先看一眼。"),
    "reddit2": dict(
        file="overseas/02-reddit-claudeai.md",
        get=lambda p: (fence_content(p, 2), fence_content(p, 3)),
        url=lambda t, b: "https://www.reddit.com/r/ClaudeCode/submit?selftext=true&title=%s&text=%s" % (
            urllib.parse.quote(t), urllib.parse.quote(b)),
        clip=None,
        note="与 r/ClaudeAI 错开 ≥1 天发,别同天双发。"),
    "x": dict(
        file="overseas/04-x-thread.md",
        get=lambda p: (fence_content(p, 0), "\n\n".join(
            fence_content(p, i) for i in range(8))),
        url=lambda t, b: "https://x.com/compose/tweet?text=%s" % urllib.parse.quote(t[:275]),
        clip="body",
        note="第 1 推已预填(配图后发);整串 8 推在剪贴板 —— 逐推粘贴,仓库链接在第 7 推。"),
    "devto": dict(
        file="overseas/03-devto.md",
        get=lambda p: _devto(p),
        url=lambda t, b: "https://dev.to/new",
        clip="body",
        note="整篇 markdown 已进剪贴板(标题见下方打印,贴入 Title 框)。有 DEVTO_API_KEY 则直接发布。",
        api="devto"),
    "v2ex": dict(
        file="cn/03-v2ex.md",
        get=lambda p: (fence_content(p, 0), heading_section(p, "正文", "**注意**")),
        url=lambda t, b: "https://www.v2ex.com/go/share",
        clip="body",
        note="正文已进剪贴板;标题:见下。登录态下 New 主题 → 选 share 节点粘贴。有 V2EX_TOKEN 则 API 直发。",
        api="v2ex"),
    "linuxdo": dict(
        file="cn/02-linuxdo.md",
        get=lambda p: (fence_content(p, 0), heading_section(p, "正文", "**回帖预案**")),
        url=lambda t, b: "https://linux.do/new-topic?title=%s&body=%s" % (
            urllib.parse.quote(t), urllib.parse.quote(b)),
        clip="body",
        note="标题+正文已预填,选「分享发现」分类后发布;占位图行发布前替换成真实上传。"),
    "juejin": dict(
        file="cn/01-juejin.md",
        get=lambda p: (fence_content(p, 0), heading_section(p, "正文", "**发布提醒**")),
        url=lambda t, b: "https://juejin.cn/writing",
        clip="body",
        note="正文已进剪贴板 → 编辑器粘贴(md 自动转),标题见下;标签按稿尾提示勾,占位图替换后发布。"),
    "zhihu": dict(
        file="cn/05-zhihu.md",
        get=lambda p: ("", fence_content(p, 0)),
        url=lambda t, b: "https://www.zhihu.com/search?type=content&q=Claude%20Code%20%E6%8F%92%E4%BB%B6",
        clip="body",
        note="答题策略:挑关注多/回答少的问题点「回答」,正文已在剪贴板。文章版从掘金稿迁移。"),
    "jike": dict(
        file="cn/04-jike.md",
        get=lambda p: ("", fence_content(p, 0)),
        url=lambda t, b: "https://web.okjike.com",
        clip="body",
        note="版本 A 已进剪贴板 → 发「AI 编程」圈子;链接放自己评论区(稿内有)。"),
    "wechat": dict(
        file="cn/06-wechat-mp.md",
        get=lambda p: (fence_content(p, 0), heading_section(p, "正文", "**运营备注**")),
        url=lambda t, b: "https://mp.weixin.qq.com",
        clip="body",
        note="登录公众平台 → 新的图文;正文已进剪贴板(用 doocs/md 排版)。标题见下;「阅读原文」挂 REPO。"),
    "xhs": dict(
        file="cn/07-xiaohongshu.md",
        get=lambda p: (fence_content(p, 0), fence_content(p, 1)),
        url=lambda t, b: "https://creator.xiaohongshu.com/publish/publish",
        clip="body",
        note="正文已进剪贴板;标题(≤20字)见下;6 图按稿内计划上传。"),
    "ph": dict(
        file="overseas/05-product-hunt.md",
        get=lambda p: (first_line(fence_content(p, 0)), fence_content(p, 1)),
        url=lambda t, b: "https://www.producthunt.com/",
        clip="body",
        note="短描述已进剪贴板;tagline/长描述/maker 首评在稿内逐项粘贴。PH 建议预热 3-5 天后再上。"),
}


def _devto(path):
    """frontmatter 抽 title;正文 = 第二组 --- 之后,去掉与 title 重复的 H1。"""
    lines = _read(path).split("\n")
    dashes = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    fm = "\n".join(lines[dashes[0] + 1:dashes[1]])
    title = ""
    for ln in fm.split("\n"):
        if ln.startswith("title:"):
            title = ln.split(":", 1)[1].strip().strip('"')
    body = "\n".join(lines[dashes[1] + 1:]).strip()
    if body.startswith("# "):                      # dev.to 用 title 字段做 H1,正文首个 H1 去掉
        body = "\n".join(body.split("\n")[1:]).lstrip()
    return title, body


# ---------- API 全自动通道 ----------

def api_devto(title, body_md):
    key = os.environ.get("DEVTO_API_KEY")
    if not key:
        return None
    payload = json.dumps({"article": {
        "title": title, "body_markdown": body_md,
        "tags": ["claudecode", "ai", "opensource", "webdev"], "published": True}}).encode()
    req = urllib.request.Request("https://dev.to/api/articles", data=payload, headers={
        "api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("url")


def api_v2ex(title, body):
    token = os.environ.get("V2EX_TOKEN")
    if not token:
        return None
    data = urllib.parse.urlencode({
        "token": token, "node_name": "share", "title": title, "content": body}).encode()
    req = urllib.request.Request("https://www.v2ex.com/api/topics/create.json", data=data)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("url")


# ---------- 执行 ----------

def run(key, dry=False, quiet=False):
    spec = PLATS[key]
    title, body = spec["get"](spec["file"])
    url = spec["url"](title, body)
    if not quiet:
        print("── [%s] %s" % (key, title or "(无标题)"))
        print("   正文 %d 字 | %s" % (len(body), spec["note"]))
    if dry:
        print("   (dry) URL: %s" % (url[:120] + ("…" if len(url) > 120 else "")))
        return True

    if spec.get("api"):
        try:
            pub = {"devto": api_devto, "v2ex": api_v2ex}[spec["api"]](title, body)
            if pub:
                print("   ✅ API 已直接发布: %s" % pub)
                return True
        except Exception as e:                       # 失败回落半自动
            print("   ⚠ API 发布失败(%s),回落半自动流程" % e)

    if spec["clip"] == "body":
        _clip(body)
    _open(url)
    print("   ▶ 已打开 %s%s" % (url.split("?")[0], "  | 正文已进剪贴板" if spec["clip"] else ""))
    return True


QUEUE = ["devto", "hn", "reddit", "x", "linuxdo", "juejin", "v2ex", "zhihu", "jike", "wechat", "xhs"]


def main():
    args = [a for a in sys.argv[1:]]
    dry = "--dry" in args
    args = [a for a in args if a != "--dry"]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    what = args[0]
    if what == "check":
        for k in PLATS:
            run(k, dry=True)
        print("\ncheck 完成(未动剪贴板/浏览器)")
        return
    if what == "all":
        for k in QUEUE:
            run(k)
            ans = input("   ↳ 下一个 [Enter=继续 / s=跳过 / q=退出] > ").strip().lower()
            if ans == "q":
                print("队列中止。")
                return
        print("\n队列完成。剩 ph(需预热)与 awesome 清单(提 PR)按 README 节奏另行安排。")
        return
    if what not in PLATS:
        sys.exit("未知平台 %r;可选: %s all check" % (what, " ".join(PLATS)))
    run(what, dry=dry)


if __name__ == "__main__":
    main()
