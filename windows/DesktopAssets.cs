using Microsoft.Web.WebView2.Core;

internal sealed class DesktopAssets
{
    private readonly string root = Path.Combine(AppContext.BaseDirectory, "Client");
    private readonly Dictionary<string, string> files;
    private const string Headers = "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n";
    private const string Policy = "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'\r\n";

    public DesktopAssets()
    {
        files = Directory.GetFiles(root).ToDictionary(file => "/" + Path.GetFileName(file), file => file, StringComparer.Ordinal);
    }

    public void Respond(CoreWebView2 core, CoreWebView2WebResourceRequestedEventArgs e, Uri uri)
    {
        var path = uri.AbsolutePath;
        if (path.StartsWith("/api/", StringComparison.Ordinal)) return;
        if (path == "/") path = "/index.html";
        if (e.Request.Method != "GET" || !files.TryGetValue(path, out var file))
        {
            e.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not found", Headers);
            return;
        }
        string mime = Path.GetExtension(file) switch
        {
            ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8", ".png" => "image/png", ".webp" => "image/webp",
            _ => "application/octet-stream"
        };
        Stream body;
        if (path == "/index.html")
        {
            var html = File.ReadAllText(file)
                .Replace("<link rel=\"manifest\" href=\"/manifest.webmanifest\" />", "")
                .Replace("</head>", "<link rel=\"stylesheet\" href=\"/desktop.css\" /></head>")
                .Replace("src=\"/install.js\"", "src=\"/desktop.js\"");
            body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(html));
        }
        else body = File.OpenRead(file);
        e.Response = core.Environment.CreateWebResourceResponse(body, 200, "OK", Headers + (path == "/doom-player.html" ? "" : Policy) + "Content-Type: " + mime + "\r\n");
    }
}
