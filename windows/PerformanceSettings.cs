internal sealed class PerformanceSettings : FlowLayoutPanel
{
    private readonly string file;
    private readonly RadioButton low = Choice("Bajo consumo");
    private readonly RadioButton full = Choice("Experiencia completa");
    public bool Low => low.Checked;
    public event Action? Changed;

    public PerformanceSettings(string dataDir)
    {
        file = Path.Combine(dataDir, "performance.txt");
        Dock = DockStyle.Fill; FlowDirection = FlowDirection.TopDown; WrapContents = false;
        AutoScroll = true; Padding = new Padding(24); BackColor = DesktopNavigation.Canvas;
        Controls.Add(LabelFor("Rendimiento", 20, true));
        Controls.Add(low);
        Controls.Add(LabelFor("Para equipos básicos. Usa vistas nativas de amigos y llamada, y libera los paneles de invitados al salir.", 10));
        Controls.Add(full);
        Controls.Add(LabelFor("Para equipos con más memoria. Abre las vistas detalladas y conserva los paneles listos para volver.", 10));
        bool detailed = false;
        try { detailed = File.Exists(file) && File.ReadAllText(file).Trim() == "full"; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        low.Checked = !detailed; full.Checked = detailed;
        low.CheckedChanged += Save; full.CheckedChanged += Save;
    }

    private static Label LabelFor(string text, float size, bool bold = false) => new()
    {
        Text = text, AutoSize = true, MaximumSize = new Size(440,0), ForeColor = Color.WhiteSmoke,
        Font = new Font("Segoe UI",size,bold ? FontStyle.Bold : FontStyle.Regular), Margin = new Padding(0,3,0,15)
    };
    private static RadioButton Choice(string text) => new() {
        Text = text, AutoSize = true, ForeColor = DesktopNavigation.Accent, Font = new Font("Segoe UI",12,FontStyle.Bold),
        Margin = new Padding(0,12,0,2)
    };
    private void Save(object? sender, EventArgs args)
    {
        if (sender is not RadioButton {Checked:true}) return;
        string? temp = null;
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temp, Low ? "low" : "full");
            File.Move(temp,file,true);
        } catch (Exception e) when (e is IOException or UnauthorizedAccessException) {
            MessageBox.Show(this,"El cambio se aplicará solo en esta sesión. Windows no pudo guardar la preferencia.");
        } finally {
            try { if (temp != null) File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        Changed?.Invoke();
    }
}
