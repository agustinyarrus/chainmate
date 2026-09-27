"""Downloads subtrees of godotengine/godot at a tag into this folder (curl in parallel, resumable)."""
import json, os, subprocess, sys, tempfile

TAG = '4.7.2-stable'
REPO = 'godotengine/godot'
RAW = f'https://raw.githubusercontent.com/{REPO}/{TAG}/'

def api(path):
    out = subprocess.run(['gh', 'api', f'repos/{REPO}/{path}'], capture_output=True, text=True, encoding='utf-8')
    if out.returncode != 0:
        raise SystemExit(f'gh api {path}: {out.stderr.strip()}')
    return json.loads(out.stdout)

def subtree_sha(path):
    sha = TAG
    for part in path.split('/'):
        tree = api(f'git/trees/{sha}')
        match = [e for e in tree['tree'] if e['path'] == part and e['type'] == 'tree']
        if not match:
            raise SystemExit(f'{part} not found under {path}')
        sha = match[0]['sha']
    return sha

def main(paths):
    wanted = []
    for path in paths:
        tree = api(f'git/trees/{subtree_sha(path)}?recursive=1')
        if tree.get('truncated'):
            raise SystemExit(f'{path}: listing truncated')
        files = [(f"{path}/{e['path']}", e['size']) for e in tree['tree'] if e['type'] == 'blob']
        print(f'{path}: {len(files)} files, {sum(s for _, s in files) / 1e6:.1f} MB')
        wanted += files
    missing = [(p, s) for p, s in wanted if not (os.path.exists(p) and os.path.getsize(p) == s)]
    print(f'to download: {len(missing)}')
    if not missing:
        return
    with tempfile.NamedTemporaryFile('w', suffix='.cfg', delete=False, encoding='utf-8') as cfg:
        for path, _ in missing:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            cfg.write(f'url = "{RAW}{path}"\noutput = "{path}"\n')
        name = cfg.name
    subprocess.run(['curl', '-sS', '--ssl-no-revoke', '--parallel', '--parallel-max', '16', '--retry', '3', '--fail', '-K', name], check=True)
    os.unlink(name)
    bad = [(p, s) for p, s in wanted if not (os.path.exists(p) and os.path.getsize(p) == s)]
    print('incomplete:', len(bad), bad[:5])

main(sys.argv[1:])
