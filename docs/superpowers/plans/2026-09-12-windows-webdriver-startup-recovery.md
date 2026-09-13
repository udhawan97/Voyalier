# Windows WebDriver startup recovery plan

## Problem

The v0.12.0 Windows installed-app dry run reached the first packaged-app
WebDriver session after both installers built, then Microsoft Edge returned a
transient `session not created` crash. The failed `startDriver` call had already
spawned `tauri-driver`, but the handle had not yet been returned to the caller,
so the outer cleanup could not stop it. The orphaned child kept the workflow
step alive after the failure.

## Scope

1. Keep ownership of a partially started driver session inside `startDriver`
   until it can either return a complete session or dispose every resource.
2. Retry a failed session creation once after stopping the driver, installed
   app processes, open log stream and stale WebView port files.
3. Record attempt and retry information in the sanitized driver diagnostics.
4. Add a job timeout as a final bound if a future child process defeats local
   cleanup.
5. Unit-test the retry classification and diagnostics contract, run the full
   repository gate, merge through protected `main`, and rerun the installed
   Windows proof on the exact resulting commit before tagging v0.12.0.

## Boundaries

- This changes release acceptance infrastructure only. Product storage,
  updater behavior and user data are unchanged.
- A retry never converts a failed product assertion into success. It applies
  only while creating the disposable WebDriver session, before the next
  product interaction begins.
- Two attempts are the maximum. Both failures remain visible in sanitized
  diagnostics and fail the job normally.
