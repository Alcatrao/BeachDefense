"""SwiftShader probe for the Pages smoke timeout (19 Oct 2026, Claude).

Serves r7 (c1d874e), r8 (7b14b70), s8 (635ef93, the software-WebGL tier), r9 (1220921) and wip (the working tree) on 127.0.0.1
and opens each in headless Edge with software WebGL on 4 CPUs (like the CI runner); probe.html logs its timings to
logs/<tag>.jsonl.
Usage: python -I swprobe.py <tag>=<variant>[:<prof 0|1>[:<extra query>]] ...
"""
import ctypes, json, os, re, shutil, subprocess, sys, tempfile, threading, time
from ctypes import wintypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import quote, unquote

W = r'E:\AI_Workspaces\BeachDefense\branches\claude'
HERE = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.join(HERE, 'logs')
COMMITS = {'r7': 'c1d874e', 'r8': '7b14b70', 's8': '635ef93', 'r9': '1220921'}
VARIANTS = ('r7', 'r8', 's8', 'r9', 'wip')
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
        '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'}
cache, lock, done = {}, threading.Lock(), {}


def blob(v, rel):
    if v == 'wip':
        full = os.path.normpath(os.path.join(W, rel))
        if not full.startswith(W + os.sep) or not os.path.isfile(full):
            return None
        with open(full, 'rb') as fh:
            return fh.read()
    key = (COMMITS[v], rel)
    with lock:
        if key in cache:
            return cache[key]
    r = subprocess.run(['git', '-C', W, 'show', f'{COMMITS[v]}:{rel}'], capture_output=True)
    data = r.stdout if r.returncode == 0 else None
    with lock:
        cache[key] = data
    return data


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        pass

    def reply(self, code, data=b'', ctype='text/plain'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = unquote(self.path.split('?', 1)[0].split('#', 1)[0])
        if '..' in path.split('/') or '\\' in path:
            return self.reply(400)
        if path == '/probe.html':
            with open(os.path.join(HERE, 'probe.html'), 'rb') as fh:
                return self.reply(200, fh.read(), MIME['.html'])
        parts = path.lstrip('/').split('/', 1)
        if parts[0] in VARIANTS and len(parts) == 2:
            v, rel = parts
        else:  # root-absolute requests such as /Yew_Wand.glb
            v, rel = 'wip', path.lstrip('/')
        rel = re.sub(r'/+', '/', rel)  # the CI server resolves 'assets//x' too
        if rel == '' or rel.endswith('/'):
            rel += 'index.html'
        data = blob(v, rel)
        if data is None:
            return self.reply(404)
        self.reply(200, data, MIME.get(os.path.splitext(rel)[1].lower(), 'application/octet-stream'))

    def do_POST(self):
        m = re.fullmatch(r'/log/([a-z0-9_-]{1,40})', self.path)
        n = int(self.headers.get('Content-Length') or 0)
        if not m or n > 2_000_000:
            return self.reply(400)
        body, tag = self.rfile.read(n), m.group(1)
        with lock:
            with open(os.path.join(LOGS, tag + '.jsonl'), 'ab') as fh:
                fh.write(body.replace(b'\n', b' ') + b'\n')
            ev = done.get(tag)
        try:
            if json.loads(body).get('final') and ev:
                ev.set()
        except ValueError:
            pass
        self.reply(204)


def affinity4():
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.GetCurrentProcess.restype = wintypes.HANDLE
    k.GetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t)]
    k.SetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_size_t]
    h, pm, sm = k.GetCurrentProcess(), ctypes.c_size_t(), ctypes.c_size_t()
    k.GetProcessAffinityMask(h, ctypes.byref(pm), ctypes.byref(sm))
    mask = sum(1 << i for i in [i for i in range(64) if pm.value >> i & 1][:4])
    return hex(pm.value), hex(mask), bool(k.SetProcessAffinityMask(h, mask))


def run(port, tag, v, prof, extra, tmax):
    log = os.path.join(LOGS, tag + '.jsonl')
    if os.path.exists(log):
        os.remove(log)
    ud = tempfile.mkdtemp(prefix=f'edge-{tag}-', dir=os.path.join(HERE, 'profiles'))
    url = f'http://127.0.0.1:{port}/probe.html?v={v}&tag={tag}&prof={prof}' + (f'&extra={quote(extra, safe="")}' if extra else '')
    ev = threading.Event()
    with lock:
        done[tag] = ev
    p = subprocess.Popen([EDGE, '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                          '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,900', '--user-data-dir=' + ud,
                          '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
                          '--disable-background-networking', '--disable-sync', '--disable-component-update', url],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t0 = time.time()
    ok = ev.wait(tmax)
    dt = time.time() - t0
    subprocess.run(['taskkill', '/T', '/F', '/PID', str(p.pid)], capture_output=True)
    try:
        p.wait(30)
    except subprocess.TimeoutExpired:
        pass
    time.sleep(3)
    shutil.rmtree(ud, ignore_errors=True)
    print(f'{tag}: v={v} prof={prof} extra={extra!r} final={ok} {dt:.0f}s', flush=True)


def main():
    os.makedirs(LOGS, exist_ok=True)
    os.makedirs(os.path.join(HERE, 'profiles'), exist_ok=True)
    print('affinity (had, set, ok)', affinity4(), flush=True)
    srv = ThreadingHTTPServer(('127.0.0.1', 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print('port', port, flush=True)
    try:
        for spec in sys.argv[1:]:
            tag, rest = spec.split('=', 1)
            v, prof, extra = (rest.split(':', 2) + ['1', ''][len(rest.split(':', 2)) - 1:])[:3]
            assert re.fullmatch(r'[a-z0-9_-]{1,40}', tag) and v in VARIANTS and prof in ('0', '1'), spec
            run(port, tag, v, prof, extra, 360)
    finally:
        srv.shutdown()


if __name__ == '__main__':
    main()
