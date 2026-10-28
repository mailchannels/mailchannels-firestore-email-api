#!/usr/bin/env python3
"""Run real HTTPS using the production fixed endpoint on an isolated Docker loopback."""
from pathlib import Path
import subprocess
import tempfile
import sys
root=Path(__file__).resolve().parents[1]
subprocess.run(['npm','run','build'],cwd=root,check=True)
with tempfile.TemporaryDirectory(prefix='mailchannels-firebase-tls-') as fixture:
    subprocess.run([sys.executable,str(root/'test/tls/certificates.py'),fixture],check=True)
    subprocess.run(['docker','run','--rm','--network','none','--add-host','api.mailchannels.net:127.0.0.1',
        '-v',str(root)+':/app:ro','-v',fixture+':/certs:ro','-e','TLS_FIXTURE_DIR=/certs',
        '-w','/app','node:22.23.3-bookworm','node','test/tls/run.cjs'],check=True)
print('FIREBASE_TLS_CLEANUP_COMPLETE')
