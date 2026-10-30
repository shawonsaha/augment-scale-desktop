using System;
using Velopack;

namespace AugmentScale;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        // Initializes Velopack hooks (install/update/uninstall) before any UI spins up.
        VelopackApp.Build().Run();

        var app = new App();
        app.InitializeComponent();
        app.Run();
    }
}
