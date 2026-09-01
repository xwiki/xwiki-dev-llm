#!/usr/bin/env python3
"""docplan.py -- read and update a conversion's PLAN.md (used by `xwiki-doc-convert`).

A conversion runs one task per session, so every session begins by re-deriving "where am I": which
task is current, what the developer already decided, what the setup answers were. Done by hand that
is five to thirteen reads of PLAN.md plus the task file, each one a turn at full context.

`status` is that whole orientation in a single call, and `start` / `done` are the two writes back,
so a session's plan bookkeeping costs three tool calls instead of a dozen.

    python3 docplan.py status          # the whole orientation: current task + setup + decisions
    python3 docplan.py next            # just the next task's number and file (one line)
    python3 docplan.py start 07        # mark task 07 `doing`, in PLAN.md and in the task file
    python3 docplan.py done 07 "source/latex.txt + inventory, 41 items"

PLAN.md is the single source of truth for status; when a task file disagrees, `status` says so and
PLAN.md wins. Layouts are the ones in `xwiki-doc-convert/references/conversion-plan.md`.

Point it at a plan with `--plan <path>`; otherwise it looks for `conversion/PLAN.md` from the
current directory upwards, so it works from the working directory or from `conversion/` itself.
"""
import os
import re
import sys

DONE = 'done'
# Sections printed verbatim by `status`: they are the conversion's memory, and re-deciding what they
# already settled costs far more than printing them.
CARRIED = ['Setup', 'Decisions', 'Open questions']
# Decisions accrete over a long conversion; past this the digest would itself be the context problem.
CARRY_MAX = 6000


def find_plan(explicit=None):
    if explicit:
        return explicit
    here = os.path.abspath('.')
    while True:
        for cand in (os.path.join(here, 'conversion', 'PLAN.md'), os.path.join(here, 'PLAN.md')):
            if os.path.isfile(cand):
                return cand
        parent = os.path.dirname(here)
        if parent == here:
            raise SystemExit('no conversion/PLAN.md found from here upwards -- pass --plan <path>')
        here = parent


def split_sections(text):
    """`## Heading` -> body. The heading is kept whole; lookups match on its prefix."""
    out, name, buf = {}, None, []
    for line in text.splitlines():
        m = re.match(r'^##\s+(.*?)\s*$', line)
        if m:
            if name is not None:
                out[name] = '\n'.join(buf).strip()
            name, buf = m.group(1), []
        else:
            buf.append(line)
    if name is not None:
        out[name] = '\n'.join(buf).strip()
    return out


def section(sections, prefix):
    for name, body in sections.items():
        if name.lower().startswith(prefix.lower()):
            return name, body
    return None, None


def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def parse_tasks(body):
    """Rows of the `| # | Task | File | Status | Outcome |` table, in plan order."""
    tasks = []
    for line in (body or '').splitlines():
        if not line.strip().startswith('|'):
            continue
        c = cells(line)
        if len(c) < 4 or not re.match(r'^[0-9]+[a-z]?$', c[0]):    # header, separator, or prose
            continue
        tasks.append({
            'num': c[0], 'name': c[1], 'file': c[2],
            'status': c[3].lower(), 'outcome': c[4] if len(c) > 4 else '',
            'line': line,
        })
    return tasks


def current(tasks):
    """The task a session picks up: the first that is not done. `doing` means it was interrupted."""
    for t in tasks:
        if t['status'] != DONE:
            return t
    return None


def read_task_file(plan_path, rel):
    path = os.path.join(os.path.dirname(plan_path), rel)
    if not os.path.isfile(path):
        return path, None
    with open(path, encoding='utf-8') as f:
        return path, f.read()


def task_file_status(text):
    m = re.search(r'^Status:\s*(\S+)', text or '', re.M)
    return m.group(1).lower() if m else None


def tail_entries(body, budget):
    """Keep whole trailing entries within `budget`.

    Setup, Decisions and Open questions are append-ordered lists of `- ...` entries, so the useful
    end is the recent one: a decision from three weeks ago is usually already baked into the pages,
    while yesterday's is the one a session would otherwise re-litigate. Cutting from the front would
    drop exactly those, and cutting mid-entry would present half a decision as a whole one.
    """
    if len(body) <= budget:
        return body, 0
    entries = re.split(r'\n(?=- )', body)
    kept, size = [], 0
    for e in reversed(entries):
        if size + len(e) > budget and kept:
            break
        kept.insert(0, e)
        size += len(e) + 1
    return '\n'.join(kept), len(entries) - len(kept)


def carried(sections):
    out = []
    for prefix in CARRIED:
        name, body = section(sections, prefix)
        if not body:
            continue
        body, dropped = tail_entries(body, CARRY_MAX)
        if dropped:
            body = (f'[{dropped} earlier entr{"y" if dropped == 1 else "ies"} not shown -- '
                    f'read "{name}" in PLAN.md if this task needs the history]\n\n' + body)
        out.append(f'--- {name.upper()}\n{body}')
    return out


def cmd_status(plan_path, text, sections, tasks):
    head = text.split('\n##', 1)[0].strip()
    counts = {}
    for t in tasks:
        counts[t['status']] = counts.get(t['status'], 0) + 1
    tally = ', '.join(f'{n} {s}' for s, n in sorted(counts.items())) or 'no tasks yet'
    print(head)
    print(f'\nPlan: {plan_path}\nTasks: {len(tasks)} total -- {tally}')

    cur = current(tasks)
    if cur is None:
        print('\nEvery task is done. Nothing to pick up.')
        for block in carried(sections):
            print('\n' + block)
        return 0

    nxt = [t for t in tasks if t['status'] != DONE and t is not cur][:2]
    print(f'\n=== CURRENT TASK {cur["num"]} -- {cur["name"]}  [{cur["status"]}]  {cur["file"]}')
    if cur['status'] == 'doing':
        print('    (left `doing` by an earlier session -- look for a `Resumed at:` note below)')
    if cur['status'] == 'blocked':
        print('    (blocked -- see Open questions; do not start it without the developer)')

    path, body = read_task_file(plan_path, cur['file'])
    if body is None:
        print(f'    !! task file missing: {path}')
    else:
        fs = task_file_status(body)
        if fs and fs != cur['status']:
            print(f'    !! task file says Status: {fs}, PLAN.md says {cur["status"]} -- PLAN.md wins, fix the file')
        print('\n' + body.strip())

    for block in carried(sections):
        print('\n' + block)

    if nxt:
        print('\n--- AFTER THIS: ' + '; '.join(f'{t["num"]} {t["name"]}' for t in nxt))
    print('\nMark it started with:  python3 docplan.py start ' + cur['num'])
    return 0


def cmd_next(tasks):
    cur = current(tasks)
    if cur is None:
        print('all tasks done')
        return 0
    print(f'{cur["num"]}\t{cur["status"]}\t{cur["file"]}\t{cur["name"]}')
    return 0


def rewrite_row(task, status=None, outcome=None):
    c = cells(task['line'])
    if status is not None:
        c[3] = status
    if outcome is not None:
        while len(c) < 5:
            c.append('')
        c[4] = outcome.replace('|', '/')          # a pipe would split the cell
    return '| ' + ' | '.join(c) + ' |'


def write_plan(plan_path, text, task, **kw):
    new = rewrite_row(task, **kw)
    if task['line'] not in text:
        raise SystemExit(f'could not locate task {task["num"]}\'s row in {plan_path}')
    with open(plan_path, 'w', encoding='utf-8') as f:
        f.write(text.replace(task['line'], new, 1))
    return new


def write_task_file(plan_path, task, status, outcome=None):
    path, body = read_task_file(plan_path, task['file'])
    if body is None:
        print(f'note: task file {path} does not exist, only PLAN.md was updated')
        return
    if re.search(r'^Status:\s*\S+', body, re.M):
        body = re.sub(r'^Status:\s*\S+', f'Status: {status}', body, count=1, flags=re.M)
    else:
        body = f'Status: {status}\n' + body
    if outcome:
        # The template ends on an `## Outcome` heading; fill it rather than appending a second one.
        if re.search(r'^##[ \t]+Outcome[ \t]*$', body, re.M):
            # A lambda, not a replacement string: an outcome holding a backslash would otherwise be
            # read as a group reference.
            body = re.sub(r'^##[ \t]+Outcome[ \t]*$.*\Z', lambda _: f'## Outcome\n\n{outcome}\n',
                          body, count=1, flags=re.M | re.S)
        else:
            body = body.rstrip() + f'\n\n## Outcome\n\n{outcome}\n'
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)


def find_task(tasks, num):
    num = num.lstrip('0') or '0'
    for t in tasks:
        if (t['num'].lstrip('0') or '0') == num:
            return t
    raise SystemExit(f'no task {num} in the plan (have: {", ".join(t["num"] for t in tasks)})')


def main():
    argv = sys.argv[1:]
    plan_arg = None
    if '--plan' in argv:
        i = argv.index('--plan')
        plan_arg = argv[i + 1]
        del argv[i:i + 2]
    command = argv[0] if argv else 'status'

    plan_path = find_plan(plan_arg)
    with open(plan_path, encoding='utf-8') as f:
        text = f.read()
    sections = split_sections(text)
    _, tasks_body = section(sections, 'Tasks')
    tasks = parse_tasks(tasks_body)

    if command == 'status':
        return cmd_status(plan_path, text, sections, tasks)
    if command == 'next':
        return cmd_next(tasks)
    if command in ('start', 'done', 'block'):
        if len(argv) < 2:
            raise SystemExit(f'usage: docplan.py {command} <task-number> [outcome]')
        task = find_task(tasks, argv[1])
        status = {'start': 'doing', 'done': DONE, 'block': 'blocked'}[command]
        outcome = ' '.join(argv[2:]).strip() or None
        if command == DONE and not outcome:
            raise SystemExit('`done` needs an outcome -- it is what the next session reads')
        print(write_plan(plan_path, text, task, status=status, outcome=outcome))
        write_task_file(plan_path, task, status, outcome)
        nxt = current(parse_tasks(tasks_body.replace(task['line'], rewrite_row(task, status=status))))
        if command == DONE:
            print(f'next: {nxt["num"]} {nxt["name"]} ({nxt["file"]})' if nxt else 'next: nothing, the plan is complete')
        return 0
    raise SystemExit(f'unknown command {command!r} (status | next | start | done | block)')


if __name__ == '__main__':
    sys.exit(main())
