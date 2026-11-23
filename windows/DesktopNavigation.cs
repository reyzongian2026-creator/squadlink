using System.Text.Json;

internal sealed class DesktopNavigation : UserControl
{
    internal static readonly Color Rail = Color.FromArgb(22,23,31), Surface = Color.FromArgb(31,32,43),
        Canvas = Color.FromArgb(37,38,49), Active = Color.FromArgb(65,65,85),
        Accent = Color.FromArgb(190,242,106), Muted = Color.FromArgb(185,185,201);
    private static readonly (string Name, string Glyph, (string Id, string Label)[] Pages)[] Groups = {
        ("Voz", "\uE720", new[] { ("rooms", "Explorar salas"), ("lobby", "Mi sala") }),
        ("Comunidad", "\uE716", new[] { ("friends", "Amigos"), ("player", "Mi jugador") }),
        ("Juegos", "\uE7FC", new[] { ("arcade", "Minijuegos"), ("ranking", "Clasificación") }),
        ("Preferencias", "\uE713", new[] { ("settings", "Dispositivos"), ("server", "Servidor") })
    };
    private readonly TableLayoutPanel rail = Stack(Rail), channels = Stack(Surface);
    private readonly Panel context = new() {Dock = DockStyle.Fill, BackColor = Surface, Padding = new Padding(12, 0, 12, 10)};
    private readonly Label groupName = Caption("", 14, FontStyle.Bold);
    private readonly Label voiceName = Caption("Sin sala", 10, FontStyle.Bold);
    private readonly Button mic = ActionButton("Activar micrófono"), leave = ActionButton("Salir de sala");
    private readonly ToolTip tips = new();
    private readonly List<Button> groupButtons = new();
    private readonly Dictionary<string, Button> pageButtons = new();
    private int shownGroup = -1;
    public bool Joined { get; private set; }
    public event Action<string>? ActionRequested;

    public DesktopNavigation()
    {
        Width = 262; Dock = DockStyle.Left; BackColor = Rail;
        var strip = new Panel {Dock = DockStyle.Left, Width = 62, BackColor = Rail};
        strip.Controls.Add(rail);
        rail.Padding = new Padding(7, 0, 7, 0);
        var brand = Caption("SL", 16, FontStyle.Bold); brand.ForeColor = Accent; brand.TextAlign = ContentAlignment.MiddleCenter;
        Row(rail, brand, 62);
        foreach (var group in Groups)
        {
            var button = ActionButton(group.Glyph);
            button.Font = new Font("Segoe MDL2 Assets", 16);
            button.TextAlign = ContentAlignment.MiddleCenter; button.Padding = Padding.Empty;
            button.AccessibleName = group.Name; tips.SetToolTip(button, group.Name);
            button.Click += (_, _) => ActionRequested?.Invoke(group.Pages[0].Id);
            groupButtons.Add(button); Row(rail, button, 50);
        }
        groupName.Height = 62; groupName.Dock = DockStyle.Top;
        var call = Stack(Surface); call.Dock = DockStyle.Bottom; call.Height = 130;
        Row(call, voiceName, 38); Row(call, mic, 38); Row(call, leave, 38);
        mic.Click += (_, _) => ActionRequested?.Invoke("mic"); leave.Click += (_, _) => ActionRequested?.Invoke("leave");
        context.Controls.Add(channels); context.Controls.Add(groupName); context.Controls.Add(call);
        Controls.Add(context); Controls.Add(strip);
        ResetState(); SelectPage("rooms");
    }

    public static Button ActionButton(string text)
    {
        var button = new Button {Text = text, AutoEllipsis = true, Dock = DockStyle.Fill, Padding = new Padding(9,0,5,0),
            FlatStyle = FlatStyle.Flat, BackColor = Surface, ForeColor = Color.WhiteSmoke, UseVisualStyleBackColor = false,
            TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0,2,0,2), Font = new Font("Segoe UI", 10)};
        button.FlatAppearance.BorderSize = 0; button.FlatAppearance.MouseOverBackColor = Active;
        return button;
    }
    public static Label Caption(string text, float size, FontStyle style) => new() {
        Text = text, AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.WhiteSmoke,
        Font = new Font("Segoe UI", size, style), Dock = DockStyle.Fill, Margin = Padding.Empty };
    private static TableLayoutPanel Stack(Color color)
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, BackColor = color };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); return panel;
    }
    private static void Row(TableLayoutPanel panel, Control control, int height)
    {
        int row = panel.RowStyles.Count; panel.RowCount = row + 1;
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute,height)); panel.Controls.Add(control,0,row);
    }

    public void SelectPage(string page)
    {
        int idx = Array.FindIndex(Groups, g => g.Pages.Any(p => p.Id == page));
        if (idx < 0) return;
        if (shownGroup != idx)
        {
            shownGroup = idx; groupName.Text = Groups[idx].Name;
            for (int i=0;i<groupButtons.Count;i++) {
                groupButtons[i].BackColor = i == idx ? Active : Rail;
                groupButtons[i].ForeColor = i == idx ? Accent : Muted;
            }
            channels.SuspendLayout();
            foreach (var old in pageButtons.Values) old.Dispose();
            pageButtons.Clear(); channels.RowStyles.Clear(); channels.RowCount = 0;
            foreach (var section in Groups[idx].Pages)
            {
                var button = ActionButton(section.Label);
                button.Click += (_, _) => ActionRequested?.Invoke(section.Id);
                pageButtons[section.Id] = button; Row(channels, button, 40);
            }
            channels.ResumeLayout();
        }
        foreach (var pair in pageButtons) pair.Value.BackColor = pair.Key == page ? Active : Surface;
    }

    public void ResetState()
    {
        Joined = false; voiceName.Text = "Sin sala"; mic.Text = "Activar micrófono"; mic.Enabled = leave.Enabled = false;
    }
    public void UpdateState(JsonElement state)
    {
        bool Flag(string key) => state.TryGetProperty(key, out var f) && f.ValueKind == JsonValueKind.True;
        Joined = Flag("joined");
        voiceName.Text = Joined ? state.GetProperty("name").GetString() : "Sin sala";
        mic.Text = Flag("mic") ? "Silenciar micrófono" : "Activar micrófono";
        mic.Enabled = Joined && Flag("canMic"); leave.Enabled = Joined && Flag("canLeave");
    }
    protected override void Dispose(bool disposing) { if (disposing) tips.Dispose(); base.Dispose(disposing); }
}
