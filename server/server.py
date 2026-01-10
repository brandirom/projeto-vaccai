import http.server
import socketserver
import os

PORT = 8080
DIRECTORY = "."  # Serve a pasta raiz do projeto

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Adiciona headers importantes para segurança e WASM
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

print(f"Servidor rodando em: http://localhost:{PORT}")
print(f"Para acessar a interface, vá para: http://localhost:{PORT}/web/")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()