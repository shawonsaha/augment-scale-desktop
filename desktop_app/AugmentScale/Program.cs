using System;
using System.IO;
using Velopack;

namespace AugmentScale;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().Run();

        var app = new App();
        app.InitializeComponent();
        app.Run();
    }

    private static void CreateSimulatorShortcut()
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcutPath = Path.Combine(desktop, "Augment Scale (Simulator Mode).lnk");
            var baseDir = AppContext.BaseDirectory;
            var targetCmd = Path.Combine(baseDir, "Run-With-Simulator.cmd");
            if (File.Exists(targetCmd))
            {
                var shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null)
                {
                    dynamic shell = Activator.CreateInstance(shellType)!;
                    var shortcut = shell.CreateShortcut(shortcutPath);
                    shortcut.TargetPath = targetCmd;
                    shortcut.WorkingDirectory = baseDir;
                    shortcut.Description = "Launch Augment Scale with Scale Simulator";
                    var iconPath = Path.Combine(baseDir, "Resources", "app.ico");
                    if (File.Exists(iconPath)) shortcut.IconLocation = iconPath;
                    shortcut.Save();
                }
            }
        }
        catch
        {
            // Best effort on non-standard shells
        }
    }
}
