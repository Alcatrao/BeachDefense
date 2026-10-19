"""Summarise swprobe logs: python -I swreport.py <tag> ..."""
import json, os, sys

LOGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')


def stats(xs):
    if not xs:
        return 'none'
    s = sorted(xs)
    return f'n={len(s)} median={s[len(s) // 2]} p90={s[int(len(s) * 0.9)]} max={s[-1]} ms'


for tag in sys.argv[1:]:
    path = os.path.join(LOGS, tag + '.jsonl')
    if not os.path.exists(path):
        print(f'== {tag}: no log')
        continue
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    live = [r for r in rows if 'live' in r]
    full = [r for r in rows if 'ev' in r]
    last = full[-1] if full else {}
    print(f"== {tag}: v={last.get('v')} final={last.get('final')} rows={len(rows)}")
    print('  info', json.dumps(last.get('info', {})))
    print('  events', ' '.join(f'{k}@{t / 1000:.1f}s' + (f'({x})' if x else '') for t, k, x in last.get('ev', [])))
    ev = {k: t for t, k, x in last.get('ev', [])}
    fr = last.get('frames', [])
    click, started = ev.get('clicked', 1e12), ev.get('started', 1e12)
    print('  menu frames', stats([d for t, d in fr if t <= click]))
    print('  game frames', stats([d for t, d in fr if t >= started]))
    pp = sorted(last.get('perProg', {}).items(), key=lambda kv: -kv[1]['ms'])
    for name, P in pp[:14]:
        print(f"  {name:48s} draws={P['n']:4d} total={P['ms'] / 1000:7.1f}s mean={P['ms'] / max(P['n'], 1):7.1f}ms "
              f"max={P['max']:7.0f} first={P['firstMs']} inst={P['inst']} cnt={P['cnt']}")
    if live:
        print('  last live', json.dumps(live[-1]))
    sl = last.get('slow', [])
    if sl:
        print('  slow draws (t, prog, ms):', ' '.join(f'{t / 1000:.0f}s:{n.split(":")[0]}:{ms}' for t, n, ms, i, c in sl[:30]))
