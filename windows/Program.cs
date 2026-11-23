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
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Squadlink");
    private readonly TextBox server = new() { Width = 340, PlaceholderText = "https://lobby.tudominio.com" };
    private readonly Button connect = new() { Text = "Conectar", AutoSize = true };
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };
    private Uri? origin;

    public LobbyWindow()
    {
        Text = "Squadlink";
        MinimumSize = new Size(520, 400);
        Size = new Size(1100, 760);
        var bar = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(6) };
        bar.Controls.Add(new Label { Text = "Servidor", AutoSize = true, Padding = new Padding(0, 6, 0, 0) });
        bar.Controls.Add(server);
        bar.Controls.Add(connect);
        Controls.Add(view);
        Controls.Add(bar);
        AcceptButton = connect;
        connect.Click += async (_, _) => await Connect();
        Shown += async (_, _) =>
        {
            try
            {
                var file = Path.Combine(dataDir, "server.txt");
                if (File.Exists(file)) { server.Text = File.ReadAllText(file).Trim(); await Connect(); }
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
                view.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
                view.CoreWebView2.NavigationStarting += (_, e) =>
                {
                    if (!SameOrigin(e.Uri)) e.Cancel = true;
                };
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
            view.CoreWebView2.Navigate(address.AbsoluteUri);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "No se pudo abrir el lobby. Comprueba que Microsoft Edge WebView2 Runtime esté instalado.\n" + ex.Message);
        }
        finally { connect.Enabled = true; }
    }

    bool SameOrigin(string value) => origin != null && Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == origin.GetLeftPart(UriPartial.Authority);
}
