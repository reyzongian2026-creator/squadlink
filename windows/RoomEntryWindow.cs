using System.Text.RegularExpressions;

internal sealed class RoomEntryWindow : Form
{
    private readonly TextBox nick = Box("Tu apodo",24), name = Box("Nombre de la sala",48),
        code = Box("Código de sala",6), password = Box("Clave opcional",64), game = Box("Juego",64),
        level = Box("Nivel",32), description = Box("Descripción",160), matchCode = Box("Código del juego",64);
    private readonly CheckBox publish = new() { Text="Mostrar sala en el directorio", AutoSize=true };
    private readonly Label status = new() { Dock=DockStyle.Fill, AutoEllipsis=true, TextAlign=ContentAlignment.MiddleLeft };
    private readonly Button submit = new() { AutoSize=true };
    public bool Creating { get; }
    public bool Busy { get; private set; }
    public event Action<object>? Submitted;
    private static TextBox Box(string label, int length) => new() { AccessibleName=label, Dock=DockStyle.Fill, MaxLength=length };

    public RoomEntryWindow(bool creating, string? preset, string rememberedNick)
    {
        Creating=creating; Text=creating ? "Crear sala" : "Unirme con código";
        StartPosition=FormStartPosition.CenterParent; FormBorderStyle=FormBorderStyle.FixedDialog;
        MaximizeBox=false; MinimizeBox=false; ShowInTaskbar=false; AutoScaleMode=AutoScaleMode.Dpi;
        Font=new Font("Segoe UI",10); BackColor=SystemColors.Window; ForeColor=SystemColors.WindowText;
        nick.Text=rememberedNick; code.Text=preset ?? ""; code.CharacterCasing=CharacterCasing.Upper;
        password.UseSystemPasswordChar=true;
        var grid=new TableLayoutPanel { Dock=DockStyle.Fill,ColumnCount=2,Padding=new Padding(16),RowCount=0 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        void Field(string label, Control field) {
            int row=grid.RowCount++; grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            grid.Controls.Add(new Label {Text=label,AutoSize=true, Anchor=AnchorStyles.Left, Margin=new Padding(0,6,14,6)},0,row);
            field.Margin=new Padding(0,3,0,3); grid.Controls.Add(field,1,row);
        }
        Field("Tu apodo",nick);
        if (creating) Field("Nombre de la sala",name); else Field("Código de sala",code);
        Field("Clave opcional",password);
        if (creating) {
            Field("Juego",game); Field("Nivel",level); Field("Descripción",description);
            Field("Código del juego",matchCode); Field("Visibilidad",publish);
        }
        nick.PlaceholderText="Usar mi apodo guardado";
        int messageRow=grid.RowCount++; grid.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        grid.Controls.Add(status,0,messageRow); grid.SetColumnSpan(status,2);
        var actions=new FlowLayoutPanel {AutoSize=true,Dock=DockStyle.Fill,FlowDirection=FlowDirection.RightToLeft};
        submit.Text=Text; var cancel=new Button {Text="Cancelar", AutoSize=true}; cancel.Click+=(_,_)=>Close();
        actions.Controls.Add(submit); actions.Controls.Add(cancel);
        int last=grid.RowCount++; grid.RowStyles.Add(new RowStyle(SizeType.AutoSize)); grid.Controls.Add(actions,0,last); grid.SetColumnSpan(actions,2);
        AcceptButton=submit; CancelButton=cancel; Controls.Add(grid);
        ClientSize=new Size(510,creating?400:252);
        submit.Click+=(_,_)=>{
            if (Busy) return;
            if (!creating && !Regex.IsMatch(code.Text.Trim(),"^[A-Z0-9]{6}$")) { Error("Ingresa el código de seis caracteres."); code.Focus(); return; }
            Busy=true; submit.Enabled=cancel.Enabled=false; status.Text="Conectando…";
            Submitted?.Invoke(new {creating, nick=nick.Text.Trim(), name=name.Text.Trim(), code=code.Text.Trim(), password=password.Text,
                directory=new {published=publish.Checked,game=game.Text.Trim(),level=level.Text.Trim(),description=description.Text.Trim(),gameCode=matchCode.Text.Trim()}});
        };
        FormClosing+=(_,e)=>{if(Busy && e.CloseReason==CloseReason.UserClosing) e.Cancel=true;};
        void EnableCancel(object? _, EventArgs __) => cancel.Enabled=submit.Enabled;
        submit.EnabledChanged+=EnableCancel;
    }
    public void SetCode(string value) { code.Text=value; }
    public void Error(string message) { Busy=false; submit.Enabled=true; status.Text=message; }
    public void Complete() { Busy=false; Close(); }
}
