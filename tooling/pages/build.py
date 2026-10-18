"""Package independent, published game snapshots; never export assistant notes."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '_site'
VERSIONS = {'original': ('HEAD', ''), 'codex': ('origin/codex/breaking-surf', 'codex'),
            'claude': ('origin/claude/shorebreak-waves', 'claude')}


def build():
    if OUT.exists():
        raise RuntimeError('Build requires a fresh _site directory')
    manifest = {}
    for name, (ref, folder) in VERSIONS.items():
        sha = subprocess.check_output(['git', 'rev-parse', ref], cwd=ROOT, text=True).strip()
        archive = subprocess.check_output(['git', 'archive', '--format=zip', sha], cwd=ROOT)
        files = {}
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            for entry in z.infolist():
                p = Path(entry.filename)
                if entry.is_dir() or not (p.parts[0] in ('js', 'assets', 'textures') or
                                         (len(p.parts) == 1 and p.suffix == '.html')):
                    continue
                if '..' in p.parts or p.is_absolute() or entry.external_attr >> 16 & 0o170000 == 0o120000:
                    raise RuntimeError('Unsafe archive entry: ' + entry.filename)
                data = z.read(entry)
                target = OUT / folder / p
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                files[entry.filename] = hashlib.sha256(data).hexdigest()
        manifest[name] = {'branch': 'main' if name == 'original' else ref.removeprefix('origin/'),
                          'commit': sha, 'path': folder or '.', 'files': files}
    (OUT / '.nojekyll').touch()
    (OUT / 'versions.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    print(json.dumps({k: {f: v[f] for f in ('branch', 'commit', 'path')} for k, v in manifest.items()}, indent=2))


if __name__ == '__main__':
    build()
