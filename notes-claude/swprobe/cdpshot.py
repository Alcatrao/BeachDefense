"""Time Page.captureScreenshot the way tooling/pages/smoke.cjs takes the claude game screenshot (19 Oct 2026, Claude).

Headless Edge, software WebGL (SwiftShader), 4 CPUs, CDP over a stdlib websocket; serves r7/r8/wip like swprobe.py.
Usage: python -I cdpshot.py <tag>=<variant>[:<extra query>] ...   -> logs/<tag>.json, shots/<tag>-*.png
"""
import base64, json, os, socket, struct, subprocess, sys, tempfile, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # our own scratch folder: reuse swprobe's server
import swprobe  # noqa: E402

SHOTS = os.path.join(HERE, 'shots')


class WS:
    def __init__(self, url, timeout):
        hostport, path = url[len('ws://'):].split('/', 1)
        host, port = hostport.split(':')
        self.s = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        self.buf = bytearray()
        while b'\r\n\r\n' not in self.buf:
            self._fill()
        head, rest = bytes(self.buf).split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise IOError(head[:200])
        self.buf = bytearray(rest)

    def _fill(self):
        chunk = self.s.recv(1 << 20)
        if not chunk:
            raise IOError('websocket closed')
        self.buf += chunk

    def _take(self, n):
        while len(self.buf) < n:
            self._fill()
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def _frame(self, op, data):
        hdr = bytearray([0x80 | op])
        n = len(data)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        self.s.sendall(bytes(hdr) + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(data)))

    def send(self, obj):
        self._frame(1, json.dumps(obj).encode())

    def recv(self):
        msg = bytearray()
        while True:
            b0, b1 = self._take(2)
            n = b1 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._take(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._take(8))[0]
            mask = self._take(4) if b1 & 0x80 else None
            payload = self._take(n)
            if mask:
                payload = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
            op = b0 & 0x0f
            if op == 8:
                raise IOError('websocket close frame')
            if op == 9:
                self._frame(10, payload)
                continue
            if op == 10:
                continue
            msg += payload
            if b0 & 0x80:
                return json.loads(msg)


class CDP:
    def __init__(self, ws):
        self.ws, self.n, self.events = ws, 0, []

    def call(self, method, params=None, timeout=60):
        self.n += 1
        mid = self.n
        self.ws.s.settimeout(timeout)
        self.ws.send({'id': mid, 'method': method, 'params': params or {}})
        while True:
            m = self.ws.recv()
            if m.get('id') == mid:
                if 'error' in m:
                    raise RuntimeError(f'{method}: {m["error"]}')
                return m.get('result', {})
            if 'method' in m:
                self.events.append((time.time(), m))

    def ev(self, expr, timeout=60):
        r = self.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True}, timeout)
        if 'exceptionDetails' in r:
            raise RuntimeError(str(r['exceptionDetails'])[:300])
        return r.get('result', {}).get('value')

    def until(self, expr, tmax, label):
        t0 = time.time()
        while time.time() - t0 < tmax:
            try:
                if self.ev(expr, timeout=tmax):
                    return time.time() - t0
            except RuntimeError:
                pass
            time.sleep(0.1)
        raise TimeoutError(label)


def run(port, tag, v, extra, nshots=3):
    os.makedirs(SHOTS, exist_ok=True)
    out = {'tag': tag, 'v': v, 'extra': extra, 't': {}, 'shots': []}
    ud = tempfile.mkdtemp(prefix=f'edge-{tag}-', dir=os.path.join(HERE, 'profiles'))
    p = subprocess.Popen([swprobe.EDGE, '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                          '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,800', '--user-data-dir=' + ud,
                          '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
                          '--mute-audio', '--disable-background-networking', '--disable-sync', '--disable-component-update',
                          'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    T0 = time.time()
    mark = lambda k: out['t'].__setitem__(k, round(time.time() - T0, 2))  # noqa: E731
    try:
        portfile = os.path.join(ud, 'DevToolsActivePort')
        while not os.path.exists(portfile) or not open(portfile).read().strip():
            if time.time() - T0 > 60:
                raise TimeoutError('DevToolsActivePort')
            time.sleep(0.1)
        dport = int(open(portfile).read().split()[0])
        targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{dport}/json/list', timeout=30))
        cdp = CDP(WS(next(t for t in targets if t['type'] == 'page')['webSocketDebuggerUrl'], 60))
        cdp.call('Runtime.enable'); cdp.call('Page.enable')
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
        url = f'http://127.0.0.1:{port}/{v}/?debug=1' + (f'&{extra}' if extra else '')
        cdp.call('Page.navigate', {'url': url}); mark('navigate')
        cdp.until("typeof document.querySelector('#startButton')?.onclick === 'function'", 120, 'startReady'); mark('startReady')
        t = time.time(); cdp.call('Page.captureScreenshot', {'format': 'png'}, 300); out['menuShot'] = round(time.time() - t, 2)
        # trusted clicks until the game starts (Start is ignored until the ghost models have loaded; smoke waits for networkidle)
        bx, by = cdp.ev("(()=>{const r=document.querySelector('#startButton').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
        started = "!!document.querySelector('canvas') && document.querySelector('#startMenu').style.display==='none'"
        for k in range(200):
            for typ in ('mouseMoved', 'mousePressed', 'mouseReleased'):
                cdp.call('Input.dispatchMouseEvent', {'type': typ, 'x': bx, 'y': by, 'button': 'left', 'clickCount': 1})
            if k == 0:
                mark('clicked')
            try:
                cdp.until(started, 1.0, 'started'); break
            except TimeoutError:
                pass
        else:
            raise TimeoutError('never started')
        mark('started'); out['clicks'] = k + 1
        cdp.ev("window.__fr=[];(function f(t){__fr.push(Math.round(t));requestAnimationFrame(f)})(0);1")
        cdp.until('!!window.__beach?.surf', 60, 'surf'); mark('surf')
        time.sleep(2.5); mark('waited2500')
        out['renderer'] = cdp.ev("(()=>{const gl=__beach.renderer.getContext(),d=gl.getExtension('WEBGL_debug_renderer_info');"
                                 "return [d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),"
                                 "__beach.renderer.getPixelRatio(),gl.drawingBufferWidth,gl.drawingBufferHeight]})()")
        for i in range(nshots):
            t = time.time()
            cdp.ev('document.fonts.ready.then(()=>1)', 300)
            fonts = time.time() - t
            res = cdp.call('Page.captureScreenshot', {'format': 'png', 'clip': {'x': 0, 'y': 0, 'width': 1280, 'height': 800, 'scale': 1},
                                                      'captureBeyondViewport': False}, 600)
            dt = time.time() - t
            with open(os.path.join(SHOTS, f'{tag}-game{i}.png'), 'wb') as fh:
                fh.write(base64.b64decode(res['data']))
            out['shots'].append({'total': round(dt, 2), 'fonts': round(fonts, 2)})
            print(f'  {tag} shot {i}: {dt:.1f}s (fonts {fonts:.1f}s)', flush=True)
        fr = cdp.ev('__fr')
        d = sorted(b - a for a, b in zip(fr[1:], fr[2:]))
        out['frames'] = {'n': len(d), 'median': d[len(d) // 2] if d else None, 'p90': d[int(len(d) * .9)] if d else None,
                         'max': d[-1] if d else None}
        out['info'] = cdp.ev("({calls:__beach.renderer.info.render.calls,tris:__beach.renderer.info.render.triangles,"
                             "programs:__beach.renderer.info.programs.length})")
        mark('done')
    except Exception as e:  # noqa: BLE001
        out['fail'] = repr(e)[:400]
    finally:
        try:
            out['errors'] = [str(m.get('params', {}))[:300] for _, m in cdp.events
                             if m['method'] in ('Runtime.exceptionThrown',) or
                             (m['method'] == 'Runtime.consoleAPICalled' and m['params'].get('type') == 'error')][:20]
        except Exception:  # noqa: BLE001
            pass
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(p.pid)], capture_output=True)
        try:
            p.wait(30)
        except subprocess.TimeoutExpired:
            pass
        time.sleep(3)
        import shutil
        shutil.rmtree(ud, ignore_errors=True)
    with open(os.path.join(swprobe.LOGS, tag + '.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print(tag, json.dumps({k: out.get(k) for k in ('t', 'menuShot', 'shots', 'frames', 'renderer', 'info', 'fail', 'clicks')}), flush=True)


def main():
    os.makedirs(swprobe.LOGS, exist_ok=True)
    os.makedirs(os.path.join(HERE, 'profiles'), exist_ok=True)
    print('affinity (had, set, ok)', swprobe.affinity4(), flush=True)
    from http.server import ThreadingHTTPServer
    srv = ThreadingHTTPServer(('127.0.0.1', 0), swprobe.H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        for spec in sys.argv[1:]:
            tag, rest = spec.split('=', 1)
            v, _, extra = rest.partition(':')
            assert v in swprobe.VARIANTS, spec
            run(port, tag, v, extra)
    finally:
        srv.shutdown()


if __name__ == '__main__':
    main()
