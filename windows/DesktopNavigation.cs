using System.Text.Json;

internal sealed class DesktopNavigation : UserControl
{
    internal static readonly Color Rail = Color.FromArgb(22,23,31), Surface = Color.FromArgb(31,32,43),
        Canvas = Color.FromArgb(37,38,49), Active = Color.FromArgb(65,65,85),
        Accent = Color.FromArgb(190,242,106), Muted = Color.FromArgb(185,185,201);
    private readonly Label voiceName = Caption("Sin sala", 11, FontStyle.Bold);
    private readonly Button mic = ActionButton("Activar micrófono"), leave = ActionButton("Salir de sala");
    private readonly Button create = ActionButton("Crear sala"), join = ActionButton("Unirme con código");
    public bool Joined { get; private set; }
    public event Action<string>? ActionRequested;

    public DesktopNavigation()
    {
        Dock = DockStyle.Fill;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Canvas, Padding = new Padding(24,16,24,16), ColumnCount = 1, RowCount = 5 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,44));
        for (int i = 0; i < 3; i++) layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f/3));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,47));
        layout.Controls.Add(Caption("Squadlink", 21, FontStyle.Bold), 0, 0);
        Button Option(string name, string action, Button? existing = null) {
            var button = existing ?? ActionButton(name);
            button.Padding = new Padding(11,0,4,0); button.Margin = new Padding(3);
            button.Click += (_,_) => ActionRequested?.Invoke(action); return button;
        }
        void Group(int row, string title, params Button[] buttons) {
            var group = new GroupBox {Text=title, Dock=DockStyle.Fill, ForeColor=Muted, Padding=new Padding(8,5,8,9), Margin=new Padding(0,3,0,5),
                Font=new Font("Segoe UI",10,FontStyle.Bold)};
            var grid = new TableLayoutPanel {Dock=DockStyle.Fill, RowCount=1, ColumnCount=buttons.Length};
            grid.RowStyles.Add(new RowStyle(SizeType.Percent,100));
            for(int i=0;i<buttons.Length;i++) { grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100f/buttons.Length)); grid.Controls.Add(buttons[i],i,0); }
            group.Controls.Add(grid); layout.Controls.Add(group,0,row);
        }
        create.BackColor = Accent; create.ForeColor = Color.FromArgb(24,31,18);
        create.FlatAppearance.MouseOverBackColor = Color.FromArgb(212,252,149);
        Group(1,"Salas",Option("Crear sala","create",create),Option("Unirme con código","join",join),Option("Explorar salas","rooms"),Option("Mi sala","lobby"));
        Group(2,"Jugadores",Option("Amigos","friends"),Option("Mi jugador","player"),Option("Minijuegos","arcade"),Option("Clasificación","ranking"));
        Group(3,"Ajustes",Option("Dispositivos","settings"),Option("Rendimiento","performance"),Option("Servidor","server"),Option("Actualizaciones","updates"));
        var call = new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=3,RowCount=1};
        call.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); call.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,175)); call.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,145));
        call.Controls.Add(voiceName,0,0); call.Controls.Add(Option("","mic",mic),1,0); call.Controls.Add(Option("","leave",leave),2,0);
        mic.AccessibleDescription="Activar o silenciar con Ctrl+Mayús+M.";
        layout.Controls.Add(call,0,4); Controls.Add(layout); ResetState();
    }
    public static Button ActionButton(string text)
    {
        var button = new Button {Text = text, AutoEllipsis = true, Dock = DockStyle.Fill, Padding = new Padding(9,0,5,0),
            FlatStyle = FlatStyle.Flat, BackColor = Surface, ForeColor = Color.WhiteSmoke, UseVisualStyleBackColor = false,
            TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0,2,0,2), Font = new Font("Segoe UI", 10)};
        button.FlatAppearance.BorderSize = 0; button.FlatAppearance.MouseOverBackColor = Active;
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(82, 82, 103);
        return button;
    }
    public static Label Caption(string text, float size, FontStyle style) => new() {
        Text = text, AutoEllipsis = true, UseMnemonic = false, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.WhiteSmoke,
        Font = new Font("Segoe UI", size, style), Dock = DockStyle.Fill, Margin = Padding.Empty };
    internal bool TryMicrophoneShortcut(Keys keyData, IntPtr keyFlags)
    {
        if (keyData != (Keys.Control | Keys.Shift | Keys.M) || !Joined || !mic.Enabled || !mic.Visible)
            return false;
        // Windows sets bit 30 for repeats after the initial key-down.
        if ((keyFlags.ToInt64() & (1L << 30)) == 0)
            mic.PerformClick();
        return true;
    }

    public void ResetState()
    {
        Joined = false; create.Enabled = join.Enabled = true; voiceName.Text = "Sin sala"; mic.Text = "Activar micrófono"; mic.Enabled = leave.Enabled = false;
    }
    public void UpdateState(JsonElement state)
    {
        bool Flag(string key) => state.TryGetProperty(key, out var f) && f.ValueKind == JsonValueKind.True;
        Joined = Flag("joined"); create.Enabled = join.Enabled = !Joined;
        voiceName.Text = Joined ? state.GetProperty("name").GetString() : "Sin sala";
        mic.Text = Flag("mic") ? "Silenciar micrófono" : "Activar micrófono";
        mic.Enabled = Joined && Flag("canMic"); leave.Enabled = Joined && Flag("canLeave");
    }
}
