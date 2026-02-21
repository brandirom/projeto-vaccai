import http.server
import socketserver
import os

PORT = 8080
# MUDANÇA: Agora o servidor foca apenas na pasta 'public'
DIRECTORY = "public" 

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # O directory=DIRECTORY garante que ele sirva os arquivos de dentro da public
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Headers essenciais para o WASM funcionar (SharedArrayBuffer)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

print(f"Servidor rodando em: http://localhost:{PORT}")
# A URL fica limpa, direto na raiz
print(f"Acesse seu site aqui: http://localhost:{PORT}")

# Permite reutilizar a porta caso feche e abra rápido (opcional, mas útil)
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor parado.")