using System.Net.Http;
using System.Text.Json;
using System.Reflection;

internal readonly record struct BuildStamp(long Number, int Attempt) : IComparable<BuildStamp>
{
    public int CompareTo(BuildStamp other) => Number != other.Number ? Number.CompareTo(other.Number) : Attempt.CompareTo(other.Attempt);
    public override string ToString() => $"{Number}.{Attempt}";

    public static BuildStamp Installed {
        get {
            var value = typeof(BuildStamp).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(a => a.Key == "SquadlinkBuild")?.Value;
            var parts = value?.Split('.');
            return parts?.Length == 2 && long.TryParse(parts[0], out var n) && int.TryParse(parts[1], out var a)
                ? new(n,a) : default;
        }
    }
}

internal sealed record PreviewArtifact(BuildStamp Build, long Run, long Id, DateTimeOffset ExpiresAt)
{
    public bool IsAvailableAt(DateTimeOffset instant) => instant < ExpiresAt;
    public Uri Url => new($"https://github.com/{PreviewUpdates.Repository}/actions/runs/{Run}/artifacts/{Id}");
}

internal sealed class PreviewUpdates(HttpClient http)
{
    public const string Repository = "reyzongian2026-creator/squadlink";
    public const string Branch = "preview/windows-escritorio";
    private async Task<JsonDocument> Get(string path, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,$"https://api.github.com/repos/{Repository}/actions/{path}");
        request.Headers.UserAgent.ParseAdd("Squadlink-Preview/1.0");
        request.Headers.Accept.ParseAdd("application/vnd.github+json");
        using var response = await http.SendAsync(request,ct);
        response.EnsureSuccessStatusCode();
        using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream,cancellationToken:ct);
    }
    public async Task<(PreviewArtifact? Artifact, bool Unavailable)> Check(BuildStamp installed, CancellationToken ct)
    {
        bool unavailable = false;
        for (int page=1;;page++) {
            using var data = await Get($"workflows/windows.yml/runs?branch={Uri.EscapeDataString(Branch)}&status=success&per_page=30&page={page}",ct);
            var runs = data.RootElement.GetProperty("workflow_runs");
            foreach (var run in runs.EnumerateArray()) {
                if (run.GetProperty("head_branch").GetString()!=Branch || run.GetProperty("conclusion").GetString()!="success"
                    || run.GetProperty("event").GetString() is not ("push" or "workflow_dispatch")
                    || !run.TryGetProperty("head_repository", out var source) || source.ValueKind != JsonValueKind.Object
                    || !source.TryGetProperty("full_name", out var owner) || owner.ValueKind != JsonValueKind.String
                    || !string.Equals(owner.GetString(),Repository,StringComparison.OrdinalIgnoreCase)) continue;
                var stamp = new BuildStamp(run.GetProperty("run_number").GetInt64(),run.GetProperty("run_attempt").GetInt32());
                if (stamp.CompareTo(installed)<=0) return (null,unavailable);
                unavailable = true;
                long runId = run.GetProperty("id").GetInt64();
                using var assets = await Get($"runs/{runId}/artifacts?name=Squadlink-Windows-x64&per_page=100",ct);
                PreviewArtifact? newest = null;
                var now = DateTimeOffset.UtcNow;
                foreach (var asset in assets.RootElement.GetProperty("artifacts").EnumerateArray()) {
                    if (asset.GetProperty("name").GetString() != "Squadlink-Windows-x64"
                        || asset.GetProperty("expired").GetBoolean() || asset.GetProperty("size_in_bytes").GetInt64() <= 0) continue;
                    var candidate = new PreviewArtifact(stamp, runId, asset.GetProperty("id").GetInt64(),
                        asset.GetProperty("expires_at").GetDateTimeOffset());
                    if (candidate.Id > (newest?.Id ?? 0) && candidate.IsAvailableAt(now)) newest = candidate;
                }
                if (newest != null) return (newest,false);
            }
            if (runs.GetArrayLength()<30) return (null,unavailable);
        }
    }
}
