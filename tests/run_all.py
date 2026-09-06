#!/usr/bin/env python3
# lucid 回归总入口(改动准入/部署前必跑,零第三方依赖):
#   · tests/test_*.py            后端:fixture 驱动真实函数 + 真起服务的 HTTP 全链路
#   · typecheck(可选)           node_modules/.bin/tsc 存在时跑 tsconfig.check.json(前端 .ts 测试严格类型检查)
#   · tests/frontend/test_*.ts   前端:node 无头 DOM 桩驱动编译产物;node ≥22.18 原生 type-stripping 直跑
#                                (无 node / 版本过旧则跳过并警示)
# 用法:  python3 tests/run_all.py [-v] [关键字...]      (-v 打印全量输出;关键字按文件名子串过滤)
# 约定:  任一测试退出码非 0 = 失败;全绿才允许部署(见 CLAUDE.md 铁律 5)。
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def node_runs_ts(node):
    """node 能否原生跑 .ts(type-stripping,22.18 起默认开启;23.6+ 同)。"""
    try:
        out = subprocess.run([node, '-p', 'process.versions.node'],
                             capture_output=True, text=True).stdout.strip()
        major, minor = (int(x) for x in out.split('.')[:2])
    except (ValueError, OSError):
        return False
    return major > 22 or (major == 22 and minor >= 18)


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
    tsc = REPO / 'node_modules' / '.bin' / 'tsc'
    if tsc.exists():
        suites += [([str(tsc), '-p', str(REPO / 'tsconfig.check.json')], 'typecheck.ts')]
    else:
        print('  ! 未装 devDependencies:跳过 tsc 类型检查(开发机跑一次 `npm install` 即可;测试本身不受影响)。')
    if node and node_runs_ts(node):
        suites += [([node, str(f)], f.name) for f in sorted((HERE / 'frontend').glob('test_*.ts'))]
    elif node:
        print('  ! node 版本过旧(原生跑 .ts 需 ≥22.18):跳过前端无头套件,请升级 node。')
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
