using System.Text.Json;

internal sealed class DesktopNavigation : TableLayoutPanel
{
    private static readonly Color Background = Color.FromArgb(27, 26, 36);
    private static readonly Color Selected = Color.FromArgb(64, 60, 87);
    private readonly Dictionary<string, Button> pages = new();
    private readonly Label status = new() { Dock = DockStyle.Fill, ForeColor = Color.Gainsboro, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    private readonly Button microphone = MakeButton("Activar micrófono");
    private readonly Button leave = MakeButton("Salir de sala");
    public bool Joined { get; private set; }
    public event Action<string>? ActionRequested;

    public DesktopNavigation()
    {
        Dock = DockStyle.Left;
        Width = 185;
        Padding = new Padding(12);
        BackColor = Background;
        ColumnCount = 1;
        ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var brand = new Label { Text = "SQUADLINK", ForeColor = Color.FromArgb(199, 248, 107),
            Font = new Font("Segoe UI", 14, FontStyle.Bold), Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
        AddRow(brand, 54);
        foreach (var (id, label) in new[] { ("lobby","Mi sala"), ("rooms","Explorar salas"), ("friends","Amigos"),
            ("arcade","Arcade"), ("player","Mi jugador"), ("settings","Ajustes") })
        {
            var button = MakeButton(label);
            button.Click += (_, _) => ActionRequested?.Invoke(id);
            pages[id] = button;
            AddRow(button, 40);
        }
        RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        RowCount++;
        AddRow(status, 36);
        AddRow(microphone, 38);
        AddRow(leave, 38);
        microphone.Click += (_, _) => ActionRequested?.Invoke("mic");
        leave.Click += (_, _) => ActionRequested?.Invoke("leave");
        ResetState();
    }

    private void AddRow(Control control, int height)
    {
        int row = RowStyles.Count;
        RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        RowCount = row + 1;
        Controls.Add(control, 0, row);
    }

    private static Button MakeButton(string caption)
    {
        var button = new Button { Text = caption, Dock = DockStyle.Fill, FlatStyle = FlatStyle.Flat,
            BackColor = Background, ForeColor = Color.WhiteSmoke, TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(8, 0, 2, 0), Margin = new Padding(0, 2, 0, 2), UseVisualStyleBackColor = false };
        button.FlatAppearance.BorderSize = 0;
        return button;
    }

    public void ResetState()
    {
        Joined = false;
        status.Text = "Sin sala";
        microphone.Text = "Activar micrófono";
        leave.Enabled = microphone.Enabled = false;
        foreach (var item in pages) item.Value.BackColor = item.Key == "lobby" ? Selected : Background;
    }

    public void UpdateState(JsonElement state)
    {
        bool Flag(string key) => state.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.True;
        string Value(string key) => state.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() ?? "" : "";
        foreach (var item in pages) item.Value.BackColor = item.Key == Value("section") ? Selected : Background;
        Joined = Flag("joined");
        status.Text = Joined ? Value("name") : "Sin sala";
        microphone.Text = Flag("mic") ? "Silenciar micrófono" : "Activar micrófono";
        microphone.Enabled = Joined && Flag("canMic");
        leave.Enabled = Joined && Flag("canLeave");
    }
}
