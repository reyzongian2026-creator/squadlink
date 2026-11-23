using System.Net;
using System.Text.Json;

object Run(int n,int attempt=1,string branch=PreviewUpdates.Branch,string conclusion="success",string repo=PreviewUpdates.Repository) =>
    new {run_number=n,run_attempt=attempt,id=n,head_branch=branch,head_repository=new{full_name=repo},conclusion,@event="push"};
object Asset(int id,string name="Squadlink-Windows-x64",bool expired=false,int days=10) =>
    new {id,name,expired,size_in_bytes=50,expires_at=DateTimeOffset.UtcNow.AddDays(days)};
async Task<(PreviewArtifact? Artifact,bool Unavailable)> Check(BuildStamp local,object[] runs,params object[][] assets){
    var replies = new Queue<string>(); replies.Enqueue(JsonSerializer.Serialize(new {workflow_runs=runs}));
    foreach(var group in assets) replies.Enqueue(JsonSerializer.Serialize(new {artifacts=group}));
    using var client = new HttpClient(new Fixture(replies));
    var result = await new PreviewUpdates(client).Check(local,CancellationToken.None);
    if(replies.Count!=0) throw new Exception("Consultas esperadas sin ejecutar");
    return result;
}
void Require(bool pass,string name){if(!pass)throw new Exception(name);Console.WriteLine(name);}
var current=new BuildStamp(10,2);
Require(await Check(current,[Run(10,2),Run(9)])==(null,false),"No ofrece la misma compilación ni una anterior");
var missingSource = new {head_branch=PreviewUpdates.Branch, conclusion="success", @event="push", head_repository=(object?)null};
var newer=await Check(current,[missingSource,Run(15,branch:"main"),Run(14,repo:"otro/proyecto"),Run(13,conclusion:"failure"),Run(11),Run(10,2)],
    [Asset(60,"Captura-del-escritorio"),Asset(61,expired:true),Asset(62),Asset(63)]);
Require(newer.Artifact?.Url.AbsoluteUri=="https://github.com/reyzongian2026-creator/squadlink/actions/runs/11/artifacts/63","Selecciona el instalador válido más reciente del canal");
Require((await Check(current,[Run(10,3)],[Asset(99)])).Artifact?.Build==new BuildStamp(10,3),"Reconoce una recompilación de la misma versión");
Require(await Check(current,[Run(12),Run(11),Run(10,2)],[Asset(101,days:-1)],[])==(null,true),"Distingue artefactos caducados o ausentes");
Require((await Check(current,[Run(12),Run(11)],[],[Asset(70)])).Artifact?.Id==70,"Recupera el siguiente instalador válido");
var verified = newer.Artifact ?? throw new Exception("Falta el instalador verificado.");
Require(verified.IsAvailableAt(verified.ExpiresAt.AddTicks(-1)), "El último enlace verificado conserva su vigencia antes del vencimiento");
Require(!verified.IsAvailableAt(verified.ExpiresAt), "Un enlace que vence mientras la ventana sigue abierta deja de ser descargable");
Require(!verified.IsAvailableAt(verified.ExpiresAt.AddMinutes(1)), "Un reintento posterior a la caducidad descarta el artefacto anterior");
using var failed=new HttpClient(new Fixture(new Queue<string>(),HttpStatusCode.Forbidden));
try {await new PreviewUpdates(failed).Check(current,CancellationToken.None);throw new Exception("No detectó el error del servicio");}
catch(HttpRequestException){Console.WriteLine("Los errores de red no se confunden con tener la última versión");}
sealed class Fixture(Queue<string> responses,HttpStatusCode status=HttpStatusCode.OK):HttpMessageHandler{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req,CancellationToken token){
        if(req.RequestUri?.Host!="api.github.com" || req.Headers.UserAgent.Count==0)throw new Exception("Petición inesperada");
        return Task.FromResult(new HttpResponseMessage(status){Content=new StringContent(status==HttpStatusCode.OK?responses.Dequeue():"")});
    }
}
