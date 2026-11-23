using System.Text.Json;

internal sealed class LightWorkspace : UserControl
{
    private readonly Label title = DesktopNavigation.Caption("",19,FontStyle.Bold);
    private readonly Label summary = DesktopNavigation.Caption("",10,FontStyle.Regular);
    private readonly ListBox list = new() {Dock = DockStyle.Fill, BackColor = DesktopNavigation.Canvas,
        ForeColor = Color.WhiteSmoke, BorderStyle = BorderStyle.None, Font = new Font("Segoe UI",11), IntegralHeight = false};
    private readonly Button detail = DesktopNavigation.ActionButton("");
    private bool friends = true, identified;
    private string name = "", code = "", voiceStatus = "";
    private string[] contacts = [], members = [];
    public event Action<string>? DetailRequested;

    public LightWorkspace()
    {
        Dock = DockStyle.Fill; Padding = new Padding(24); BackColor = DesktopNavigation.Canvas;
        var layout = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 1};
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        foreach (int h in new[]{48,46,46}) layout.RowStyles.Add(new RowStyle(SizeType.Absolute,h));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        layout.Controls.Add(title,0,0); layout.Controls.Add(summary,0,1);
        detail.Width = 230; detail.Dock = DockStyle.Left;
        layout.Controls.Add(detail,0,2); layout.Controls.Add(list,0,3); Controls.Add(layout);
        detail.Click += (_,_) => DetailRequested?.Invoke(friends ? identified ? "friends-detail" : "login" : "room-detail");
    }
    public void ResetSnapshot() { name = code = voiceStatus = ""; identified = false; contacts = []; members = []; Render(); }
    public void ShowPage(bool social) { friends = social; Render(); }
    public void UpdateSnapshot(JsonElement state)
    {
        string Text(string key) => state.GetProperty(key).GetString() ?? "";
        string[] Lines(string key) => state.GetProperty(key).EnumerateArray().Select(x=>x.GetString() ?? "").ToArray();
        name = Text("name"); code = Text("code"); voiceStatus = Text("voiceStatus");
        identified = state.GetProperty("identified").GetBoolean();
        contacts = Lines("contacts"); members = Lines("members");
        if (Visible) Render();
    }
    private void Render()
    {
        title.Text = friends ? "Amigos" : name;
        summary.Text = friends ? !identified ? "Elige tu apodo para agregar amigos." : contacts.Length == 0
            ? "Tu lista de amigos está vacía." : contacts.Length == 25 ? "Primeros 25 contactos · Abre Gestionar para ver todos." : "Actividad de tus contactos"
            : "Código de sala: " + code + (voiceStatus.Length > 0 ? " · " + voiceStatus : "");
        detail.Text = friends ? identified ? "Gestionar amigos y solicitudes" : "Elegir mi apodo" : "Abrir controles de sala";
        list.AccessibleName = friends ? "Contactos" : "Participantes";
        var rows = friends ? contacts : members;
        if (list.Items.Cast<string>().SequenceEqual(rows)) return;
        list.BeginUpdate(); list.Items.Clear(); list.Items.AddRange(rows); list.EndUpdate();
    }
}
