"""Generate disposable local fixture certificates; never provider credentials."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
now = datetime.now(timezone.utc)
def key(): return rsa.generate_private_key(public_exponent=65537, key_size=2048)
def name(value): return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, value)])
def save(prefix, private, cert):
    (out / (prefix+'.key')).write_bytes(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    (out / (prefix+'.crt')).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
ca_key = key()
ca = x509.CertificateBuilder().subject_name(name('Isolated Firebase Test CA')).issuer_name(name('Isolated Firebase Test CA')).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).sign(ca_key,hashes.SHA256())
save('ca',ca_key,ca)
for label,host,expired,self_signed in [('valid','api.mailchannels.net',False,False),('wrong-host','wrong.example.com',False,False),('expired','api.mailchannels.net',True,False),('untrusted','api.mailchannels.net',False,True)]:
    private = key()
    cert = x509.CertificateBuilder().subject_name(name(host)).issuer_name(name(host) if self_signed else ca.subject).public_key(private.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=3)).not_valid_after(now-timedelta(days=1) if expired else now+timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]),critical=False).sign(private if self_signed else ca_key,hashes.SHA256())
    save(label,private,cert)
