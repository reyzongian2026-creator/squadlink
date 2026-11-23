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
        AccessibleName = "Salas públicas", OwnerDraw = true};
    private readonly Label status = DesktopNavigation.Caption("", 10, FontStyle.Regular);
    private readonly Button more = DesktopNavigation.ActionButton("Cargar más"), enter = DesktopNavigation.ActionButton("Entrar a la sala");
    private readonly Button create = DesktopNavigation.ActionButton("Crear sala"), join = DesktopNavigation.ActionButton("Unirme con código");
    private readonly List<Room> rooms = new();
    private int? next;
    private int revision;
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
        Put(actions,create,115); Put(actions,join,158);
        layout.Controls.Add(actions,0,1);
        var query = new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=2};
        query.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); query.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,104));
        var refresh = DesktopNavigation.ActionButton("Actualizar"); query.Controls.Add(search,0,0); query.Controls.Add(refresh,1,0);
        layout.Controls.Add(query,0,2);
        list.Columns.Add("Sala"); list.Columns.Add("Juego"); list.Columns.Add("Nivel"); list.Columns.Add("Cupos");
        list.DrawColumnHeader += (_, e) => {
            using var fill = new SolidBrush(DesktopNavigation.Surface); e.Graphics.FillRectangle(fill,e.Bounds);
            TextRenderer.DrawText(e.Graphics,e.Header?.Text,list.Font,e.Bounds,DesktopNavigation.Muted,TextFormatFlags.VerticalCenter|TextFormatFlags.Left);
        };
        list.DrawItem += (_, e) => e.DrawDefault = false;
        list.DrawSubItem += (_, e) => {
            var rect = e.Bounds;
            using var fill = new SolidBrush(e.Item?.Selected == true ? DesktopNavigation.Active : DesktopNavigation.Canvas);
            e.Graphics.FillRectangle(fill,rect); rect.Inflate(-3,0);
            TextRenderer.DrawText(e.Graphics,e.SubItem?.Text,list.Font,rect,Color.WhiteSmoke,TextFormatFlags.VerticalCenter|TextFormatFlags.EndEllipsis|TextFormatFlags.SingleLine|TextFormatFlags.NoPrefix);
        };
        list.Resize += (_,_) => { int w=Math.Max(200,list.ClientSize.Width-5); list.Columns[0].Width=w*38/100;list.Columns[1].Width=w*24/100;list.Columns[2].Width=w*23/100;list.Columns[3].Width=w*15/100; };
        layout.Controls.Add(list,0,3); status.ForeColor=DesktopNavigation.Muted;layout.Controls.Add(status,0,4);
        var bottom = new FlowLayoutPanel {Dock=DockStyle.Fill}; Put(bottom,enter,148);Put(bottom,more,120);layout.Controls.Add(bottom,0,5);
        Controls.Add(layout);
        create.Click += (_,_)=>Open?.Invoke("create",null); join.Click += (_,_)=>Open?.Invoke("join",null);
        enter.Click += (_,_)=>JoinSelected(); list.ItemActivate += (_,_)=>JoinSelected();
        list.SelectedIndexChanged += (_,_)=>UpdateSelection(); search.TextChanged += (_,_)=>DrawRooms();
        refresh.Click += async (_,_)=>await Reload(); more.Click += async (_,_)=>await Reload(true);
        SetJoined(false);more.Visible=false;
    }
    private Room? Selected => list.SelectedItems.Count == 0 ? null : list.SelectedItems[0].Tag as Room;
    private void JoinSelected() { if(enter.Enabled && Selected is Room r) Open?.Invoke("join",r.Code); }
    private void UpdateSelection() { var r=Selected;enter.Enabled=!joined && r != null && r.Count<r.Capacity; if(r != null) status.Text=r.Description; }
    public void SetJoined(bool value) { joined=value;create.Enabled=join.Enabled=!value;UpdateSelection(); }
    private void DrawRooms()
    {
        list.BeginUpdate();list.Items.Clear();
        foreach(var r in rooms.Where(r=>string.Join(" ",r.Name,r.Game,r.Level,r.Description).Contains(search.Text.Trim(),StringComparison.CurrentCultureIgnoreCase)))
            list.Items.Add(new ListViewItem(new[]{r.Name+(r.Locked?" · Con clave":""),r.Game,r.Level,$"{r.Count}/{r.Capacity}"}){Tag=r});
        list.EndUpdate();UpdateSelection();
        status.Text=list.Items.Count>0 ? $"{list.Items.Count} salas" : search.Text.Length>0 ? "Sin coincidencias." : "Aún no hay salas públicas.";
    }
    public async Task Reload(bool append=false)
    {
        var origin=getServer(); if(origin == null)return;
        var version=++revision;
        if(!append) {rooms.Clear(); next=null; DrawRooms();}
        more.Enabled=false; more.Visible=append; status.Text="Buscando salas…";
        try {
            var page=await http.GetFromJsonAsync<Page>(new Uri(origin,"/api/directory?offset="+(append?next??0:0)));
            if(version!=revision || IsDisposed || page==null)return;
            var seen=rooms.Select(r=>r.Code).ToHashSet();rooms.AddRange(page.Rooms.Where(r=>seen.Add(r.Code)));
            next=page.NextOffset;DrawRooms();more.Visible=next.HasValue;
        } catch(Exception e) when(e is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException) {
            if(version==revision && !IsDisposed)status.Text="No se pudo cargar el directorio. Pulsa Actualizar para reintentar.";
        } finally {if(version==revision && !IsDisposed)more.Enabled=true;}
    }
    protected override void Dispose(bool disposing){ if(disposing){revision++;http.Dispose();}base.Dispose(disposing);}
}
