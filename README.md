# Retro Library

A Steam-style library for your emulators. Pick a console (PS2, PS1, GameCube, N64, SNES, Genesis, GBA, NES), browse your games, press **Play**, and jump back in from **Continue Playing**, which is built from the save states already on your PC.

The app doesn't include games. You bring those yourself.

## Start it

Double-click **Retro Library.exe**, which sits next to this `retro-library` folder. Keep the two together.

From a fresh clone: install Node.js, run `npm install` here, then build the launcher (see below). If Electron didn't download (`node_modules\electron\dist` is empty), run `node node_modules/electron/install.js`.

(For development: `npm start` in this folder. `npm run demo` opens it with fake test games.)

## Emulators (none need a BIOS)

| Console | Emulator (default) | Optional, needs a BIOS |
|---|---|---|
| PS2 | RetroArch + Play! core | PCSX2 (better compatibility) |
| PS1 | RetroArch + PCSX ReARMed core | DuckStation |
| GameCube | Dolphin | |
| N64, SNES, Genesis, GBA, NES | RetroArch + Mupen64Plus-Next, Snes9x, Genesis Plus GX, mGBA, Mesen | |

- RetroArch is installed at `C:\RetroArch-Win64`, with the cores in its `cores` folder.
- Dolphin is in `%USERPROFILE%\Emulators\Dolphin-x64`.
- To use PCSX2 or DuckStation later: install it, add your console's BIOS file, choose its program in Settings, then pick it under that console.

## Add your games

Settings › Consoles › **Add folder** for each console. Save states are found automatically.

## How saves are matched

| Emulator | Save file | Matched to the game by |
|---|---|---|
| RetroArch | `Game Name.state1` (in `states\<core>`) | the game's file name |
| Dolphin | `GALE01.s01` | the game ID in the disc header |
| PCSX2 | `SLUS-20946 (CRC).01.p2s` | the disc serial, read from inside the .iso/.bin |
| DuckStation | `SLUS-00594_1.sav` | the disc serial |

A save whose game file isn't found still shows up in Continue Playing, marked "Game file not found".

## Steam and the Steam Controller

1. Close Steam, then run `node scripts/add-to-steam.js`. It adds **Retro Library** as a non-Steam game with `--fullscreen`, after backing up Steam's `shortcuts.vdf`. Or do it by hand: **Games › Add a Non-Steam Game to My Library › Browse**, pick **Retro Library.exe**, and set **Launch Options** to `--fullscreen`.
2. Start it from Steam. Steam Input presents the controller as an Xbox pad, both to the library and to the emulators it launches.

**Library controls:** D-pad/stick moves · A opens or plays · B goes back · X resumes the latest save · Y searches · LB/RB switch consoles · Start opens Settings · F11 toggles full screen.

## Rebuilding the launcher

`powershell -ExecutionPolicy Bypass -File launcher\build.ps1` rebuilds `Retro Library.exe` with the C# compiler built into Windows. `node launcher/make-icon.js` redraws the icon.

## Tests

`npm run selftest` builds fake discs, ROMs and save states in `test-fixtures/` and checks game IDs, save matching, ordering and launch commands.
