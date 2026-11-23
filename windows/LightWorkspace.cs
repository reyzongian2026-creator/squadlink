using System.Text.Json;

internal sealed class LightWorkspace : UserControl
{
    private readonly Label title = DesktopNavigation.Caption("",19,FontStyle.Bold);
    private readonly Label summary = DesktopNavigation.Caption("",10,FontStyle.Regular);
    private readonly ListBox list = new() {Dock = DockStyle.Fill, BackColor = DesktopNavigation.Canvas,
        ForeColor = Color.WhiteSmoke, BorderStyle = BorderStyle.None, Font = new Font("Segoe UI",11), IntegralHeight = false};
    private readonly Button detail = DesktopNavigation.ActionButton("");
    private int requests;
    private bool friends = true, identified, hasMoreContacts, displayedFriends;
    private string name = "", code = "", voiceStatus = "";
    private string[] contacts = [], members = [], displayedRows = [];
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
    public void ResetSnapshot() { name = code = voiceStatus = ""; identified = hasMoreContacts = false; requests = 0; contacts = []; members = []; Render(); }
    public void ShowPage(bool social) { friends = social; Render(); }
    public void UpdateSnapshot(JsonElement state)
    {
        string Text(string key) => state.GetProperty(key).GetString() ?? "";
        requests = state.GetProperty("requests").GetInt32();
        name = Text("name"); code = Text("code"); voiceStatus = Text("voiceStatus");
        identified = state.GetProperty("identified").GetBoolean();
        contacts = ReadRows(state.GetProperty("contacts"), contacts);
        members = ReadRows(state.GetProperty("members"), members);
        hasMoreContacts = state.TryGetProperty("hasMoreContacts", out var more) ? more.GetBoolean() : contacts.Length == 25;
        if (Visible) Render();
    }
    private static string[] ReadRows(JsonElement items, string[] current)
    {
        if (items.GetArrayLength() == current.Length)
        {
            int index = 0;
            foreach (var item in items.EnumerateArray())
            {
                string row = current[index];
                if (item.ValueKind == JsonValueKind.Null ? row.Length != 0 : !item.ValueEquals(row)) break;
                index++;
            }
            if (index == current.Length) return current;
        }
        return items.EnumerateArray().Select(item => item.GetString() ?? "").ToArray();
    }

    private static string RowName(string row)
    {
        int end = row.IndexOf(" · ", StringComparison.Ordinal);
        return end < 0 ? row : row[..end];
    }

    private static int FindSelection(string[] before, string[] after, int index)
    {
        if ((uint)index >= (uint)before.Length) return -1;
        string selected = before[index];
        if (index < after.Length && after[index] == selected) return index;
        int exact = Array.IndexOf(after, selected);
        if (exact >= 0) return exact;

        string name = RowName(selected);
        if (before.Count(row => RowName(row) == name) != 1) return -1;
        int match = Array.FindIndex(after, row => RowName(row) == name);
        if (match < 0) return -1;
        return Array.FindIndex(after, match + 1, row => RowName(row) == name) < 0 ? match : -1;
    }

    private void Render()
    {
        title.Text = friends ? "Amigos" : name;
        summary.Text = friends ? !identified ? "Elige tu apodo para agregar amigos." : contacts.Length == 0
            ? "Tu lista de amigos está vacía." : hasMoreContacts ? "Primeros 25 contactos · Abre Gestionar para ver todos." : "Actividad de tus contactos"
            : "Código de sala: " + code + (requests > 0 ? $" · {requests} solicitudes para entrar" : "") + (voiceStatus.Length > 0 ? " · " + voiceStatus : "");
        detail.Text = friends ? identified ? "Gestionar amigos y solicitudes" : "Elegir mi apodo" : "Abrir controles de sala";
        list.AccessibleName = friends ? "Contactos" : "Participantes";
        var rows = friends ? contacts : members;
        bool samePage = friends == displayedFriends;
        if (samePage && ReferenceEquals(rows, displayedRows)) return;
        int selected = samePage ? FindSelection(displayedRows, rows, list.SelectedIndex) : -1;
        int top = samePage && list.IsHandleCreated ? list.TopIndex : 0;
        list.BeginUpdate();
        try
        {
            int common = Math.Min(displayedRows.Length, rows.Length);
            for (int i = 0; i < common; i++)
                if (displayedRows[i] != rows[i]) list.Items[i] = rows[i];
            for (int i = displayedRows.Length - 1; i >= rows.Length; i--) list.Items.RemoveAt(i);
            for (int i = common; i < rows.Length; i++) list.Items.Add(rows[i]);
            if (list.SelectedIndex != selected) list.SelectedIndex = selected;
            if (rows.Length > 0 && list.IsHandleCreated) list.TopIndex = Math.Clamp(top, 0, rows.Length - 1);
            displayedRows = rows;
            displayedFriends = friends;
        }
        finally { list.EndUpdate(); }
    }
}
