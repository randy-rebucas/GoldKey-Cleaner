# GoldKey Cleaner

A Windows PC cleaning and optimization utility in the style of PC Cleaner, built with Electron.

## Features

| Module | What it does |
| --- | --- |
| **Dashboard** | One-click scan of everything below, health score, "Fix All" for recommended items |
| **Junk Cleaner** | User/Windows temp (older than 24h), thumbnail cache, error reports, crash dumps, Windows Update cache, DirectX shader cache, WinINet cache, Recycle Bin, Chrome/Edge/Brave/Firefox caches |
| **Privacy Cleaner** | Browser history and cookies, Firefox form data, recent documents, jump lists, Run/typed-path MRU, clipboard, DNS cache |
| **Registry Cleaner** | Per-user (HKCU) entries pointing to programs that no longer exist: MUI cache, compatibility history, Run entries, App Paths, orphaned uninstall entries. Each fix first exports a `.reg` backup, and you can restore it from the app |
| **Startup Manager** | Enable or disable Run-key and Startup-folder programs using the same flags as Task Manager, so every change can be undone |
| **Uninstaller** | Lists installed programs with search and sorting, and launches each program's own uninstaller |
| **Large Files** | Finds the biggest files in a folder, then shows them in Explorer or moves them to the Recycle Bin |
| **System Info** | OS, CPU, GPU, memory and drive usage |

## Safety design

- Cleaning only deletes files found by the most recent scan. Symlinks and junctions are never followed.
- Temp folders skip files modified in the last 24 hours, and the update cache skips the last 72 hours.
- Files in use are skipped and reported, never forced.
- Cookies, thumbnails, the shader cache, jump lists, the clipboard and DNS are **unchecked** by default.
- The renderer is sandboxed and can only pass IDs from the last scan. It cannot send arbitrary paths or commands to the main process.

## Run

```bash
npm install
npm start
```

Some locations (`C:\Windows\Temp`, the Windows Update cache, "All users" startup entries) need administrator rights. Use **Restart as admin** in the sidebar.

## Build an installer

```bash
npm run dist
```

The NSIS installer is written to `dist/`.
