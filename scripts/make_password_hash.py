"""Génère le hash SHA-256 à coller dans PASSWORD_HASH (access-gate.js).

Usage : python scripts/make_password_hash.py "mon-mot-de-passe"
"""
import hashlib
import sys

if len(sys.argv) < 2:
    print('Usage : python scripts/make_password_hash.py "mon-mot-de-passe"')
    sys.exit(1)

password = sys.argv[1]
print(hashlib.sha256(password.encode("utf-8")).hexdigest())
