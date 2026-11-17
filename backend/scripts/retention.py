"""Operator-only preview/apply workflow. The public UUID header grants no deletion authority."""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from app import db, retention


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preview", "apply"))
    parser.add_argument("--db", default=db.DB_PATH)
    parser.add_argument("--plan", required=True, help="Protected JSON approval plan; preview refuses to overwrite it")
    parser.add_argument("--user-id-file", help="Verified requester's device ID in a private UTF-8 file")
    parser.add_argument("--backup", help="Optional new SQLite backup file before applying; existing files are never overwritten")
    args = parser.parse_args(argv)
    user = Path(args.user_id_file).read_text(encoding="utf-8").strip() if args.user_id_file else None
    if args.action == "preview":
        if args.backup:
            parser.error("Backups are only created during an approved apply")
        conn = retention.open_database(args.db)
        try:
            plan = retention.make_plan(conn, args.db, user=user)
        finally:
            conn.close()
        with Path(args.plan).open("x", encoding="utf-8") as output:
            json.dump(plan, output, ensure_ascii=False, indent=2)
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    if plan["database"] != str(Path(args.db).resolve(strict=True)):
        parser.error("Plan belongs to another database")
    if (plan["scope"] == "user") != (user is not None):
        parser.error("User deletion requires the same verified --user-id-file")
    conn = retention.open_database(args.db, readonly=False)
    try:
        # Check before creating a backup, then check once more inside the write transaction.
        if retention.make_plan(conn, args.db, cutoff=plan["cutoff_utc"], user=user) != plan:
            parser.error("Plan changed; preview and obtain approval again")
        if args.backup:
            with Path(args.backup).open("xb"):
                pass
            destination = sqlite3.connect(args.backup)
            try:
                conn.backup(destination)
            finally:
                destination.close()
        counts = retention.apply_plan(conn, args.db, plan, user=user)
        print(json.dumps({"deleted": counts}, ensure_ascii=False))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
