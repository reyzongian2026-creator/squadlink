using System.ComponentModel;
using System.Diagnostics;

internal static class GameDetector
{
    // Only match game binaries. Launchers, anti-cheat services and window titles are ignored.
    private static readonly Dictionary<string, string> Games = new(StringComparer.OrdinalIgnoreCase)
    {
        ["VALORANT-Win64-Shipping"] = "VALORANT",
        ["cs2"] = "Counter-Strike 2",
        ["RocketLeague"] = "Rocket League",
        ["FortniteClient-Win64-Shipping"] = "Fortnite",
        ["League of Legends"] = "League of Legends",
        ["dota2"] = "Dota 2",
        ["Overwatch"] = "Overwatch 2"
    };

    public static string? FindRunningGame(string? previous)
    {
        string? selected = null;
        // A single process snapshot per interval; inspect basenames only.
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    if (!Games.TryGetValue(process.ProcessName, out var game)) continue;
                    // Keep the current title while it runs, even if a second game opens.
                    if (game == previous || selected == null ||
                        (selected != previous && string.CompareOrdinal(game, selected) < 0))
                        selected = game;
                }
                catch (InvalidOperationException) { /* Process already exited. */ }
                catch (Win32Exception) { /* Process metadata unavailable. */ }
            }
        }
        return selected;
    }
}
