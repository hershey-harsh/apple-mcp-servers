# P3 — Shared runtime kernel

Design record. Derived from a full read-only audit of all 7 servers; raw data in
[`p3-audit-matrix.json`](./p3-audit-matrix.json).

---

## 1. What the audit changed about the plan

**The premise was wrong in one important way.** P3 was scoped as an
"applescript-kernel". Only **4 of 7** servers use AppleScript:

| Server | Backend |
|---|---|
| apple-mail, apple-music | osascript |
| apple-notes | osascript + sqlite3 CLI |
| apple-messages | sqlite (read-only) + osascript |
| apple-events, apple-maps | compiled Swift CLI binary |
| apple-weather | HTTP (axios) + MQTT |

So AppleScript is a *sublayer*, not the kernel. The genuinely shared surfaces are:

| Layer | Applies to | Why |
|---|---|---|
| **L1 process exec** — timeout, output cap, child reaping, retry | 6/7 (all but weather) | 5 independent reimplementations, each missing different fixes |
| **L2 error taxonomy** | **7/7** | the outage |
| **L3 doctor contract** | **7/7** | 5 servers have no diagnostics at all |
| **L4 response budget** | **7/7** | 39 verified-unbounded tools |
| L1a AppleScript specifics — `with timeout` injection, escaping | 4/7 | sublayer of L1 |

L2–L4 are the payload. L1 is real but is where the regression risk lives.

## 2. The outage, correctly diagnosed

Three separate defects, in the order they fired:

1. **`projectUtils.ts:64` — `fs.existsSync` swallows every errno and returns `false`.**
   Under TCC denial it returned false for every ancestor, `findProjectRoot` exhausted
   its 10 levels and threw `Project root not found within 10 directory levels`.
   `index.ts:14` calls this at **module top level** ⇒ startup crash. apple-events never
   emitted an EPERM string, so no regex could have matched. This is the whole reason
   apple-events showed "Server disconnected" while others limped.

2. **`errorHandling.ts:71` replaces every unmatched error with `System error occurred`**
   unless `NODE_ENV=development` or `DEBUG` is set. EPERM, EACCES, ENOBUFS, ETIMEDOUT
   all collapse into that one string in normal use.

3. **apple-notes *does* detect it and gives the wrong remedy.** `applescript.ts:194`
   matches `/not authorized|not permitted|access.*denied/i` → *"Grant automation access
   in System Settings > Privacy & Security"*. A TCC folder-service denial is not an
   Automation problem; that sentence sends the user to a pane that cannot fix it.

**Detection was never the bottleneck. Remediation was.** 2 of 7 detect the condition,
0 of 7 produce a correct remedy.

## 3. Package layout

**Constraint that kills clever designs:** Claude Desktop spawns each server as an
independent process from an absolute path via its own `start.sh`. There is no root
`package.json`, no workspace, no bundler, no CI. Shared code must resolve at **runtime
on the user's machine**.

Adopted:

```
shared/
  ts/   — consumed via  "file:../../shared/ts"  in each TS server's package.json
  py/   — consumed via  a path dependency / sys.path entry in each start.sh
```

In-repo and relative. Every server already launches from inside the repo, so a relative
path resolves without publishing, linking, or network access. Rejected: npm/PyPI
publishing (breaks offline + version skew), git submodule (clone complexity),
vendoring (defeats the purpose).

Precedent worth noting: apple-maps already writes its build artifact **outside** the
repo (`~/.apple-mcps/build`, `config.py:31`). Had that binary been emitted next to the
source, the repo under `~/Documents` would have been denied the *write* too. Keep that
convention for artifacts; source stays in-repo.

## 4. L2 — error taxonomy

Detection rules must be **numeric-first, string-second**. Only apple-music classifies by
OSStatus today. apple-notes structurally *cannot*: `applescript.ts:274` pre-strips the
trailing code with `/execution error: (.+?)(?:\s*\(-?\d+\))?$/m` before classification,
so no numeric code ever reaches its matcher.

| Class | Detection | Remedy |
|---|---|---|
| `TCC_FOLDER_DENIED` | errno `EPERM` on a path under `~/Documents`, `~/Desktop`, `~/Downloads` | Relocate the repo outside those folders. **Explicitly: Full Disk Access does not fix this** — the folder services are separate TCC services and FDA on the parent does not cover a spawned child. |
| `TCC_AUTOMATION_DENIED` | OSStatus `-1743`, or full phrases `not authorized`/`not authorised`/`assistive access` | System Settings → Privacy & Security → Automation → enable the host app for *<target app>*. |
| `TCC_DENIED` | EventKit/Contacts `.denied` | Named pane + exact toggle. |
| `TCC_WRITE_ONLY` | EventKit `.writeOnly` | Change the toggle from **Add Only** to **Full Access**. Distinct class — a naive `status != .denied` check passes while every read returns empty. |
| `FS_PERMISSION` | errno `EACCES` | Ordinary file mode; `chmod`/ownership. |
| `APP_NOT_RUNNING` | `-609`, `-10810`, `connection is invalid` | Launch the app. |
| `TIMEOUT` | `ETIMEDOUT`, or `code==='ETIMEDOUT'` **and** `signal===killSignal` on the sync API | Retry / raise timeout env var. |
| `OUTPUT_TOO_LARGE` | `ENOBUFS` | Narrow the query. Failure presents as an **empty** result, not a truncated one. |
| `NOT_FOUND` | `-1728`, `can't get …` | **Stays non-environmental** — see below. |

Three constraints the audit proved, which a naive taxonomy would violate:

- **Never match bare `not allowed`.** Music.app emits *"operation not allowed on smart
  playlists"* — a logic error. `applescript.py:342` already paid for this.
- **`-1728` must classify as UNKNOWN/NOT_FOUND, not as environmental.** apple-music
  deliberately leaves it unclassified so AppleScript→REST fallbacks still cascade
  (`applescript.py:376`). Promoting it breaks every fallback path in that server.
- **The taxonomy must run *before* the production sanitizer**, and the sanitizer must
  never overwrite a classified error.

## 5. L1 — process exec

The kernel is the **union** of fixes, not the intersection. Current coverage:

| | timeout | retry | output cap | kills child | queue headroom |
|---|---|---|---|---|---|
| apple-notes | ✅ | ✅ | ✅ 64 MB | ✅ SIGKILL | ✅ |
| apple-mail | ✅ | ❌ | ❌ | ✅ | ✅ |
| apple-maps | ✅ | ❌ | ❌ | ✅ | ✅ |
| apple-music | ✅ | ❌ | ❌ | ✅ | ❌ |
| apple-messages | ✅ | ~ | ❌ | ✅ | ❌ |
| apple-events | ❌ | ❌ | ✅ 10 MB | ❌ | ❌ |
| apple-weather | ✅ | ✅ (dead) | ❌ | n/a | n/a |

Non-negotiable behaviours to carry over:

- **Inner timeout 5 s shorter than outer.** Independently derived three times
  (apple-notes AppleScript, apple-mail AppleScript, apple-maps *MapKit* — same 5 s gap).
  The app must abort from inside its own dispatch and release the event queue before the
  parent SIGKILLs; killing the child alone does not stop work already dispatched.
- **SIGKILL, not SIGTERM** — a wedged `osascript` ignores SIGTERM and leaks.
- **Timeout is a total deadline, not per-attempt** — fresh-timeout-per-attempt ran ~61 s
  past the 60 s MCP client limit.
- **`MIN_ATTEMPT_BUDGET_MS` guard** — otherwise `{timeoutMs:1100, retryDelayMs:1000}`
  gives attempt 2 a 90 ms process timeout inside `with timeout of 1 seconds`, defeating
  the headroom. Reachable on defaults.
- **Sync error shape ≠ async.** `execFileSync` timeout throws `code:'ETIMEDOUT'` with
  `signal` set and **no `killed:true`**. Checking only `killed === true` silently stops
  recognizing timeouts.
- **Read stdout on non-zero exit.** EventKitCLI prints its error JSON to *stdout* then
  `exit(1)`; a wrapper that reads stdout only on success turns every EventKit error into
  `Command failed with exit code 1`.
- **Chain signal handlers, don't clobber** — FastMCP installs its own SIGTERM handler;
  and installation only works from the main thread.
- **Orphan watcher** (`__main__.py:11`, python-sdk#526) — captures initial PPID and
  self-terminates on reparent. Without it, an orphaned server keeps polling Mail.app and
  Mail resurrects itself after the user quits it. Belongs in the kernel lifecycle layer.

AppleScript timeout injection has **two carve-outs** that must survive: skip scripts with
a line-leading `use ` (ASObjC), and skip scripts defining handlers.

## 6. L4 — response budget

**39 verified-unbounded tools** (read from the query/loop, not the schema):
apple-notes 10, apple-music 7, apple-events 6, apple-mail 6, apple-weather 5,
apple-maps 3, apple-messages 2. Only `apple-notes/src/utils/searchLimit.ts` is reusable;
everything else is hand-rolled or absent.

Worst offenders:

- `calendar_events action=read` **with an id** — `findEventById` calls `readEvents()`
  with no arguments ⇒ `distantPast … distantFuture` across every calendar. The entire
  calendar history is serialized to JSON and shipped over a 10 MB pipe **to find one
  event by id**.
- `reminders_tasks action=read` — `predicateForReminders(in: nil)`: every reminder in
  every list, always, no limit parameter anywhere in schema or handler.
- Any apple-music tool with `format='json'|'csv'` — dumps the complete item list.
- apple-weather sets no `maxContentLength`/`maxBodyLength` on any axios client, and has
  a documented ~13 MB / 12,700-gauge fallback path.

API must cover the four shapes already hand-rolled: list cap · export scoping · result
cap · **scan-cap vs result-cap disclosure** (they are different numbers and conflating
them misleads).

## 7. Sequencing

**Do this first, independent of the kernel** — the 3 defects in §2 are a ~20-line fix
and would have made the outage self-diagnosing. Do not wait for L1.

Then, by migration risk from the audit:

1. **apple-maps** (low) — proves the pattern on the smallest surface.
2. **apple-events** (medium) — most broken: no timeout, no retry, no doctor, 6 unbounded tools.
3. **apple-weather, apple-messages** (medium).
4. **apple-notes, apple-mail, apple-music** (high) — last. These carry the most encoded
   knowledge, and apple-notes/apple-mail are where L1's hardest invariants came from.

Adopt additively: kernel lands beside existing code, servers migrate one at a time, each
step independently revertible. No flag day.

## 8. Open questions

1. **L1 at all?** L2–L4 deliver most of the value at a fraction of the risk. L1 touches
   three high-risk servers whose executors encode invariants that took issues #16/#17/#58
   to find. Reasonable to ship L2–L4, then decide.
2. **CI on macOS runners** — costly, and the suites that would have caught the outage
   need real TCC grants, which no hosted runner has. Possibly: mocked suites in CI, a
   local `make doctor` for the grant-dependent ones.
3. **apple-weather's dead retry predicate** — `noaa.ts:184` matches `'rate limit'`/
   `'server error'`/`'timed out'`, but the axios interceptor has already replaced those
   with `ApiError` subclasses whose messages read `'Rate limit…'` (capitalized). Retry is
   dead in production and its unit test recomputes the backoff formula instead of driving
   an error through, so it cannot catch this. Fix now, or fold into L1?
