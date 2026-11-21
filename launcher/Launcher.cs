// "Retro Library.exe": starts the app with the Electron bundled in retro-library\node_modules.
// It waits until the app closes, so Steam (and Steam Input) treats the whole session as one game.
// Build with launcher\build.ps1.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class RetroLibraryLauncher
{
    [STAThread]
    static int Main(string[] args)
    {
        string here = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        // Works when the .exe sits next to the retro-library folder, or inside it.
        string[] candidates = { Path.Combine(here, "retro-library"), here, Path.GetDirectoryName(here) };

        foreach (string app in candidates)
        {
            if (string.IsNullOrEmpty(app)) continue;
            string electron = Path.Combine(app, @"node_modules\electron\dist\electron.exe");
            if (!File.Exists(electron) || !File.Exists(Path.Combine(app, "main.js"))) continue;

            var psi = new ProcessStartInfo(electron)
            {
                Arguments = Quote(app) + " " + string.Join(" ", args.Select(Quote)),
                UseShellExecute = false,
                WorkingDirectory = app,
            };
            psi.EnvironmentVariables["RETRO_LIBRARY_LAUNCHER"] = Application.ExecutablePath;
            try
            {
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit();
                    return p.ExitCode;
                }
            }
            catch (Exception e)
            {
                MessageBox.Show("Retro Library could not start:\n" + e.Message, "Retro Library", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        MessageBox.Show(
            "Couldn't find the app files.\n\nKeep \"Retro Library.exe\" next to the \"retro-library\" folder, and make sure retro-library\\node_modules exists (run \"npm install\" in that folder).",
            "Retro Library", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }

    static string Quote(string s)
    {
        if (s.EndsWith("\\")) s += "\\";
        return "\"" + s.Replace("\"", "\\\"") + "\"";
    }
}
