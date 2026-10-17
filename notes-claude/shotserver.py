import http.server, base64, sys, os
OUT = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def _c(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
    def do_OPTIONS(self):
        self.send_response(204); self._c(); self.end_headers()
    def do_POST(self):
        n = int(self.headers['Content-Length']); data = self.rfile.read(n).decode()
        name = os.path.basename(self.path.strip('/')) or 'shot.jpg'
        b = base64.b64decode(data.split(',', 1)[1])
        open(os.path.join(OUT, name), 'wb').write(b)
        self.send_response(200); self._c(); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 8772), H).serve_forever()
