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
    private readonly FlowLayoutPanel recovery = new() { Dock=DockStyle.Fill, FlowDirection=FlowDirection.TopDown,
        Padding=new Padding(24), BackColor=DesktopNavigation.Canvas };
    private System.Windows.Forms.Timer? clientStartup;
    private WebView2? openingClient;
    private bool closing;
    private readonly PerformanceSettings performance;
    private readonly UpdateSettings updates;
    private readonly LightWorkspace lite = new(), friendsPanel = new();
    private readonly Dictionary<string,FeatureWindow> windows = new();
    private FeatureWindow? detailWindow;
    private RoomEntryWindow? entryWindow;
    private object? entryData;
    private string? entryToken;
    private string rememberedNick = "";
    private bool nativePage;
    private string page = "rooms";
    private string? pendingAction, pendingCode;
    private bool ready, hasProfile;
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
        FormClosed += (_, _) => { closing = true; StopStartupWatch(); ResetDetector(); gameTimer.Dispose(); };
        Text = "Squadlink Preview";
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        MinimumSize = new Size(720, 420);
        ClientSize = new Size(870, 472);
        BackColor = DesktopNavigation.Canvas;
        view.DefaultBackgroundColor = BackColor;
        updates = new UpdateSettings(dataDir);
        updates.AvailabilityChanged += found => Text = found ? "Squadlink Preview · Actualización disponible" : "Squadlink Preview";

        performance = new PerformanceSettings(dataDir);
        performance.Changed += () => SetMemoryTarget();
        lite.DetailRequested += async action => await Navigate(action);
        friendsPanel.DetailRequested += async action => await Navigate(action);
        friendsPanel.ShowPage(true); lite.ShowPage(false);
        directory = new RoomDirectory(() => origin);
        serverSettings.Dock = DockStyle.Fill;
        serverSettings.Padding = new Padding(24);
        serverSettings.FlowDirection = FlowDirection.TopDown;
        serverSettings.WrapContents = false;
        serverSettings.Controls.Add(new Label { Text = "Servidor del grupo", AutoSize = true, Font = new Font("Segoe UI",18,FontStyle.Bold) });
        serverSettings.Controls.Add(server);
        serverSettings.Controls.Add(connect);
        recovery.Controls.Add(new Label {Text="No se pudo abrir la sección",AutoSize=true,
            ForeColor=Color.WhiteSmoke,Font=new Font("Segoe UI",17,FontStyle.Bold)});
        recovery.Controls.Add(new Label {Text="Si el problema continúa, comprueba WebView2 y vuelve a instalar Squadlink Preview.",AutoSize=true,
            MaximumSize=new Size(440,0),ForeColor=DesktopNavigation.Muted});
        var retry = DesktopNavigation.ActionButton("Reintentar sección");
        retry.Dock=DockStyle.None; retry.Size=new Size(175,42); recovery.Controls.Add(retry);
        retry.Click += async (_,_) => await Navigate(pendingAction ?? "lobby",pendingCode);
        workspace.Controls.Add(recovery);
        loading.TextAlign = ContentAlignment.MiddleCenter;
        workspace.Controls.Add(loading);
        Controls.Add(navigation);
        FormClosing += (_,_) => { closing=true; entryWindow?.Complete(); foreach (var window in windows.Values) window.Dispose(); workspace.Dispose(); };
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
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { MessageBox.Show(this, ex.Message); return; }
            ResetClient();
            navigation.ResetState();
            directory.SetJoined(false);
            lite.ResetSnapshot(); friendsPanel.ResetSnapshot(); rememberedNick="";
            origin = address;
            server.Text = address.AbsoluteUri;
            await OpenDirectory();
        };
        Shown += async (_, _) =>
        {
            string saved = "";
            try { var file = Path.Combine(dataDir,"server.txt"); if (File.Exists(file)) saved = File.ReadAllText(file).Trim(); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            origin = ParseServer(saved) ?? new Uri(SharedLobby);
            server.Text = origin.AbsoluteUri;
            _ = updates.CheckAtStartup();
            await OpenDirectory();
        };
    }

    private async Task OpenDirectory()
    {
        hasProfile = false;
        try {
            var remembered = Path.Combine(dataDir,"presence-server.txt");
            hasProfile = File.Exists(remembered) && File.ReadAllText(remembered) == origin?.AbsoluteUri;
        } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        nativePage=true;
        if (hasProfile) { EnsureEngineWindow(); await Connect(); }
    }

    private void RememberProfile(bool present)
    {
        if (origin == null || hasProfile == present) return;
        hasProfile = present;
        var remembered = Path.Combine(dataDir, "presence-server.txt");
        try
        {
            if (present) File.WriteAllText(remembered, origin.AbsoluteUri);
            else if (File.Exists(remembered) && File.ReadAllText(remembered) == origin.AbsoluteUri)
                File.Delete(remembered);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private static Uri? ParseServer(string value) =>
        Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
        && (uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback))
        && uri.UserInfo.Length == 0 && uri.PathAndQuery == "/" && uri.Fragment.Length == 0 ? uri : null;

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (!view.ContainsFocus && Control.FromHandle(msg.HWnd) is not (TextBoxBase or ComboBox) &&
            navigation.TryMicrophoneShortcut(keyData, msg.LParam)) return true;
        return base.ProcessCmdKey(ref msg, keyData);
    }

    private void Home()
    {
        if (closing) return;
        if (WindowState==FormWindowState.Minimized) WindowState=FormWindowState.Normal;
        Show(); Activate(); navigation.Focus();
    }
    private FeatureWindow WindowFor(string key, string title)
    {
        if (windows.TryGetValue(key, out var existing)) return existing;
        var window=new FeatureWindow(title,Home,(keys,flags)=>!view.ContainsFocus && navigation.TryMicrophoneShortcut(keys,flags));
        window.Icon=Icon;
        window.FormClosing+=(_,e)=>{
            if (closing || e.CloseReason!=CloseReason.UserClosing) return;
            e.Cancel=true; window.Hide();
            if (window==detailWindow) {
                nativePage=true; visit++; pendingAction=pendingCode=null;
                if (ready) Post("background");
            }
            Home();
        };
        windows[key]=window; return window;
    }
    private void EnsureEngineWindow()
    {
        if (workspace.Parent==null) { var engine=WindowFor("lobby-detail","Mi sala"); engine.Content.Controls.Add(workspace); _=engine.Handle; _=workspace.Handle; }
    }
    private static void Reveal(Form window)
    {
        if (window.WindowState==FormWindowState.Minimized) window.WindowState=FormWindowState.Normal;
        window.Show(); window.Activate();
    }
    private void NativeWindow(string key,string title,Control panel)
    {
        var window=WindowFor(key,title);
        if (panel.Parent!=window.Content) window.Content.Controls.Add(panel);
        panel.Visible=true; Reveal(window);
    }
    private void DetailWindow(string key,string title)
    {
        var window=WindowFor(key,title);
        if (detailWindow!=null && detailWindow!=window) detailWindow.Hide();
        detailWindow=window;
        if (workspace.Parent!=window.Content) window.Content.Controls.Add(workspace);
        Reveal(window);
    }
    private void OpenEntry(bool creating,string? code)
    {
        if (navigation.Joined) return;
        if (entryWindow!=null && !entryWindow.IsDisposed) {
            if (entryWindow.Busy || entryWindow.Creating==creating) { Reveal(entryWindow); return; }
            entryWindow.Close();
        }
        var form = new RoomEntryWindow(creating,code,rememberedNick) { Icon=Icon };
        entryWindow=form;
        form.Submitted+=async data=>{
            entryData=data; entryToken=Guid.NewGuid().ToString("N");
            if (ready) SendEntry();
            else { EnsureEngineWindow(); await Connect(); }
        };
        form.FormClosed+=(_,_)=>{entryWindow=null; entryToken=null; entryData=null;};
        Reveal(form);
    }
    private void SendEntry()
    {
        if (entryData==null || entryToken==null || !ready) return;
        var data=entryData; entryData=null;
        view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {type="desktop:submit",token=entryToken,data}));
    }

    private void Present(Control selected)
    {
        foreach (Control control in workspace.Controls)
            control.Visible = control == selected;
        selected.BringToFront();
    }

    private async Task Navigate(string action, string? code = null)
    {
        if (action is "mic" or "leave") { if (ready) Post(action); return; }
        if (action is "create" or "join") { OpenEntry(action=="create",code); return; }
        if (action=="lobby" && !navigation.Joined) { await Navigate("rooms"); return; }
        visit++;
        page = action switch {
            "create" or "join" or "room-detail" => "lobby",
            "login" or "friends-detail" => "friends",
            _ => action
        };
        pendingAction = null; pendingCode = null;
        bool useLite = performance.Low && (action == "friends" || (action == "lobby" && navigation.Joined));
        nativePage = useLite || page is "rooms" or "server" or "performance" or "updates";
        SetMemoryTarget();
        if (nativePage)
        {
            if (detailWindow?.Visible==true) detailWindow.Hide();
            if (ready) Post("background");
            if (useLite) { bool friends=page=="friends"; var panel=friends?friendsPanel:lite; NativeWindow(friends?"friends":"lobby",friends?"Amigos":"Mi sala",panel); panel.ShowPage(friends); return; }
            if (page=="updates") { NativeWindow(page,"Actualizaciones",updates); return; }
            if (page=="performance") { NativeWindow(page,"Rendimiento",performance); return; }
            if (page=="server") { serverSettings.Visible=true; NativeWindow(page,"Servidor",serverSettings); return; }
            NativeWindow("rooms","Explorar salas",directory); await directory.Reload(); return;
        }
        var title = page switch { "friends"=>"Amigos · Detalles","settings"=>"Dispositivos","player"=>"Mi jugador","ranking"=>"Clasificación","arcade"=>"Minijuegos",_=>"Mi sala · Detalles" };
        DetailWindow(page+"-detail", title);
        action = action switch { "friends-detail" => "friends", "room-detail" => "lobby", _ => action };
        if (ready) { Present(view); Post(action,code); return; }
        pendingAction = action; pendingCode = code;
        Present(loading);
        await Connect();
    }

    private void SetMemoryTarget()
    {
        if (ready && view.CoreWebView2 != null)
            view.CoreWebView2.MemoryUsageTargetLevel = performance.Low
                ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
    }

    private void Post(string action, string? code = null)
    {
        if (view.CoreWebView2 != null && SameOrigin(view.CoreWebView2.Source))
            view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "desktop:action", action, code, visit, low = performance.Low }));
    }

    async Task Connect()
    {
        var client = view;
        var address = origin;
        if (address == null || !IsCurrent(client) || openingClient == client || client.CoreWebView2 != null) return;
        openingClient = client;
        WatchStartup(client);
        try
        {
            Directory.CreateDirectory(dataDir);
            if (client.Parent == null) { workspace.Controls.Add(client); client.Visible = false; }
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"));
            if (!IsCurrent(client)) return;
            await client.EnsureCoreWebView2Async(env);
            if (!IsCurrent(client)) return;
            var core = client.CoreWebView2;
            var assets = new DesktopAssets();
            await core.CallDevToolsProtocolMethodAsync("Network.setBypassServiceWorker", "{\"bypass\":true}");
            if (!IsCurrent(client)) return;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) =>
            {
                if (IsCurrent(client) && SameOrigin(e.Request.Uri)) assets.Respond(core, e, new Uri(e.Request.Uri));
            };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            ulong navigationId = 0;
            core.NavigationStarting += (_, e) =>
            {
                if (!IsCurrent(client) || !SameOrigin(e.Uri) || new Uri(e.Uri).AbsolutePath != "/") e.Cancel = true;
                else { navigationId = e.NavigationId; ResetDetector(); ready = false; WatchStartup(client); }
            };
            core.WebMessageReceived += (sender, e) => { if (IsCurrent(client)) OnWebMessage(sender, e); };
            core.PermissionRequested += (_, e) =>
            {
                if (!IsCurrent(client) || !SameOrigin(e.Uri) || e.PermissionKind != CoreWebView2PermissionKind.Microphone)
                    e.State = CoreWebView2PermissionState.Deny;
                // WebView2 asks the player for microphone permission on the selected origin.
            };
            core.NavigationCompleted += (_, e) =>
            {
                var id = e.NavigationId;
                if (IsCurrent(client) && id == navigationId && !e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                    BeginInvoke(new Action(() => { if (id == navigationId) ClientFailed(client); }));
            };
            core.Navigate(address.AbsoluteUri);
        }
        catch (Exception)
        {
            ClientFailed(client);
        }
        finally { if (openingClient == client) openingClient = null; }
    }

    private bool IsCurrent(WebView2 client) => !closing && !IsDisposed && !Disposing && view == client;

    private void WatchStartup(WebView2 client)
    {
        StopStartupWatch();
        var watch = new System.Windows.Forms.Timer { Interval = 20_000 };
        clientStartup = watch;
        watch.Tick += (_, _) => { if (clientStartup == watch) ClientFailed(client); };
        watch.Start();
    }

    private void StopStartupWatch()
    {
        var watch = clientStartup;
        clientStartup = null;
        watch?.Dispose();
    }

    private void ResetClient()
    {
        StopStartupWatch();
        var previous = view;
        ready = false;
        openingClient = null;
        ResetDetector();
        view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        previous.Dispose();
    }

    private void ClientFailed(WebView2 failed)
    {
        if (!IsCurrent(failed)) return;
        ResetClient();
        navigation.ResetState(); directory.SetJoined(false); lite.ResetSnapshot(); friendsPanel.ResetSnapshot();
        entryData=null; entryWindow?.Error("No se pudo abrir la conexión. Vuelve a intentarlo.");
        if (!nativePage) Present(recovery);
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
        if (raw.Length > 32768) return;
        using var document = JsonDocument.Parse(raw);
        var msg = document.RootElement;
        if (msg.ValueKind != JsonValueKind.Object || !msg.TryGetProperty("type", out var kind) ||
            kind.ValueKind != JsonValueKind.String) return;
        var type = kind.GetString();
        if (type=="desktop:entry-result" && msg.TryGetProperty("token",out var requestId) && requestId.GetString()==entryToken)
        {
            if (msg.TryGetProperty("error",out var error)) entryWindow?.Error(error.GetString() ?? "Revisa los datos de la sala.");
            else entryWindow?.Complete();
            return;
        }
        if (type == "desktop:session" && msg.TryGetProperty("status", out var sessionStatus)
            && sessionStatus.ValueKind == JsonValueKind.String && sessionStatus.GetString() == "guest")
        {
            RememberProfile(false);
            if (ready && nativePage && performance.Low && !navigation.Joined) Post("background");
            return;
        }
        if (type == "desktop:release" && msg.TryGetProperty("visit", out var token) && token.TryGetInt32(out int expected))
        {
            var releasing = view;
            BeginInvoke(new Action(() =>
            {
                if (!IsCurrent(releasing) || expected != visit || !nativePage || entryWindow?.Busy==true || !performance.Low || navigation.Joined || hasProfile || !ready) return;
                ResetClient();
            }));
            return;
        }
        if (type == "desktop:state")
        {
            if (msg.TryGetProperty("identified", out var identified) && identified.ValueKind == JsonValueKind.True)
                RememberProfile(true);
            bool wasJoined = navigation.Joined;
            navigation.UpdateState(msg);
            if (msg.TryGetProperty("nickname",out var nick)) rememberedNick=nick.GetString() ?? "";
            lite.UpdateSnapshot(msg); friendsPanel.UpdateSnapshot(msg);
            directory.SetJoined(navigation.Joined);
            if (!ready)
            {
                StopStartupWatch(); ready = true; SetMemoryTarget();
                if (pendingAction != null) {
                    string action = pendingAction; pendingAction = null;
                    Present(view); Post(action, pendingCode); pendingCode = null;
                } else if (nativePage) { Post("background"); }
            }
            SendEntry();
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
