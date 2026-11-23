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
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };
    private const string SharedLobby = "https://squadlink-lobby.onrender.com";
    private readonly DesktopNavigation navigation = new();
    private readonly FlowLayoutPanel serverSettings = new() { Dock = DockStyle.Top, AutoSize = true, Visible = false,
        BackColor = Color.FromArgb(34, 32, 46), ForeColor = Color.WhiteSmoke, Padding = new Padding(8) };
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
        MinimumSize = new Size(660, 565);
        Size = new Size(1100, 760);
        BackColor = Color.FromArgb(22, 21, 30);
        view.DefaultBackgroundColor = BackColor;
        var workspace = new Panel { Dock = DockStyle.Fill };
        serverSettings.Controls.Add(new Label { Text = "Servidor del grupo", AutoSize = true, Padding = new Padding(0, 6, 0, 0) });
        serverSettings.Controls.Add(server);
        serverSettings.Controls.Add(connect);
        workspace.Controls.Add(view);
        workspace.Controls.Add(serverSettings);
        Controls.Add(workspace);
        Controls.Add(navigation);
        navigation.ActionRequested += action =>
        {
            if (action == "settings") serverSettings.Visible = true;
            else if (action != "mic" && action != "leave") serverSettings.Visible = false;
            if (view.CoreWebView2 != null && SameOrigin(view.CoreWebView2.Source))
                view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "desktop:action", action }));
        };
        connect.Click += async (_, _) =>
        {
            if (navigation.Joined && MessageBox.Show(this, "Reconectar te desconectará de la sala. ¿Continuar?",
                "Cambiar servidor", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            await Connect();
        };
        Shown += async (_, _) =>
        {
            try
            {
                var file = Path.Combine(dataDir, "server.txt");
                server.Text = File.Exists(file) ? File.ReadAllText(file).Trim() : SharedLobby;
                if (string.IsNullOrWhiteSpace(server.Text)) server.Text = SharedLobby;
                await Connect();
            }
            catch (IOException) { server.Focus(); }
        };
    }

    async Task Connect()
    {
        if (!Uri.TryCreate(server.Text.Trim(), UriKind.Absolute, out var address)
            || !(address.Scheme == "https" || (address.Scheme == "http" && address.IsLoopback))
            || address.UserInfo.Length != 0 || address.PathAndQuery != "/" || address.Fragment.Length != 0)
        {
            MessageBox.Show(this, "Ingresa la dirección HTTPS del servidor del grupo. Para pruebas locales puedes usar http://localhost:4179.");
            return;
        }
        connect.Enabled = false;
        try
        {
            Directory.CreateDirectory(dataDir);
            if (view.CoreWebView2 == null)
            {
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
                    else { ResetDetector(); navigation.ResetState(); }
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
            origin = address;
            File.WriteAllText(Path.Combine(dataDir, "server.txt"), address.GetLeftPart(UriPartial.Authority));
            serverSettings.Visible = false;
            view.CoreWebView2.Navigate(address.AbsoluteUri);
        }
        catch (Exception ex)
        {
            serverSettings.Visible = true;
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
        if (!SameOrigin(e.Source) || !SameOrigin(view.CoreWebView2.Source)) return;
        var raw = e.WebMessageAsJson;
        if (raw.Length > 2048) return;
        using var document = JsonDocument.Parse(raw);
        var msg = document.RootElement;
        if (msg.ValueKind != JsonValueKind.Object || !msg.TryGetProperty("type", out var kind) ||
            kind.ValueKind != JsonValueKind.String) return;
        var type = kind.GetString();
        if (type == "desktop:state")
        {
            navigation.UpdateState(msg);
            if (msg.TryGetProperty("section", out var section) && section.ValueKind == JsonValueKind.String)
                serverSettings.Visible = section.GetString() == "settings";
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
