using System.Text.Json;
using System.ComponentModel;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new LobbyWindow());
    }
}

internal sealed class LobbyWindow : Form
{
    private readonly string dataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Squadlink Preview");
    private readonly TextBox server = new() { Width = 240, PlaceholderText = "https://lobby.tudominio.com" };
    private readonly Button connect = new() { Text = "Conectar", AutoSize = true };
    private WebView2 view = new() { Dock = DockStyle.Fill };
    private const string SharedLobby = "https://squadlink-lobby.onrender.com";
    private readonly DesktopNavigation navigation = new();
    private readonly FlowLayoutPanel serverSettings = new() { Dock = DockStyle.Top, AutoSize = true, Visible = false,
        BackColor = Color.FromArgb(34, 32, 46), ForeColor = Color.WhiteSmoke, Padding = new Padding(8) };
    private readonly Panel workspace = new() {Dock = DockStyle.Fill, BackColor = DesktopNavigation.Canvas};
    private readonly Label loading = DesktopNavigation.Caption("Abriendo sección…", 14, FontStyle.Regular);
    private readonly RoomDirectory directory;
    private string page = "rooms";
    private string? pendingAction, pendingCode;
    private bool opening, ready, hasProfile;
    private int visit;
    private Uri? origin;
    private readonly System.Windows.Forms.Timer gameTimer = new() { Interval = 30_000 };
    private bool gameEnabled;
    private bool scanRunning;
    private bool gamePromptShown;
    private bool prompting;
    private int documentVersion;
    private string? currentGame;
    private long? gameSince;

    public LobbyWindow()
    {
        gameTimer.Tick += async (_, _) => await ScanGame();
        FormClosed += (_, _) => { ResetDetector(); gameTimer.Dispose(); };
        Text = "Squadlink Preview";
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        MinimumSize = new Size(820, 565);
        Size = new Size(1120, 730);
        BackColor = DesktopNavigation.Canvas;
        view.DefaultBackgroundColor = BackColor;
        directory = new RoomDirectory(() => origin);
        serverSettings.Dock = DockStyle.Fill;
        serverSettings.Padding = new Padding(24);
        serverSettings.FlowDirection = FlowDirection.TopDown;
        serverSettings.WrapContents = false;
        serverSettings.Controls.Add(new Label { Text = "Servidor del grupo", AutoSize = true, Font = new Font("Segoe UI",18,FontStyle.Bold) });
        serverSettings.Controls.Add(server);
        serverSettings.Controls.Add(connect);
        loading.TextAlign = ContentAlignment.MiddleCenter;
        workspace.Controls.Add(loading);
        workspace.Controls.Add(directory);
        workspace.Controls.Add(serverSettings);
        Controls.Add(workspace); Controls.Add(navigation);
        directory.Open += async (action, code) => await Navigate(action, code);
        navigation.ActionRequested += async action => await Navigate(action);
        connect.Click += async (_, _) =>
        {
            var address = ParseServer(server.Text);
            if (address == null) { MessageBox.Show(this, "Ingresa una dirección HTTPS o un servidor local HTTP."); return; }
            if (address == origin) { await Navigate("rooms"); return; }
            if (navigation.Joined && MessageBox.Show(this, "Cambiar de servidor desconectará la llamada. ¿Continuar?",
                "Cambiar servidor", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            try { Directory.CreateDirectory(dataDir); File.WriteAllText(Path.Combine(dataDir, "server.txt"), address.AbsoluteUri); }
            catch (IOException ex) { MessageBox.Show(this, ex.Message); return; }
            origin = address; ready = false; hasProfile = false;
            if (view.CoreWebView2 != null) { navigation.ResetState(); directory.SetJoined(false); view.CoreWebView2.Navigate(address.AbsoluteUri); }
            await Navigate("rooms");
        };
        Shown += async (_, _) =>
        {
            string saved = "";
            try { var file = Path.Combine(dataDir,"server.txt"); if (File.Exists(file)) saved = File.ReadAllText(file).Trim(); }
            catch (IOException) { }
            origin = ParseServer(saved) ?? new Uri(SharedLobby);
            server.Text = origin.AbsoluteUri;
            var directoryLoad = Navigate("rooms");
            try {
                var remembered = Path.Combine(dataDir,"presence-server.txt");
                hasProfile = File.Exists(remembered) && File.ReadAllText(remembered) == origin.AbsoluteUri;
                if (hasProfile && !opening) { opening = true; try { await Connect(); } finally { opening = false; } }
            } catch (IOException) { }
            await directoryLoad;
        };
    }

    private static Uri? ParseServer(string value) =>
        Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
        && (uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback))
        && uri.UserInfo.Length == 0 && uri.PathAndQuery == "/" && uri.Fragment.Length == 0 ? uri : null;

    private void Present(Control selected)
    {
        foreach (Control control in workspace.Controls)
            control.Visible = control == selected;
        selected.BringToFront();
    }

    private async Task Navigate(string action, string? code = null)
    {
        if (action is "mic" or "leave") { if (ready) Post(action); return; }
        visit++;
        page = action is "create" or "join" ? "lobby" : action;
        navigation.SelectPage(page);
        pendingAction = null; pendingCode = null;
        if (ready && view.CoreWebView2 != null)
            view.CoreWebView2.MemoryUsageTargetLevel = (page is "rooms" or "server") && !navigation.Joined
                ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
        if (page is "rooms" or "server")
        {
            if (ready) Post("background");
            if (page == "server") { Present(serverSettings); return; }
            Present(directory); await directory.Reload(); return;
        }
        if (ready) { Present(view); Post(action,code); return; }
        pendingAction = action; pendingCode = code;
        Present(loading);
        if (opening || view.CoreWebView2 != null) return;
        opening = true;
        try { await Connect(); } finally { opening = false; }
    }

    private void Post(string action, string? code = null)
    {
        if (view.CoreWebView2 != null && SameOrigin(view.CoreWebView2.Source))
            view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "desktop:action", action, code, visit }));
    }

    async Task Connect()
    {
        if (origin == null) return;
        connect.Enabled = false;
        try
        {
            Directory.CreateDirectory(dataDir);
            if (view.CoreWebView2 == null)
            {
                if (view.Parent == null) { workspace.Controls.Add(view); view.Visible = false; }
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"));
                await view.EnsureCoreWebView2Async(env);
                var core = view.CoreWebView2;
                var assets = new DesktopAssets();
                await core.CallDevToolsProtocolMethodAsync("Network.setBypassServiceWorker", "{\"bypass\":true}");
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += (_, e) =>
                {
                    if (SameOrigin(e.Request.Uri)) assets.Respond(core, e, new Uri(e.Request.Uri));
                };
                view.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
                view.CoreWebView2.NavigationStarting += (_, e) =>
                {
                    if (!SameOrigin(e.Uri) || new Uri(e.Uri).AbsolutePath != "/") e.Cancel = true;
                    else { ResetDetector(); ready = false; }
                };
                view.CoreWebView2.WebMessageReceived += OnWebMessage;
                view.CoreWebView2.PermissionRequested += (_, e) =>
                {
                    if (!SameOrigin(e.Uri) || e.PermissionKind != CoreWebView2PermissionKind.Microphone)
                        e.State = CoreWebView2PermissionState.Deny;
                    // WebView2 asks the player for microphone permission on the selected origin.
                };
                view.CoreWebView2.NavigationCompleted += (_, e) =>
                {
                    if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                        MessageBox.Show(this, "No se pudo cargar el lobby. Revisa la dirección y que el servidor esté encendido.");
                };
            }
            view.CoreWebView2.Navigate(origin.AbsoluteUri);
        }
        catch (Exception ex)
        {
            navigation.SelectPage("server"); Present(serverSettings);
            MessageBox.Show(this, "No se pudo abrir el lobby. Comprueba que Microsoft Edge WebView2 Runtime esté instalado.\n" + ex.Message);
        }
        finally { connect.Enabled = true; }
    }

    private void ResetDetector()
    {
        documentVersion++;
        gameTimer.Stop();
        gameEnabled = false;
        gamePromptShown = false;
        currentGame = null;
        gameSince = null;
    }

    private void SendGame()
    {
        if (IsDisposed || Disposing || view.CoreWebView2 == null ||
            !SameOrigin(view.CoreWebView2.Source)) return;
        view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {
            type = "squadlink:game", enabled = gameEnabled, game = currentGame, since = gameSince
        }));
    }

    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (view.CoreWebView2 == null || !SameOrigin(e.Source) || !SameOrigin(view.CoreWebView2.Source)) return;
        var raw = e.WebMessageAsJson;
        if (raw.Length > 2048) return;
        using var document = JsonDocument.Parse(raw);
        var msg = document.RootElement;
        if (msg.ValueKind != JsonValueKind.Object || !msg.TryGetProperty("type", out var kind) ||
            kind.ValueKind != JsonValueKind.String) return;
        var type = kind.GetString();
        if (type == "desktop:release" && msg.TryGetProperty("visit", out var token) && token.TryGetInt32(out int expected))
        {
            BeginInvoke(new Action(() =>
            {
                if (expected != visit || page is not ("rooms" or "server") || navigation.Joined || hasProfile || !ready) return;
                ready = false; ResetDetector(); view.Dispose();
                view = new WebView2 {Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor};
            }));
            return;
        }
        if (type == "desktop:state")
        {
            if (!hasProfile && origin != null && msg.TryGetProperty("identified", out var identified) && identified.ValueKind == JsonValueKind.True)
            {
                try { File.WriteAllText(Path.Combine(dataDir,"presence-server.txt"), origin.AbsoluteUri); hasProfile = true; }
                catch (IOException) { }
            }
            bool wasJoined = navigation.Joined;
            navigation.UpdateState(msg);
            directory.SetJoined(navigation.Joined);
            if (!ready)
            {
                ready = true;
                if (pendingAction != null) {
                    string action = pendingAction; pendingAction = null;
                    Present(view); Post(action, pendingCode); pendingCode = null;
                }
            }
            if (wasJoined != navigation.Joined && (navigation.Joined || page == "lobby"))
                await Navigate(navigation.Joined ? "lobby" : "rooms");
            return;
        }
        if (type == "squadlink:game:status") { SendGame(); return; }
        if (type != "squadlink:game:set" || !msg.TryGetProperty("enabled", out var flag) ||
            (flag.ValueKind != JsonValueKind.True && flag.ValueKind != JsonValueKind.False)) return;

        if (!flag.GetBoolean())
        {
            // Invalidate any scan or consent dialog still in flight.
            documentVersion++;
            gameEnabled = false;
            gameTimer.Stop();
            currentGame = null;
            gameSince = null;
        }
        else if (!gameEnabled && !prompting && !gamePromptShown)
        {
            int version = documentVersion;
            prompting = true;
            gamePromptShown = true;
            // Exit the WebView2 callback before opening a modal WinForms dialog.
            await Task.Yield();
            if (version != documentVersion || IsDisposed || Disposing) { prompting = false; return; }
            var allow = MessageBox.Show(this,
                $"¿Compartir con {origin!.Authority} el juego reconocido que tienes abierto y desde cuándo se detectó? Puedes desactivarlo desde el lobby.",
                "Actividad de juego", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            prompting = false;
            if (documentVersion != version) return;
            if (allow == DialogResult.Yes)
            {
                gameEnabled = true;
                gamePromptShown = false;
                gameTimer.Start();
                SendGame();
                await ScanGame();
                return;
            }
        }
        SendGame();
    }

    private async Task ScanGame()
    {
        if (!gameEnabled || scanRunning) return;
        int version = documentVersion;
        var previous = currentGame;
        scanRunning = true;
        try
        {
            var running = await Task.Run(() => GameDetector.FindRunningGame(previous));
            if (version != documentVersion || !gameEnabled || currentGame == running) return;
            currentGame = running;
            gameSince = running == null ? null : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            SendGame();
        }
        catch (Win32Exception) { /* A later interval retries if Windows cannot list processes. */ }
        finally { scanRunning = false; }
    }

    bool SameOrigin(string value) => origin != null && Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == origin.GetLeftPart(UriPartial.Authority);
}
