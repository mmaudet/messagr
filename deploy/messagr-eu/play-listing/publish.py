#!/usr/bin/env python3
"""Sends the store listing through the Play Developer API.

# One edit, committed once

The API works in edits: open one, apply changes, commit. A run that dies in
between leaves an edit open and invisible, and the next run opens another.
So everything here happens inside one try, and a failure deletes the edit it
opened rather than leaving it behind.
"""
import json
import os
import pathlib
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build

PACKAGE = "eu.messagr"
HERE = pathlib.Path(__file__).parent

credentials = service_account.Credentials.from_service_account_info(
    json.loads(os.environ["MESSAGR_PLAY_SERVICE_ACCOUNT_JSON"]),
    scopes=["https://www.googleapis.com/auth/androidpublisher"],
)
service = build("androidpublisher", "v3", credentials=credentials)
edits = service.edits()

edit_id = edits.insert(packageName=PACKAGE, body={}).execute()["id"]
try:
    for path in sorted(HERE.glob("*.json")):
        listing = json.loads(path.read_text())
        language = listing["language"]
        edits.listings().update(
            packageName=PACKAGE,
            editId=edit_id,
            language=language,
            body={
                "title": listing["title"],
                "shortDescription": listing["shortDescription"],
                "fullDescription": listing["fullDescription"],
            },
        ).execute()
        print(f"applied {language}")
    edits.commit(packageName=PACKAGE, editId=edit_id).execute()
    print("listing committed")
except Exception:
    # Deleted rather than abandoned: an edit left open is one a later run
    # cannot see and a person cannot easily find.
    edits.delete(packageName=PACKAGE, editId=edit_id).execute()
    print("the edit was rolled back", file=sys.stderr)
    raise
