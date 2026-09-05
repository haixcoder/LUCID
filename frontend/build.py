#!/usr/bin/env python3
# 前端构建(仅开发机需要 node/npx;插件运行时依旧零依赖——提交的是编译产物):
#   src/*.ts 按文件名序拼接(全局脚本模式) → tsc --strict 类型检查+编译 → 注入 template.html → 写 ../scripts/ccviewer/static/index.html
# 首次运行:若 template.html 不存在,自动从现有 static/index.html 抽取 HTML/CSS 壳(一次性迁移,壳内样式仍可手改 template)。
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TPL = HERE / 'template.html'
OUT = HERE.parent / 'scripts' / 'ccviewer' / 'static' / 'index.html'
TAIL = '</script></body></html>'


def ensure_template():
    if TPL.exists():
        return
    html = OUT.read_text(encoding='utf-8')
    i = html.rindex('<script>')
    assert html[html.rindex(TAIL):].startswith(TAIL), '未找到脚本尾锚点'
    TPL.write_text(html[:i] + '<script>\n/*__APP__*/\n' + html[html.rindex(TAIL):], encoding='utf-8')
    print('已自现有 index.html 抽取 template.html(一次性迁移)')


def main():
    ensure_template()
    srcs = sorted((HERE / 'src').glob('*.ts'))
    assert srcs, 'src/ 下无 .ts'
    dist = HERE / 'dist'
    dist.mkdir(exist_ok=True)
    bundle = dist / 'app.ts'
    bundle.write_text('\n'.join(f'// ▼▼ {f.name}\n' + f.read_text(encoding='utf-8') for f in srcs), encoding='utf-8')
    tsc = shutil.which('tsc')
    cmd = ([tsc] if tsc else ['npx', '-y', '-p', 'typescript@5', 'tsc']) + [
        '--strict', '--target', 'es2020', '--lib', 'es2020,dom,dom.iterable', '--module', 'none',
        '--outFile', str(dist / 'app.js'), str(bundle)]
    print('$', ' '.join(cmd))
    rc = subprocess.call(cmd)
    if rc:
        sys.exit(f'tsc 失败(exit {rc}):类型错误见上,修完再构建')
    js = (dist / 'app.js').read_text(encoding='utf-8').rstrip('\n')
    html = TPL.read_text(encoding='utf-8')
    assert '/*__APP__*/' in html and '<!--FAVICON-->' in html
    import hashlib
    import urllib.parse
    ver = hashlib.md5(js.encode('utf-8')).hexdigest()[:12]  # 与服务端 /api/runs 的 ver 算法一致(JS 载荷 md5)
    fav = urllib.parse.quote(  # 模板 href 已含 data:image/svg+xml, 前缀,这里只注入编码内容
        (HERE.parent / 'assets' / 'lucid-logo.svg').read_text(encoding='utf-8'), safe='')
    html = html.replace('/*__APP__*/', js).replace('<!--VER-->', ver).replace('<!--FAVICON-->', fav)
    OUT.write_text(html, encoding='utf-8')
    print(f'构建完成:{" + ".join(f.name for f in srcs)} → {OUT} ({len(js)} 字符 JS)')


if __name__ == '__main__':
    main()
