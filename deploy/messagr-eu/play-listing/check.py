#!/usr/bin/env python3
"""Play's limits, checked before anything is sent.

The API rejects an over-long field at the end of an edit, after the edit has
been opened and the other fields applied. Checking here means a listing that
cannot be accepted never opens one.
"""
import json
import pathlib
import sys

LIMITS = {"title": 30, "shortDescription": 80, "fullDescription": 4000}
HERE = pathlib.Path(__file__).parent

failed = False
for path in sorted(HERE.glob("*.json")):
    listing = json.loads(path.read_text())
    for field, cap in LIMITS.items():
        value = listing.get(field, "")
        if not value:
            print(f"FAIL {path.name}: {field} is empty", file=sys.stderr)
            failed = True
        elif len(value) > cap:
            print(
                f"FAIL {path.name}: {field} is {len(value)} characters, "
                f"and Play allows {cap}",
                file=sys.stderr,
            )
            failed = True
        else:
            print(f"OK   {path.name}: {field} {len(value)}/{cap}")

sys.exit(1 if failed else 0)
