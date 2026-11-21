# Retro Library

A Steam-style library for your emulators on Windows. Pick a console (PS2, PS1, GameCube, N64, SNES, Genesis, GBA, NES), browse your games, press **Play**, and jump back in from **Continue Playing**, which is built from the save states already on your PC. It works with a mouse, a keyboard or a controller, including the Steam Controller.

The app doesn't include emulators' BIOS files or any games. You bring your own games (your own dumps, or free homebrew).

## Install

These steps are for Windows 10 or 11. Commands go in PowerShell.

### 1. Install Node.js and Git

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Close and reopen PowerShell afterwards so it can find `node`, `npm` and `git`.

### 2. Download Retro Library

Pick where it should live (for example your Desktop), make a folder for it, and clone into that folder:

```powershell
mkdir "$HOME\Desktop\Retro Library"
cd "$HOME\Desktop\Retro Library"
git clone https://github.com/Vincenzobean/retro-library.git
cd retro-library
```

### 3. Install the app's dependencies

```powershell
npm install
```

Check that Electron downloaded: `node_modules\electron\dist\electron.exe` should exist. If it doesn't, run:

```powershell
node node_modules/electron/install.js
```

### 4. Build Retro Library.exe

```powershell
powershell -ExecutionPolicy Bypass -File launcher\build.ps1
```

This creates **Retro Library.exe** one folder up, next to the `retro-library` folder. Keep the exe and the folder together, then double-click the exe to start the app. You can also make a shortcut to it.

### 5. Install the emulators

None of these need a BIOS.

| Console | Emulator | Core to install in RetroArch |
|---|---|---|
| NES | RetroArch | Mesen |
| SNES | RetroArch | Snes9x |
| Genesis | RetroArch | Genesis Plus GX |
| GBA | RetroArch | mGBA |
| N64 | RetroArch | Mupen64Plus-Next |
| PS1 | RetroArch | PCSX ReARMed |
| PS2 | RetroArch | Play! |
| GameCube | Dolphin | (not a core) |

**RetroArch:**

```powershell
winget install --id Libretro.RetroArch -e
```

Open RetroArch, go to **Main Menu › Online Updater › Core Downloader**, and install each core in the table above.

**Dolphin:** download the latest release from [dolphin-emu.org/download](https://dolphin-emu.org/download/) and extract it anywhere, for example `%USERPROFILE%\Emulators\Dolphin-x64`. (winget's Dolphin package is the outdated 5.0 version.)

**Optional, needs a BIOS:** PCSX2 (PS2) and DuckStation (PS1) run more games than Play! and PCSX ReARMed, but they need a BIOS file copied from your own console.

### 6. Point the app at your emulators and games

1. Start **Retro Library.exe** and open **Settings**.
2. Under **Emulators**, click **Choose program** for RetroArch (`C:\RetroArch-Win64\retroarch.exe`) and Dolphin (`Dolphin.exe`).
3. Under **Consoles**, click **Add folder** for each console and choose where you keep its games. One folder per console works best, for example `Games\SNES`, `Games\GBA`.
4. If you installed PCSX2 or DuckStation, choose it under that console's **Emulator** setting.

Save-state folders are found automatically. Your games appear right away; press **Rescan** after adding new files.

## Supported files

| Console | File types | Notes |
|---|---|---|
| NES | `.nes` | |
| SNES | `.sfc`, `.smc` | |
| Genesis | `.md`, `.gen`, `.bin`, `.smd` | |
| GBA | `.gba` | |
| N64 | `.z64`, `.n64`, `.v64` | |
| PS1 | `.cue` + `.bin`, `.chd`, `.pbp`, `.m3u`, `.iso` | Keep a `.cue` and its `.bin` files in the same folder; the game shows once. Use `.m3u` for multi-disc games. |
| PS2 | `.iso`, `.chd`, `.cso`, `.isz` | `.bin` and `.gz` are listed too, but only PCSX2 can run them. Play! can't. |
| GameCube | `.iso`, `.rvz`, `.gcm`, `.ciso`, `.gcz` | |

- **Zipped games (`.zip`, `.7z`) aren't listed.** Unzip them into the console's folder first.
- Any other files in a game folder, such as readmes, manuals and images, are ignored.
- Sub-folders are scanned up to 4 levels deep.

## Add it to Steam

Adding Retro Library to Steam lets you start it from your Steam library or Big Picture, and makes the Steam Controller work in the library and in every game it launches.

### Automatically

1. Close Steam completely (Steam › Exit). Steam overwrites its game list when it closes, so this has to be done while it isn't running.
2. In the `retro-library` folder, run:

   ```powershell
   node scripts/add-to-steam.js
   ```

   This adds **Retro Library** for every Steam account on the PC, using `Retro Library.exe`, the app icon and the `--fullscreen` launch option. It backs up Steam's `shortcuts.vdf` first and updates the entry instead of adding a duplicate if you run it again. If Steam isn't in `C:\Program Files (x86)\Steam`, add `--steam "D:\path\to\Steam"`.
3. Start Steam. **Retro Library** is in your library.

### By hand

1. In Steam, click **Games › Add a Non-Steam Game to My Library**.
2. Click **Browse**, choose **Retro Library.exe**, and click **Add Selected Programs**.
3. Right-click **Retro Library** in your library, open **Properties**, and type `--fullscreen` in **Launch Options**.

### Controller setup

- Start Retro Library **from Steam**. Steam Input then presents the Steam Controller as an Xbox controller to the library and to the emulators it opens.
- Set each emulator's controls once. RetroArch detects Xbox controllers automatically. In Dolphin, open **Controllers › Port 1 › Standard Controller › Configure** and choose the XInput device.
- **Library controls:** D-pad/stick moves · A opens or plays · B goes back · X resumes the latest save · Y searches · LB/RB switch consoles · Start opens Settings · Select opens Exit · F11 toggles full screen.
- **In a RetroArch game:** Select+Start opens RetroArch's menu, where **Quit RetroArch** returns you to the library. The library refreshes your saves when the game closes.

## How saves are matched

| Emulator | Save file | Matched to the game by |
|---|---|---|
| RetroArch | `Game Name.state1` (in `states\<core>`) | the game's file name |
| Dolphin | `GALE01.s01` | the game ID in the disc header |
| PCSX2 | `SLUS-20946 (CRC).01.p2s` | the disc serial, read from inside the .iso/.bin |
| DuckStation | `SLUS-00594_1.sav` | the disc serial |

A save whose game file isn't found still shows up in Continue Playing, marked "Game file not found".

## For developers

- `npm start` runs the app from this folder. `npm run demo` runs it with fake test games.
- `npm run selftest` builds fake discs, ROMs and save states in `test-fixtures/` and checks game IDs, save matching, ordering and launch commands.
- `powershell -ExecutionPolicy Bypass -File launcher\build.ps1` rebuilds `Retro Library.exe` with the C# compiler built into Windows. `node launcher/make-icon.js` redraws the icon.
- Consoles, emulators and file types are defined in `src/main/systems.js`.
