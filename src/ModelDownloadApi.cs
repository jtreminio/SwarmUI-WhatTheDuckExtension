using FreneticUtilities.FreneticExtensions;
using FreneticUtilities.FreneticToolkit;
using Newtonsoft.Json.Linq;
using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using SwarmUI.WebAPI;
using System.IO;
using System.Net.WebSockets;

namespace WhatTheDuck;

/// <summary>Checkpoint downloads with an explicit base folder. Keeps the core downloader's
/// authentication, progress, cancellation, metadata and refresh behavior without mutating
/// the shared model handler's DownloadFolderPath during concurrent downloads.</summary>
public static class ModelDownloadApi
{
    /// <summary>Match SwarmUI's configured download root selection, including custom checkpoint paths.</summary>
    public static string ResolveBaseFolder(string baseFolder, string checkpointPath, string modelRoots, int downloadRootId)
    {
        if (baseFolder == "Stable-Diffusion")
        {
            return checkpointPath;
        }
        if (baseFolder != "diffusion_models")
        {
            throw new ArgumentException("Invalid checkpoint base folder.", nameof(baseFolder));
        }
        string[] roots = [.. modelRoots.Split(';').Where(p => !string.IsNullOrWhiteSpace(p))];
        if (roots.Length == 0)
        {
            roots = ["Models"];
        }
        int index = (int)(Math.Abs((long)downloadRootId) % roots.Length);
        return Utilities.CombinePathWithAbsolute(Environment.CurrentDirectory, roots[index].Trim(), "diffusion_models");
    }

    public static async Task<JObject> WhatTheDuckDownloadModelWS(Session session, WebSocket ws,
        string url,
        string type,
        string name, string baseFolder,
        string metadata = null)
    {
        if (type != "Stable-Diffusion" || (baseFolder != "Stable-Diffusion" && baseFolder != "diffusion_models"))
        {
            await ws.SendJson(new JObject() { ["error"] = "Invalid checkpoint base folder or model type." }, API.WebsocketTimeout);
            return null;
        }
        if (!Uri.TryCreate(url, UriKind.Absolute, out Uri source) || (source.Scheme != "http" && source.Scheme != "https"))
        {
            await ws.SendJson(new JObject() { ["error"] = "Invalid URL." }, API.WebsocketTimeout);
            return null;
        }
        // Preserve core GGUF behavior even for requests from an older frontend bundle.
        if (source.AbsolutePath.EndsWith(".gguf", StringComparison.OrdinalIgnoreCase)
            || source.Fragment.Equals("#.gguf", StringComparison.OrdinalIgnoreCase))
        {
            return await ModelsAPI.DoModelDownloadWS(session, ws, url, type, name, metadata);
        }
        name = Utilities.StrictFilenameClean(name.Replace(' ', '_'));
        if (ModelsAPI.TryGetRefusalForModel(session, name, out JObject refusal))
        {
            await ws.SendJson(refusal, API.WebsocketTimeout);
            return null;
        }
        if (!Program.T2IModelSets.TryGetValue(type, out T2IModelHandler handler))
        {
            await ws.SendJson(new JObject() { ["error"] = "Invalid type." }, API.WebsocketTimeout);
            return null;
        }
        string folder = ResolveBaseFolder(baseFolder, handler.DownloadFolderPath,
            Program.ServerSettings.Paths.ModelRoot, Program.ServerSettings.Paths.DownloadToRootID);
        string originalUrl = url;
        url = url.Before('#');
        var authenticated = ModelDownloadAuth.Prepare(url, provider => session.User.GetGenericData(provider, "key"));
        string tempPath = null;
        try
        {
            string outPath = $"{folder}/{name}.safetensors";
            if (File.Exists(outPath))
            {
                await ws.SendJson(new JObject() { ["error"] = "Model at that save path already exists." }, API.WebsocketTimeout);
                return null;
            }
            tempPath = $"{folder}/{name}.{Guid.NewGuid():N}.download.tmp";
            Directory.CreateDirectory(Path.GetDirectoryName(outPath));
            Logs.Debug($"Will download model to '{Path.GetFullPath(outPath)}'");
            using CancellationTokenSource canceller = new();
            Task downloading = Utilities.DownloadFile(authenticated.Url, tempPath, (progress, total, perSec) =>
            {
                ws.SendJson(new JObject()
                {
                    ["current_percent"] = total > 0 ? progress / (double)total : 0,
                    ["overall_percent"] = 0.2,
                    ["per_second"] = perSec
                }, API.WebsocketTimeout).Wait();
            }, canceller, originalUrl, headers: authenticated.Headers);
            Task listenForSignal = Utilities.RunCheckedTask(async () =>
            {
                while (true)
                {
                    while (ws.State == WebSocketState.Connecting)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(0.1), Program.GlobalProgramCancel);
                    }
                    if (ws.State != WebSocketState.Open || ws.CloseStatus.HasValue || downloading.IsCompleted)
                    {
                        break;
                    }
                    JObject data = await ws.ReceiveJson(1024 * 1024, true);
                    if (data is null)
                    {
                        continue;
                    }
                    Logs.Verbose($"Model download websocket inbound: {data}");
                    if (data.TryGetValue("signal", out JToken signal))
                    {
                        string cmd = $"{signal}".ToLowerFast();
                        if (cmd == "cancel")
                        {
                            canceller.Cancel();
                        }
                    }
                }
            });
            await downloading;
            File.Move(tempPath, outPath);
            if (!string.IsNullOrWhiteSpace(metadata))
            {
                File.WriteAllText($"{folder}/{name}.swarm.json", metadata);
            }
            using (ManyReadOneWriteLock.WriteClaim claim = Program.RefreshLock.LockWrite())
            {
                handler.Refresh();
            }
            if (Program.ServerSettings.Paths.DownloaderAlwaysResave)
            {
                if (handler.Models.Values.FirstOrDefault(m => Path.GetFullPath(m.RawFilePath) == Path.GetFullPath(outPath)) is T2IModel model)
                {
                    model.ResaveModel();
                }
                else
                {
                    Logs.Warning($"Could not resave model '{name}.safetensors' as it has not shown up in the backing handler. Something may have gone wrong.");
                }
            }
            await ws.SendJson(new JObject() { ["success"] = true }, API.WebsocketTimeout);
        }
        catch (SwarmReadableErrorException userErr)
        {
            Logs.Warning($"Failed to download the model due to: {userErr.Message}");
            await ws.SendJson(new JObject() { ["error"] = userErr.Message }, API.WebsocketTimeout);
            return null;
        }
        catch (TaskCanceledException)
        {
            Logs.Info("Download was cancelled.");
            await ws.SendJson(new JObject() { ["error"] = "Download was cancelled." }, API.WebsocketTimeout);
            return null;
        }
        catch (Exception ex)
        {
            Logs.Warning($"Failed to download the model due to internal exception: {ex.ReadableString()}");
            await ws.SendJson(new JObject() { ["error"] = "Failed to download the model due to internal exception." }, API.WebsocketTimeout);
        }
        finally
        {
            if (tempPath is not null)
            {
                try { File.Delete(tempPath); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        return null;
    }

}
