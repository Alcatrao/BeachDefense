"""Tiny local sink: saves POSTed canvas captures as <name>.jpg in an output folder (127.0.0.1 only)."""
import http.server, os, re, sys

PORT, OUT = int(sys.argv[1]), sys.argv[2]
os.makedirs(OUT, exist_ok=True)


class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        name = self.path.strip('/')
        n = int(self.headers.get('Content-Length', 0))
        if not re.fullmatch(r'[a-z0-9_-]{1,40}\.jpg', name) or n > 8_000_000:
            self.send_response(400); self._cors(); self.end_headers(); return
        data = self.rfile.read(n)
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(data)
        self.send_response(204); self._cors(); self.end_headers()

    def log_message(self, *a):
        pass


http.server.HTTPServer(('127.0.0.1', PORT), H).serve_forever()
