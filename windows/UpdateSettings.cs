using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Reflection;

internal sealed class UpdateSettings : FlowLayoutPanel
{
    private readonly HttpClient http = new(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All })
        { Timeout = TimeSpan.FromSeconds(12) };
    private readonly CancellationTokenSource closed = new();
    private readonly BuildStamp installed = BuildStamp.Installed;
    private readonly CheckBox startup = new() {Text="Buscar al abrir Squadlink",AutoSize=true,ForeColor=Color.WhiteSmoke};
    private readonly Button check = DesktopNavigation.ActionButton("Buscar actualizaciones");
    private readonly Button download = DesktopNavigation.ActionButton("Descargar actualización");
    private readonly Label status = Line("");
    private readonly string preference;
    private PreviewArtifact? available;
    public event Action<bool>? AvailabilityChanged;
    public UpdateSettings(string dataDir) {
        preference = Path.Combine(dataDir,"check-updates-on-start");
        FlowDirection = FlowDirection.TopDown; Dock=DockStyle.Fill; WrapContents=false; AutoScroll=true;
        Padding=new Padding(24); BackColor=DesktopNavigation.Canvas;
        var heading=Line("Actualizaciones"); heading.Font=new Font("Segoe UI",20,FontStyle.Bold); Controls.Add(heading);
        string version=typeof(UpdateSettings).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "";
        Controls.Add(Line($"Versión instalada: {version} · Compilación {(installed.Number>0?installed.ToString():"local")}"));
        startup.Checked=File.Exists(preference);
        startup.CheckedChanged+=(_,_)=>{
            try {
                if (startup.Checked) {Directory.CreateDirectory(dataDir); File.WriteAllText(preference,"1");}
                else File.Delete(preference);
            } catch(Exception ex) when(ex is IOException or UnauthorizedAccessException) {status.Text="Windows no pudo guardar la preferencia de inicio.";}
        };
        Controls.Add(startup);
        foreach(var button in new[]{check,download}) {button.Dock=DockStyle.None;button.Size=new Size(235,40);Controls.Add(button);}
        check.Click+=async (_,_)=>await CheckNow();
        download.Visible=false;
        download.Click+=async (_,_)=>{
            if (available==null) return;
            if (!available.IsAvailableAt(DateTimeOffset.UtcNow)) {
                SetAvailable(null);
                await CheckNow();
                return;
            }
            try { Process.Start(new ProcessStartInfo(available.Url.AbsoluteUri){UseShellExecute=true}); }
            catch(System.ComponentModel.Win32Exception) {status.Text="Windows no pudo abrir el navegador. Revisa la aplicación predeterminada.";}
        };
        Controls.Add(status);
        Controls.Add(Line("La descarga abre GitHub en tu navegador. Inicia sesión, extrae el ZIP y ejecuta el instalador cuando termines la llamada."));
    }
    private static Label Line(string text)=>new(){Text=text,AutoSize=true,MaximumSize=new Size(470,0),ForeColor=Color.WhiteSmoke,Margin=new Padding(0,6,0,12),Font=new Font("Segoe UI",10)};
    public async Task CheckAtStartup() { if(startup.Checked) await CheckNow(); }
    private void SetAvailable(PreviewArtifact? artifact)
    {
        available = artifact;
        download.Visible = artifact != null;
        AvailabilityChanged?.Invoke(artifact != null);
    }

    private async Task CheckNow() {
        if(!check.Enabled) return;
        check.Enabled=false; status.Text="Consultando compilaciones de Windows…";
        bool isLocal=installed.Number<=0;
        try {
            var result=await new PreviewUpdates(http).Check(installed,closed.Token);
            if(IsDisposed || Disposing) return;
            SetAvailable(result.Artifact);
            status.Text=available!=null
                ? (isLocal ? "Compilación de prueba disponible: " : "Actualización disponible: ")+available.Build
                : result.Unavailable ? "Hay compilaciones más recientes, pero su instalador ya no está disponible."
                : isLocal ? "No se encontró un instalador disponible." : "Tienes la última compilación disponible.";
        } catch(Exception ex) when(ex is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException or InvalidOperationException or KeyNotFoundException or FormatException) {
            if (IsDisposed || Disposing) return;
            SetAvailable(available?.IsAvailableAt(DateTimeOffset.UtcNow) == true ? available : null);
            status.Text = available != null
                ? $"No se pudo consultar GitHub. Sigue disponible la descarga verificada anteriormente ({available.Build})."
                : "No se pudo consultar GitHub. Revisa tu conexión y vuelve a intentarlo.";
        } finally {if(!IsDisposed && !Disposing) check.Enabled=true;}
    }
    protected override void Dispose(bool disposing) {
        if(disposing && !IsDisposed){closed.Cancel();http.Dispose();closed.Dispose();} base.Dispose(disposing);
    }
}
