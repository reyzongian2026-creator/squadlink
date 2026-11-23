using System.Net.Http;
using System.Net.Http.Json;

internal sealed class RoomDirectory : UserControl
{
    private sealed record Room(string Code, string Name, string Description, string Level, string Game, bool Locked, int Count, int Capacity);
    private sealed record Page(Room[] Rooms, int? NextOffset);
    private readonly HttpClient http = new(new HttpClientHandler {AllowAutoRedirect = false}) { Timeout = TimeSpan.FromSeconds(12) };
    private readonly TextBox search = new() {PlaceholderText = "Buscar por sala, juego o nivel", Dock = DockStyle.Fill,
        Font = new Font("Segoe UI", 11), AccessibleName = "Buscar salas"};
    private readonly ListView list = new() {View = View.Details, FullRowSelect = true, MultiSelect = false,
        Dock = DockStyle.Fill, HeaderStyle = ColumnHeaderStyle.Nonclickable, BorderStyle = BorderStyle.None,
        BackColor = DesktopNavigation.Canvas, ForeColor = Color.WhiteSmoke, Font = new Font("Segoe UI", 10), HideSelection = false,
        AccessibleName = "Salas públicas", ShowItemToolTips = true, OwnerDraw = true};
    private readonly Label status = DesktopNavigation.Caption("", 10, FontStyle.Regular);
    private readonly Button more = DesktopNavigation.ActionButton("Cargar más"), enter = DesktopNavigation.ActionButton("Entrar a la sala");
    private readonly Button create = DesktopNavigation.ActionButton("Crear sala"), join = DesktopNavigation.ActionButton("Unirme con código");
    private readonly ImageList rowHeight = new() {ImageSize = new Size(1,36)};
    private readonly List<Room> rooms = new();
    private int? next;
    private readonly Button refresh = DesktopNavigation.ActionButton("Actualizar");
    private readonly SolidBrush surfaceBrush = new(DesktopNavigation.Surface), activeBrush = new(DesktopNavigation.Active),
        canvasBrush = new(DesktopNavigation.Canvas), accentBrush = new(DesktopNavigation.Accent);
    private CancellationTokenSource? request;
    private Task pending = Task.CompletedTask;
    private Uri? listOrigin;
    private bool appending, rebuilding;
    private string? error;
    private bool joined;
    private readonly Func<Uri?> getServer;
    public event Action<string,string?>? Open;
    public RoomDirectory(Func<Uri?> getServer)
    {
        this.getServer = getServer;
        Dock = DockStyle.Fill; BackColor = DesktopNavigation.Canvas; Padding = new Padding(25,15,25,12);
        var layout = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 6};
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        foreach (var size in new[] {54,55,43}) layout.RowStyles.Add(new RowStyle(SizeType.Absolute,size));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent,100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,36)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,46));
        layout.Controls.Add(DesktopNavigation.Caption("Explorar salas", 21, FontStyle.Bold),0,0);
        var actions = new FlowLayoutPanel {Dock=DockStyle.Fill, WrapContents=false};
        void Put(FlowLayoutPanel parent, Button b, int width) { b.Size = new Size(width,35); b.Dock = DockStyle.None; b.Margin = new Padding(0,3,8,3); parent.Controls.Add(b); }
        create.BackColor = DesktopNavigation.Accent; create.ForeColor = Color.FromArgb(25,31,20);
        create.FlatAppearance.MouseOverBackColor = Color.FromArgb(212,252,149);
        create.FlatAppearance.MouseDownBackColor = Color.FromArgb(164,218,83);
        Put(actions,create,115); Put(actions,join,158);
        layout.Controls.Add(actions,0,1);
        var query = new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=2};
        query.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); query.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,104));
        query.Controls.Add(search,0,0); query.Controls.Add(refresh,1,0);
        layout.Controls.Add(query,0,2);
        search.BackColor = DesktopNavigation.Surface; search.ForeColor = Color.WhiteSmoke; search.BorderStyle = BorderStyle.FixedSingle;
        list.SmallImageList = rowHeight;
        list.Columns.Add("Sala"); list.Columns.Add("Juego"); list.Columns.Add("Nivel"); list.Columns.Add("Cupos");
        list.DrawColumnHeader += (_, e) => {
            e.Graphics.FillRectangle(surfaceBrush,e.Bounds);
            TextRenderer.DrawText(e.Graphics,e.Header?.Text,list.Font,Rectangle.Inflate(e.Bounds,-LogicalToDeviceUnits(6),0),DesktopNavigation.Muted,TextFormatFlags.VerticalCenter|TextFormatFlags.Left);
        };
        list.DrawItem += (_, e) => e.DrawDefault = false;
        list.DrawSubItem += (_, e) => {
            var rect = e.Bounds;
            bool selected = e.Item?.Selected == true;
            e.Graphics.FillRectangle(selected ? activeBrush : canvasBrush,rect);
            if (selected && e.ColumnIndex == 0)
                e.Graphics.FillRectangle(accentBrush,rect.X,rect.Y,LogicalToDeviceUnits(list.Focused ? 4 : 2),rect.Height);
            rect.Inflate(-LogicalToDeviceUnits(6),0);
            TextRenderer.DrawText(e.Graphics,e.SubItem?.Text,list.Font,rect,Color.WhiteSmoke,TextFormatFlags.VerticalCenter|TextFormatFlags.EndEllipsis|TextFormatFlags.SingleLine|TextFormatFlags.NoPrefix);
        };
        list.GotFocus += (_,_)=>list.Invalidate(); list.LostFocus += (_,_)=>list.Invalidate();
        HandleCreated += (_,_)=>UpdateRowHeight();
        DpiChangedAfterParent += (_,_)=>UpdateRowHeight();
        list.Resize += (_,_) => { int w=Math.Max(200,list.ClientSize.Width-5); list.Columns[0].Width=w*38/100;list.Columns[1].Width=w*24/100;list.Columns[2].Width=w*23/100;list.Columns[3].Width=w*15/100; };
        layout.Controls.Add(list,0,3); status.ForeColor=DesktopNavigation.Muted;layout.Controls.Add(status,0,4);
        var bottom = new FlowLayoutPanel {Dock=DockStyle.Fill, WrapContents=false}; Put(bottom,enter,148);Put(bottom,more,120);layout.Controls.Add(bottom,0,5);
        Controls.Add(layout);
        create.Click += (_,_)=>Open?.Invoke("create",null); join.Click += (_,_)=>Open?.Invoke("join",null);
        enter.Click += (_,_)=>JoinSelected(); list.ItemActivate += (_,_)=>JoinSelected();
        list.SelectedIndexChanged += (_,_)=>UpdateSelection(); search.TextChanged += (_,_)=>DrawRooms();
        refresh.Click += async (_,_)=>await Reload(); more.Click += async (_,_)=>await Reload(true);
        search.KeyDown += (_,e) => {
            if(e.KeyCode != Keys.Down || list.Items.Count == 0) return;
            list.Focus();
            var item = list.SelectedItems.Count == 0 ? list.Items[0] : list.SelectedItems[0];
            item.Selected = true; item.Focused = true; item.EnsureVisible(); e.SuppressKeyPress = true;
        };
        SetJoined(false); UpdateSelection();
    }
    private void UpdateRowHeight()
    {
        var height = new Size(1, Math.Clamp(LogicalToDeviceUnits(36), 1, 256));
        if (rowHeight.ImageSize != height) rowHeight.ImageSize = height;
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == (Keys.Control | Keys.F)) { search.Focus(); search.SelectAll(); return true; }
        if (keyData == Keys.F5) { _ = Reload(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    private Room? Selected => list.SelectedItems.Count == 0 ? null : list.SelectedItems[0].Tag as Room;
    private void JoinSelected() { if (enter.Enabled && Selected is Room room) Open?.Invoke("join", room.Code); }
    public void SetJoined(bool value)
    {
        joined = value;
        create.Enabled = join.Enabled = !value;
        UpdateSelection();
    }

    private void UpdateSelection()
    {
        if (rebuilding) return;
        var selected = Selected;
        enter.Enabled = !joined && selected != null && selected.Count < selected.Capacity;
        more.Visible = next.HasValue;
        more.Enabled = refresh.Enabled = request == null;
        status.Text = request != null ? "Buscando salas…" : error ??
            (selected != null && !string.IsNullOrWhiteSpace(selected.Description) ? selected.Description :
            list.Items.Count == 0 ? (search.Text.Trim().Length == 0 ? "Aún no hay salas públicas." : "Sin coincidencias.") :
            list.Items.Count == 1 ? "1 sala" : $"{list.Items.Count} salas");
    }

    private void DrawRooms()
    {
        var selectedCode = Selected?.Code;
        var query = search.Text.Trim();
        bool Matches(string? text) => text?.Contains(query, StringComparison.CurrentCultureIgnoreCase) == true;
        ListViewItem? previous = null;
        rebuilding = true;
        list.BeginUpdate();
        try {
            list.Items.Clear();
            foreach (var room in rooms) {
                if (query.Length != 0 && !Matches(room.Name) && !Matches(room.Game) && !Matches(room.Level) && !Matches(room.Description)) continue;
                var item = new ListViewItem(new[] {room.Name+(room.Locked?" · Con clave":""),room.Game,room.Level,$"{room.Count}/{room.Capacity}"}) {
                    Tag = room, ToolTipText = room.Description
                };
                list.Items.Add(item);
                if (room.Code == selectedCode) previous = item;
            }
        } finally {
            list.EndUpdate();
            if (previous != null) { previous.Selected = true; previous.Focused = true; }
            rebuilding = false;
        }
        UpdateSelection();
    }

    public Task Reload(bool append = false)
    {
        if (IsDisposed || Disposing) return Task.CompletedTask;
        var origin = getServer();
        if (request != null && origin == listOrigin && (append || !appending)) return pending;
        request?.Cancel();
        request = null;
        if (origin != listOrigin) {
            listOrigin = origin; rooms.Clear(); next = null; error = null; DrawRooms();
        }
        if (origin == null) {
            error = "Configura el servidor para ver las salas."; UpdateSelection(); return Task.CompletedTask;
        }
        if (append && !next.HasValue) return Task.CompletedTask;
        var current = new CancellationTokenSource();
        request = current; appending = append; error = null; UpdateSelection();
        pending = ReadPage(origin, append ? next!.Value : 0, append, current);
        return pending;
    }

    private async Task ReadPage(Uri origin, int offset, bool append, CancellationTokenSource current)
    {
        try {
            var page = await http.GetFromJsonAsync<Page>(new Uri(origin, "/api/directory?offset=" + offset), current.Token);
            if (current != request) return;
            if (page?.Rooms == null) throw new System.Text.Json.JsonException();
            var seen = append ? rooms.Select(room => room.Code).ToHashSet() : new HashSet<string>();
            var incoming = page.Rooms.Where(room => room != null && !string.IsNullOrWhiteSpace(room.Code) && seen.Add(room.Code)).ToList();
            next = page.NextOffset;
            if (append ? incoming.Count > 0 : !rooms.SequenceEqual(incoming)) {
                if (!append) rooms.Clear();
                rooms.AddRange(incoming);
                DrawRooms();
            }
        } catch (Exception e) when (e is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException) {
            if (current == request) error = "No se pudo cargar el directorio. Pulsa Actualizar para reintentar.";
        } finally {
            if (current == request) { request = null; UpdateSelection(); }
            current.Dispose();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) {
            var current = request; request = null; current?.Cancel();
            http.Dispose(); rowHeight.Dispose();
            surfaceBrush.Dispose(); activeBrush.Dispose(); canvasBrush.Dispose(); accentBrush.Dispose();
        }
        base.Dispose(disposing);
    }
}
