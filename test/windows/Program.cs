using System.Diagnostics;

var folder = Directory.CreateTempSubdirectory("squadlink-detector");
try
{
    // Use a harmless interactive helper with the basename the desktop client recognizes.
    // Holding stdin open keeps the helper alive for one scan.
    var fixture = Path.Combine(folder.FullName, "VALORANT-Win64-Shipping.exe");
    File.Copy(Path.Combine(Environment.SystemDirectory, "cmd.exe"), fixture);
    using var child = Process.Start(new ProcessStartInfo(fixture, "/D /Q")
    {
        UseShellExecute = false,
        RedirectStandardInput = true,
        CreateNoWindow = true
    }) ?? throw new Exception("Could not start the detector fixture.");
    try
    {
        if (GameDetector.FindRunningGame(null) != "VALORANT")
            throw new Exception("Running VALORANT basename was not detected.");
    }
    finally
    {
        child.StandardInput.Close();
        if (!child.WaitForExit(5000)) { child.Kill(); child.WaitForExit(); }
    }
    if (GameDetector.FindRunningGame(null) == "VALORANT")
        throw new Exception("VALORANT presence remained after the fixture exited.");
    Console.WriteLine("Windows detector recognized the fixture and cleared it after exit.");
}
finally { folder.Delete(true); }
