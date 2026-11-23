internal sealed class FeatureWindow : Form
{
    public Panel Content { get; } = new() { Dock=DockStyle.Fill, BackColor=DesktopNavigation.Canvas };
    private readonly Func<Keys,IntPtr,bool> shortcut;
    public FeatureWindow(string title, Action home, Func<Keys,IntPtr,bool> shortcut)
    {
        this.shortcut=shortcut;
        Text=title+" · Squadlink"; AutoScaleMode=AutoScaleMode.Dpi; StartPosition=FormStartPosition.CenterScreen;
        MinimumSize=new Size(600,460); ClientSize=new Size(805,570);
        var back=new Button {Text="Inicio",AutoSize=true,Anchor=AnchorStyles.Right};
        back.Click+=(_,_)=>home();
        var footer=new FlowLayoutPanel {Dock=DockStyle.Bottom,AutoSize=true,Padding=new Padding(6,2,8,2),
            FlowDirection=FlowDirection.RightToLeft,BackColor=SystemColors.Control};
        footer.Controls.Add(back); Controls.Add(Content); Controls.Add(footer);
    }
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        => (Control.FromHandle(msg.HWnd) is not (TextBoxBase or ComboBox) && shortcut(keyData,msg.LParam)) || base.ProcessCmdKey(ref msg,keyData);
}
