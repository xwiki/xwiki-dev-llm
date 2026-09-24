"""Shared helpers for talking to jira.xwiki.org (self-hosted JIRA Server / Data Center).

Auth: a personal access token used as a bearer token, read from the environment
(JIRA_API_TOKEN, falling back to JIRA_TOKEN). The token is a secret: it is only ever
placed in the Authorization header, never printed or logged.
"""

import datetime
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://jira.xwiki.org/rest/api/2"


def token():
    tok = os.environ.get("JIRA_API_TOKEN") or os.environ.get("JIRA_TOKEN")
    if not tok:
        raise SystemExit(
            "No JIRA token in environment. Export JIRA_API_TOKEN (or JIRA_TOKEN) with your "
            "jira.xwiki.org personal access token.")
    return tok


def _headers(content_type=None):
    h = {"Authorization": f"Bearer {token()}", "Accept": "application/json"}
    if content_type:
        h["Content-Type"] = content_type
    return h


def _request(method, path, data=None, retries=3):
    url = path if path.startswith("http") else f"{BASE}{path}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    ct = "application/json" if data is not None else None
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, method=method, headers=_headers(ct))
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            # 4xx are deterministic (bad request / permission) — do not retry.
            if 400 <= e.code < 500:
                return e.code, _safe_json(detail)
            last = f"HTTP {e.code}: {detail[:200]}"
        except (urllib.error.URLError, TimeoutError) as e:
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (attempt + 1))
    raise SystemExit(f"Request failed after {retries} attempts: {method} {url}\n{last}")


def _safe_json(text):
    try:
        return json.loads(text)
    except Exception:
        return {"_raw": text}


def search(jql, fields, expand=None, page_size=50, max_total=None):
    """Yield issues matching jql, paging through the whole result set (or up to max_total)."""
    start = 0
    fetched = 0
    while True:
        params = {
            "jql": jql,
            "fields": ",".join(fields),
            "startAt": str(start),
            "maxResults": str(page_size),
        }
        if expand:
            params["expand"] = expand
        status, data = _request("GET", f"/search?{urllib.parse.urlencode(params)}")
        if status != 200:
            raise SystemExit(f"Search failed (HTTP {status}): {json.dumps(data)[:300]}")
        issues = data.get("issues", [])
        total = data.get("total", 0)
        for issue in issues:
            yield issue
            fetched += 1
            if max_total and fetched >= max_total:
                return
        start += len(issues)
        if start >= total or not issues:
            return


def count(jql):
    status, data = _request(
        "GET", "/search?" + urllib.parse.urlencode({"jql": jql, "maxResults": "0"}))
    if status != 200:
        raise SystemExit(f"Count failed (HTTP {status}): {json.dumps(data)[:300]}")
    return data.get("total", 0)


def get_issue(key, fields):
    status, data = _request("GET", f"/issue/{key}?fields={','.join(fields)}")
    if status != 200:
        raise SystemExit(f"Fetch {key} failed (HTTP {status}): {json.dumps(data)[:300]}")
    return data


def get_transitions(key):
    status, data = _request("GET", f"/issue/{key}/transitions")
    if status != 200:
        raise SystemExit(f"Transitions for {key} failed (HTTP {status}): {json.dumps(data)[:300]}")
    return data.get("transitions", [])


def add_comment(key, body):
    return _request("POST", f"/issue/{key}/comment", {"body": body})


def do_transition(key, transition_id, resolution=None):
    payload = {"transition": {"id": str(transition_id)}}
    if resolution:
        payload["fields"] = {"resolution": {"name": resolution}}
    return _request("POST", f"/issue/{key}/transitions", payload)


def add_link(bug_key, target_key, link_type_name):
    """Link bug_key → target_key. For link_type_name='Duplicate', bug_key is the
    OUTWARD issue ('duplicates') and target_key the INWARD issue ('is duplicated by')."""
    payload = {
        "type": {"name": link_type_name},
        "outwardIssue": {"key": bug_key},
        "inwardIssue": {"key": target_key},
    }
    return _request("POST", "/issueLink", payload)


def project_versions(project="XWIKI"):
    status, data = _request("GET", f"/project/{project}/versions")
    if status != 200:
        raise SystemExit(f"Versions failed (HTTP {status}): {json.dumps(data)[:300]}")
    return data


# --- date helpers ---------------------------------------------------------

def parse_jira_date(s):
    """Parse a JIRA timestamp like '2013-04-15T10:20:30.000+0000' to an aware datetime."""
    if not s:
        return None
    # Normalise +0000 → +00:00 for fromisoformat.
    s = s.strip()
    if len(s) >= 5 and (s[-5] in "+-") and s[-3] != ":":
        s = s[:-2] + ":" + s[-2:]
    try:
        return datetime.datetime.fromisoformat(s)
    except ValueError:
        return None


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def age_days(s):
    dt = parse_jira_date(s)
    if not dt:
        return None
    return (now_utc() - dt).days
