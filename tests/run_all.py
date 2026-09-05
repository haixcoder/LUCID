#!/usr/bin/env python3
# xray 回归总入口(改动准入/部署前必跑,零第三方依赖):
#   · tests/test_*.py            后端:fixture 驱动真实函数 + 真起服务的 HTTP 全链路
#   · tests/frontend/test_*.js   前端:node 无头 DOM 桩驱动编译产物(无 node 则跳过并警示)
# 用法:  python3 tests/run_all.py [-v] [关键字...]      (-v 打印全量输出;关键字按文件名子串过滤)
# 约定:  任一测试退出码非 0 = 失败;全绿才允许部署(见 CLAUDE.md 铁律 5)。
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(cmd, label):
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True)
    out = (p.stdout or '') + (p.stderr or '')
    ok = p.returncode == 0
    n_pass = sum(1 for ln in out.splitlines() if ln.startswith('✓') or '✓ ' in ln[:3])
    print(('  ✓ ' if ok else '  ✗ ') + '%-28s %4.1fs  (%d 断言)' % (label, time.time() - t0, n_pass))
    if not ok or '-v' in sys.argv:
        for ln in out.rstrip().splitlines():
            print('      │ ' + ln)
    return ok


def main():
    args = [a for a in sys.argv[1:] if a != '-v']
    node = shutil.which('node')
    suites = [(['python3', '-X', 'dev', str(f)], f.name) for f in sorted(HERE.glob('test_*.py'))]
    if node:
        suites += [([node, str(f)], f.name) for f in sorted((HERE / 'frontend').glob('test_*.js'))]
    else:
        print('  ! node 不在 PATH:跳过前端无头套件(开发机需 node;CI 同理)。')
    suites = [(c, l) for c, l in suites if not args or any(a in l for a in args)]
    if not suites:
        sys.exit('无匹配测试')
    t0 = time.time()
    bad = [l for c, l in suites if not run(c, l)]
    print('\n%s  %d/%d 通过, 共 %.1fs' % ('GREEN ✓' if not bad else 'RED ✗ 失败: ' + ', '.join(bad),
                                          len(suites) - len(bad), len(suites), time.time() - t0))
    return 1 if bad else 0


if __name__ == '__main__':
    os.environ.setdefault('PYTHONDONTWRITEBYTECODE', '1')
    sys.exit(main())
