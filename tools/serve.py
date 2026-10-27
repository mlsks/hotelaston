"""
Serveur de développement du site (équivalent de `python -m http.server`) avec :
- les requêtes Range (206 Partial Content), indispensables à Safari / iOS pour lire les vidéos ;
- Cache-Control: no-cache, pour que chaque modification apparaisse au rechargement
  (le navigateur revalide avec Last-Modified et reçoit 304 si rien n'a changé).

usage : python tools/serve.py [--port 8765] [--bind 127.0.0.1] [--directory .]
        --bind 0.0.0.0 pour l'ouvrir aux appareils du même Wi-Fi.
"""
import argparse
import os
import re
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


class RangeHandler(SimpleHTTPRequestHandler):
    _remaining = None  # octets restant à envoyer pour une réponse 206

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        header = self.headers.get("Range")
        path = self.translate_path(self.path)
        match = RANGE.match(header.strip()) if header else None
        if not match or not os.path.isfile(path):
            return super().send_head()

        size = os.path.getsize(path)
        first, last = match.groups()
        if first == "":  # suffixe : bytes=-N (les N derniers octets)
            start, end = max(0, size - int(last or 0)), size - 1
        else:
            start, end = int(first), min(int(last) if last else size - 1, size - 1)
        if start >= size or start > end:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        f = open(path, "rb")
        f.seek(start)
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        if self._remaining is None:
            return super().copyfile(source, outputfile)
        remaining, self._remaining = self._remaining, None
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--directory", default=root)
    args = parser.parse_args()
    handler = partial(RangeHandler, directory=args.directory)
    with ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        print(f"Site servi sur http://{args.bind}:{args.port}/ (dossier {args.directory})", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
