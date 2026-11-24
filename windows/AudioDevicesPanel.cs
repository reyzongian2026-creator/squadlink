using System.Text.Json;

internal sealed class AudioDevicesPanel : UserControl
{
    private sealed record Device(string Id, string Label) { public override string ToString()=>Label; }
    private readonly ComboBox input=Select("Micrófono"), output=Select("Salida de audio");
    private readonly CheckBox noise=new() {Text="Reducir ruido de fondo",AutoSize=true}, gain=new() {Text="Ganancia automática del micrófono",AutoSize=true};
    private readonly TrackBar volume=new() {AccessibleName="Volumen de las voces que escucho",Minimum=0,Maximum=200,TickFrequency=25,Dock=DockStyle.Fill};
    private readonly TrackBar micGain=new() {AccessibleName="Ganancia del micrófono en decibelios", Minimum=0, Maximum=18, TickFrequency=3, LargeChange=3, Dock=DockStyle.Fill};
    private readonly Button test=new() {Text="Grabar prueba de 4 segundos",AutoSize=true}, refresh=new() {Text="Actualizar dispositivos",AutoSize=true};
    private readonly Label filters=new() {AutoSize=true}, status=new() {AutoSize=true}, testStatus=new() {AutoSize=true};
    private readonly Button speakerTest=new() {Text="Probar altavoz",AutoSize=true,Visible=false};
    private readonly Label speakerStatus=new() {AutoSize=true};
    public event Action<string,object?>? Change;
    public AudioDevicesPanel()
    {
        Dock=DockStyle.Fill; Font=new Font("Segoe UI",10); BackColor=SystemColors.Window; Padding=new Padding(20);
        var grid=new TableLayoutPanel {Dock=DockStyle.Top,AutoSize=true,ColumnCount=2};
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        void Row(string? label,Control control) {
            int row=grid.RowCount++; grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            int column=0;
            if(label!=null) { grid.Controls.Add(new Label {Text=label,AutoSize=true,Anchor=AnchorStyles.Left},0,row); column=1; }
            control.Margin=new Padding(3,5,3,5);
            grid.Controls.Add(control,column,row); if(column==0) grid.SetColumnSpan(control,2);
        }
        grid.RowCount=0; Row(null,new Label{Text="Ajustes de voz",AutoSize=true,Font=new Font("Segoe UI",16,FontStyle.Bold)});
        Row("Micrófono",input);
        Row("Ganancia del micrófono",ShowLevel(micGain, value => value==0 ? "0 dB" : $"+{value} dB"));
        Row("Salida de audio",output); Row("Volumen de las voces",ShowLevel(volume, value => $"{value} %"));
        Row(null,noise); Row(null,gain); Row(null,filters);
        var actions=new FlowLayoutPanel {AutoSize=true}; actions.Controls.Add(test); actions.Controls.Add(speakerTest); actions.Controls.Add(refresh);
        Row(null,actions); Row(null,testStatus); Row(null,speakerStatus); Row(null,status); Controls.Add(grid);
        input.SelectionChangeCommitted+=(_,_)=>Change?.Invoke("input",((Device?)input.SelectedItem)?.Id);
        output.SelectionChangeCommitted+=(_,_)=>Change?.Invoke("output",((Device?)output.SelectedItem)?.Id);
        micGain.MouseUp+=(_,_)=>Change?.Invoke("micGainDb",micGain.Value);
        micGain.KeyUp+=(_,_)=>Change?.Invoke("micGainDb",micGain.Value);
        volume.MouseUp+=(_,_)=>Change?.Invoke("volume",volume.Value); volume.KeyUp+=(_,_)=>Change?.Invoke("volume",volume.Value);
        noise.Click+=(_,_)=>Change?.Invoke("noise",noise.Checked); gain.Click+=(_,_)=>Change?.Invoke("gain",gain.Checked);
        speakerTest.Click+=(_,_)=>Change?.Invoke("speakerTest",null);
        test.Click+=(_,_)=>Change?.Invoke("test",null); refresh.Click+=(_,_)=>Change?.Invoke("refresh",null);
        Enabled=false;
    }
    private static Control ShowLevel(TrackBar slider, Func<int,string> format)
    {
        var row = new TableLayoutPanel {Dock=DockStyle.Fill, AutoSize=true, ColumnCount=2, RowCount=1};
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var value = new Label {Text=format(slider.Value), AutoSize=true, Anchor=AnchorStyles.Left};
        slider.ValueChanged+=(_,_)=>value.Text=format(slider.Value);
        row.Controls.Add(slider,0,0); row.Controls.Add(value,1,0);
        return row;
    }
    private static ComboBox Select(string name)=>new() {AccessibleName=name,DropDownStyle=ComboBoxStyle.DropDownList,Dock=DockStyle.Fill};
    public void Apply(JsonElement msg)
    {
        void SetDevices(ComboBox box, string key) {
            var item=msg.GetProperty(key);
            var choices=item.GetProperty("options").EnumerateArray().Select(d=>new Device(d[0].GetString()??"",d[1].GetString()??"")).ToArray();
            if (!box.Items.Cast<Device>().SequenceEqual(choices)) {
                box.BeginUpdate(); try {box.Items.Clear(); box.Items.AddRange(choices);} finally {box.EndUpdate();}
            }
            box.SelectedIndex=Array.FindIndex(choices,d=>d.Id==item.GetProperty("value").GetString());
            box.Enabled=item.GetProperty("enabled").GetBoolean();
        }
        Enabled=true; SetDevices(input,"input"); SetDevices(output,"output");
        foreach(var (key,check) in new[]{("noise",noise),("gain",gain)}) {
            var item=msg.GetProperty(key); check.Checked=item.GetProperty("checked").GetBoolean(); check.Enabled=item.GetProperty("enabled").GetBoolean();
        }
        volume.Value=Math.Clamp(msg.GetProperty("volume").GetInt32(),0,200); volume.Enabled=msg.GetProperty("canVolume").GetBoolean();
        if (msg.TryGetProperty("micGainDb",out var boost) && boost.TryGetInt32(out var db)) {
            micGain.Value=Math.Clamp(db,micGain.Minimum,micGain.Maximum);
            micGain.Enabled=msg.TryGetProperty("canMicGain",out var enabled) && enabled.ValueKind==JsonValueKind.True;
        } else {
            micGain.Value=0;
            micGain.Enabled=false;
        }
        test.Text=msg.GetProperty("test").GetString(); test.Visible=msg.GetProperty("showTest").GetBoolean(); test.Enabled=msg.GetProperty("canTest").GetBoolean();
        speakerTest.Visible=test.Visible && msg.TryGetProperty("speakerTest",out _);
        if (speakerTest.Visible && msg.TryGetProperty("speakerTest",out var label)) speakerTest.Text=label.GetString();
        speakerTest.Enabled=msg.TryGetProperty("canSpeakerTest",out var canPlay) && canPlay.ValueKind==JsonValueKind.True;
        speakerStatus.Text=msg.TryGetProperty("speakerStatus",out var soundStatus) ? soundStatus.GetString() : "";
        refresh.Enabled=msg.GetProperty("canRefresh").GetBoolean(); filters.Text=msg.GetProperty("filters").GetString();
        status.Text=msg.GetProperty("status").GetString(); testStatus.Text=msg.GetProperty("testStatus").GetString();
    }
}
