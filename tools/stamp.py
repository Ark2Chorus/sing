"""Stamp every ?v= address in index.html and service-worker.js with a hash of
that file's contents.

Run after changing anything under css/, js/, data/, vendor/ or icons/logo.jpg:

    py tools/stamp.py

A changed file gets a new address, so the browser and the service worker load
it fresh; an unchanged one keeps its address, and phones keep the copy they
already saved instead of downloading it again.
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ['index.html', 'service-worker.js']
REF = re.compile(r'((?:css|js|data|vendor|icons)/[\w.\-]+)\?v=[0-9a-f]*')


def digest(rel):
    path = ROOT / rel
    if not path.is_file():
        sys.exit('stamp: %s is referenced but missing' % rel)
    return hashlib.sha1(path.read_bytes()).hexdigest()[:10]


def main():
    for name in TARGETS:
        path = ROOT / name
        text = path.read_bytes().decode('utf-8')
        new, count = REF.subn(lambda m: '%s?v=%s' % (m.group(1), digest(m.group(1))), text)
        if new != text:
            path.write_bytes(new.encode('utf-8'))
        print('%s: %d address(es) stamped%s' % (name, count, '' if new != text else ', unchanged'))


if __name__ == '__main__':
    main()
