// Starts the right emulator for a game, optionally loading a save state.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EMULATORS, getSystem } = require('./systems');

/**
 * Works out the command for a launch without running it (also used by the self-test).
 * @returns {{ exe, args, cwd } | { error }}
 */
function buildCommand(settings, game, state) {
  const sys = getSystem(game.systemId, settings);
  if (!sys) return { error: 'Unknown console.' };
  const emu = EMULATORS[sys.emulator];
  const exe = (settings.emulators[sys.emulator] || {}).path;
  if (!exe) return { error: `Set the ${emu.name} path in Settings to play ${sys.short} games.` };
  if (!fs.existsSync(exe)) return { error: `${emu.name} was not found at ${exe}. Check the path in Settings.` };
  if (!game.file) return { error: 'The game file for this save was not found. Add the folder that has it in Settings.' };
  if (!fs.existsSync(game.file)) return { error: `The game file is missing: ${game.file}. Try Rescan.` };

  let core;
  if (sys.emulator === 'retroarch') {
    core = sys.core;
    const corePath = path.join(path.dirname(exe), 'cores', core);
    if (!fs.existsSync(corePath)) {
      return {
        error: `RetroArch is missing the ${sys.coreName} core. In RetroArch open Main Menu > Load Core > Download a Core and install "${sys.coreName}".`,
      };
    }
  }

  const args = emu.args({
    game: game.file,
    statePath: state ? state.file : null,
    slot: state ? state.slot : null,
    exe,
    core,
  });

  // RetroArch's automatic state is loaded through a temporary config override.
  if (sys.emulator === 'retroarch' && state && state.slot === 'auto') {
    const cfg = path.join(os.tmpdir(), 'retro-library-autoload.cfg');
    fs.writeFileSync(cfg, 'savestate_auto_load = "true"\n');
    args.push('--appendconfig', cfg);
  }

  return { exe, args, cwd: path.dirname(exe) };
}

function launch(settings, game, state, onExit) {
  const cmd = buildCommand(settings, game, state);
  if (cmd.error) return { ok: false, error: cmd.error };
  try {
    const child = spawn(cmd.exe, cmd.args, { cwd: cmd.cwd, stdio: 'ignore', windowsHide: false });
    let failed = false;
    child.on('error', (err) => {
      failed = true;
      onExit && onExit({ error: `Could not start the emulator: ${err.message}` });
    });
    child.on('exit', (code) => {
      if (!failed) onExit && onExit({ code });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not start the emulator: ${err.message}` };
  }
}

module.exports = { launch, buildCommand };
