using System.Net;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using Newtonsoft.Json.Linq;
using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using WhatTheDuck;
using Xunit;

public class ModelDownloadTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"wtd-download-test-{Guid.NewGuid():N}");
    private readonly HttpClient originalClient = Utilities.UtilWebClient;
    private readonly string originalRoots = Program.ServerSettings.Paths.ModelRoot;
    private readonly int originalRootId = Program.ServerSettings.Paths.DownloadToRootID;
    private readonly bool originalResave = Program.ServerSettings.Paths.DownloaderAlwaysResave;
    private readonly T2IModelHandler originalHandler = Program.T2IModelSets.GetValueOrDefault("Stable-Diffusion");
    private readonly Session session;
    private readonly StubHttp http = new();

    public ModelDownloadTests()
    {
        // Only model permission checks are needed; no account database is opened.
        User user = (User)RuntimeHelpers.GetUninitializedObject(typeof(User));
        user.CalculatedRole = new Role("test");
        session = new Session { User = user };
        Program.ServerSettings.Paths.ModelRoot = $"{root}/first;{root}/second";
        Program.ServerSettings.Paths.DownloadToRootID = 1;
        Program.ServerSettings.Paths.DownloaderAlwaysResave = false;
        Program.T2IModelSets["Stable-Diffusion"] = new T2IModelHandler
        {
            DownloadFolderPath = Path.Combine(root, "custom-checkpoints"),
            // These tests exercise downloading, not SwarmUI's metadata database.
            IsShutdown = true
        };
        Utilities.UtilWebClient = new HttpClient(http);
    }

    [Theory]
    [InlineData("Stable-Diffusion", "model.safetensors", "safetensors")]
    [InlineData("diffusion_models", "model.safetensors", "safetensors")]
    public async Task DownloadsIntoSelectedBaseWithSubfolderAndMetadata(string baseFolder, string remoteName, string extension)
    {
        var socket = new RecordingSocket();
        await ModelDownloadApi.WhatTheDuckDownloadModelWS(session, socket, $"https://example.com/{remoteName}",
            "Stable-Diffusion", "flux/model", baseFolder, "{\"title\":\"test\"}");
        string folder = baseFolder == "Stable-Diffusion" ? Path.Combine(root, "custom-checkpoints") : Path.Combine(root, "second", "diffusion_models");
        Assert.True(socket.Messages.Any(m => m.Value<bool?>("success") == true), string.Join("; ", socket.Messages));
        Assert.Equal(StubHttp.Bytes, File.ReadAllBytes(Path.Combine(folder, "flux", $"model.{extension}")));
        Assert.Equal("{\"title\":\"test\"}", File.ReadAllText(Path.Combine(folder, "flux", "model.swarm.json")));
        Assert.Empty(Directory.GetFiles(root, "*.tmp", SearchOption.AllDirectories));
        Assert.Equal(Path.Combine(root, "custom-checkpoints"), Program.T2IModelSets["Stable-Diffusion"].DownloadFolderPath);
    }

    [Theory]
    [InlineData("https://example.com/model.gguf")]
    [InlineData("https://example.com/model.GGUF?download=true")]
    [InlineData("https://example.com/api/download/models/123#.gguf")]
    public async Task GgufRequestsUseExactlyTheCoreDestinationRules(string url)
    {
        var coreSocket = new RecordingSocket();
        await SwarmUI.WebAPI.ModelsAPI.DoModelDownloadWS(session, coreSocket, url, "Stable-Diffusion", "core-model");
        Assert.Contains(coreSocket.Messages, m => m.Value<bool?>("success") == true);
        string corePath = Assert.Single(Directory.GetFiles(root, "core-model.*", SearchOption.AllDirectories));

        var socket = new RecordingSocket();
        await ModelDownloadApi.WhatTheDuckDownloadModelWS(session, socket, url, "Stable-Diffusion", "extension-model", "diffusion_models");
        Assert.Contains(socket.Messages, m => m.Value<bool?>("success") == true);
        string extensionPath = Assert.Single(Directory.GetFiles(root, "extension-model.*", SearchOption.AllDirectories));
        Assert.Equal(corePath.Replace("core-model", "extension-model"), extensionPath);
        Assert.Equal(File.ReadAllBytes(corePath), File.ReadAllBytes(extensionPath));
    }

    [Fact]
    public async Task ExistingFileIsNotOverwritten()
    {
        string target = Path.Combine(root, "second", "diffusion_models", "model.safetensors");
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        File.WriteAllText(target, "original");
        var socket = new RecordingSocket();
        await ModelDownloadApi.WhatTheDuckDownloadModelWS(session, socket, "https://example.com/model.safetensors", "Stable-Diffusion", "model", "diffusion_models");
        Assert.Contains(socket.Messages, m => m.Value<string>("error") == "Model at that save path already exists.");
        Assert.Equal("original", File.ReadAllText(target));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData("../elsewhere", "Stable-Diffusion")]
    [InlineData("diffusion_models", "LoRA")]
    public async Task RejectsInvalidDestinationsBeforeDownloading(string baseFolder, string type)
    {
        var socket = new RecordingSocket();
        await ModelDownloadApi.WhatTheDuckDownloadModelWS(session, socket, "https://example.com/model.safetensors", type, "model", baseFolder);
        Assert.Contains(socket.Messages, m => m["error"] != null);
        Assert.Equal(0, http.Calls);
        Assert.False(Directory.Exists(root));
    }

    [Fact]
    public async Task FailedDownloadRemovesTemporaryFile()
    {
        http.Status = HttpStatusCode.NotFound;
        var socket = new RecordingSocket();
        await ModelDownloadApi.WhatTheDuckDownloadModelWS(session, socket, "https://example.com/model.safetensors", "Stable-Diffusion", "model", "diffusion_models");
        Assert.Contains(socket.Messages, m => m["error"] != null);
        Assert.Empty(Directory.GetFiles(root, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public void RootSelectionMatchesConfiguredDownloadRoot()
    {
        Assert.Equal(Path.Combine(root, "second", "diffusion_models"), ModelDownloadApi.ResolveBaseFolder("diffusion_models", "/unused", $";{root}/first;;{root}/second;", -3));
        Assert.Equal("/custom/checkpoints", ModelDownloadApi.ResolveBaseFolder("Stable-Diffusion", "/custom/checkpoints", "/unused", 0));
        Assert.Throws<ArgumentException>(() => ModelDownloadApi.ResolveBaseFolder("other", "/unused", root, 0));
    }

    [Theory]
    [InlineData(null, "Stable-Diffusion")]
    [InlineData("other", "Stable-Diffusion")]
    [InlineData("Stable-Diffusion", "Stable-Diffusion")]
    [InlineData("diffusion_models", "diffusion_models")]
    public void ServerSettingsPreserveValidBaseAndMigrateOldRows(string value, string expected)
    {
        var sanitize = typeof(WhatTheDuckExtension).GetMethod("SanitizeArchMappings", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        JArray input = [new JObject { ["architectures"] = new JArray("flux-1"), ["checkpointFolder"] = "flux", ["baseFolder"] = value }];
        JArray result = (JArray)sanitize.Invoke(null, [input]);
        Assert.Equal(expected, result[0].Value<string>("baseFolder"));
    }

    public void Dispose()
    {
        Utilities.UtilWebClient.Dispose();
        Utilities.UtilWebClient = originalClient;
        Program.ServerSettings.Paths.ModelRoot = originalRoots;
        Program.ServerSettings.Paths.DownloadToRootID = originalRootId;
        Program.ServerSettings.Paths.DownloaderAlwaysResave = originalResave;
        if (originalHandler is null) Program.T2IModelSets.Remove("Stable-Diffusion");
        else Program.T2IModelSets["Stable-Diffusion"] = originalHandler;
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    private class StubHttp : HttpMessageHandler
    {
        public static readonly byte[] Bytes = Encoding.UTF8.GetBytes("test model payload");
        public HttpStatusCode Status = HttpStatusCode.OK;
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(Status) { Content = new ByteArrayContent(Bytes), RequestMessage = request });
        }
    }

    private class RecordingSocket : WebSocket
    {
        public List<JObject> Messages = [];
        public override WebSocketCloseStatus? CloseStatus => null;
        public override string CloseStatusDescription => null;
        // Skip the background cancellation reader for these completed in-memory transfers.
        public override WebSocketState State => WebSocketState.Closed;
        public override string SubProtocol => null;
        public override void Abort() { }
        public override Task CloseAsync(WebSocketCloseStatus status, string description, CancellationToken token) => Task.CompletedTask;
        public override Task CloseOutputAsync(WebSocketCloseStatus status, string description, CancellationToken token) => Task.CompletedTask;
        public override void Dispose() { }
        public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken token) => throw new NotSupportedException();
        public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage, CancellationToken token)
        {
            Messages.Add(JObject.Parse(Encoding.UTF8.GetString(buffer)));
            return Task.CompletedTask;
        }
    }
}
