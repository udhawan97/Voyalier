# Windows restore durability plan

## Defect

The exact-sha Windows installed-app gate for v0.12.0 authenticates and inspects
the exported backup, then fails when confirmation tries to stage the restore.
The staged marker never appears. `atomic_write_file` flushes the temporary file,
renames it, and then calls `File::open(directory).sync_all()` for the parent.
On Windows, Rust implements `sync_all` with `FlushFileBuffers`, which requires a
writable file handle; the read-only directory handle obtained by `File::open`
cannot satisfy that contract. The resulting storage error prevents every
Windows restore from reaching its pending generation.

## Change

1. Keep the existing file `sync_all` before every atomic rename on all
   platforms.
2. Keep the parent-directory `sync_all` on Unix, where it is the supported way
   to make the renamed directory entry durable.
3. Treat the parent-directory flush as complete on Windows. The staged file is
   already flushed before the atomic rename, and the Win32 directory-handle
   contract does not expose `FlushFileBuffers` as a supported directory
   operation.
4. Amend ADR-0021 with this platform durability boundary and add a Windows-only
   regression that stages and unstages a restore through the real filesystem.
5. Run `make check`, the exact-sha Windows installed updater gate, Graphify
   update/query, and the protected tag workflow before publication.

## Release boundary

Do not create `v0.12.0` until the Windows installed-app gate passes through
restore staging, restart activation, reinstall recovery, data preservation and
the no-listener assertion on the exact candidate commit.
