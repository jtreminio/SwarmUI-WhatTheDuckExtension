using FreneticUtilities.FreneticToolkit;
using Newtonsoft.Json.Linq;
using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using SwarmUI.WebAPI;
using System.IO;
using System.Net.Http;

namespace WhatTheDuck;

[API.APIClass("Persistent local Civitai version matching.")]
public static class CivitaiIndexApi
{
    /// <summary>The running background service; null before startup or if persistence could not be loaded.</summary>
    private static volatile CivitaiIdentityIndex index;
    /// <summary>Worker cancellation also follows server shutdown.</summary>
    private static CancellationTokenSource shutdown;
    /// <summary>Worker lifetime, observed during shutdown.</summary>
    private static Task worker;
    /// <summary>Coalesces refresh events without taking locks in their callbacks.</summary>
    private static readonly CivitaiRefreshSignal Refresh = new();

    public static void Start()
    {
        CivitaiModelRefreshHook.Register(RequestRefresh);
        shutdown = CancellationTokenSource.CreateLinkedTokenSource(Program.GlobalProgramCancel);
        Program.ModelRefreshEvent += RequestRefresh;
        Program.ModelPathsChangedEvent += RequestRefresh;
        worker = Task.Run(() => RunAsync(shutdown.Token));
    }

    public static void Stop()
    {
        CivitaiModelRefreshHook.Unregister();
        Program.ModelRefreshEvent -= RequestRefresh;
        Program.ModelPathsChangedEvent -= RequestRefresh;
        shutdown?.Cancel();
        // Cancellation interrupts HTTP and delay waits. Do not hold the host shutdown thread indefinitely.
        worker?.Wait(TimeSpan.FromSeconds(2));
    }

    public static void RequestRefresh() => Refresh.Request();

    /// <summary>Copies only local registrations under the host lock. File IO happens after releasing it.</summary>
    public static CivitaiLocalFile[] Inventory()
    {
        List<CivitaiLocalFile> files = [];
        using (ManyReadOneWriteLock.ReadClaim claim = Program.RefreshLock.LockRead())
        {
            foreach (string subtype in new[] { "Stable-Diffusion", "LoRA" })
            {
                if (!Program.T2IModelSets.TryGetValue(subtype, out T2IModelHandler handler))
                {
                    continue;
                }
                foreach (T2IModel model in handler.Models.Values)
                {
                    if (!string.IsNullOrWhiteSpace(model.RawFilePath))
                    {
                        files.Add(new(subtype, model.Name, Path.GetFullPath(model.RawFilePath),
                            model.Metadata?.Hash, model.Metadata?.Description ?? model.Description, CivitaiModelRefreshHook.CachedFileVersion(model)));
                    }
                    lock (model.OtherPaths)
                    {
                        foreach (string path in model.OtherPaths)
                        {
                            files.Add(new(subtype, model.Name, Path.GetFullPath(path)));
                        }
                    }
                }
            }
        }
        return files.ToArray();
    }

    private static async Task RunAsync(CancellationToken cancellation)
    {
        try
        {
            index = new(Path.Combine(Program.DataDir, "WhatTheDuck", "CivitaiIdentityIndex.json"));
            using HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false })
            {
                Timeout = TimeSpan.FromSeconds(20), MaxResponseContentBufferSize = 16 * 1024 * 1024
            };
            CivitaiIdentityResolver resolver = new(client);
            bool resolveEnabled = !string.Equals(Environment.GetEnvironmentVariable("SWARM_WTD_CIVITAI_RESOLVE"), "false", StringComparison.OrdinalIgnoreCase);
            long nextRequestAt = 0;
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    await Refresh.ReconcileAsync(() => index.ReconcileAsync(Inventory(), cancellation));
                    long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    if (resolveEnabled && now >= nextRequestAt && now >= index.NextResolutionAt)
                    {
                        await index.ResolveNextAsync(resolver, now, cancellation);
                        nextRequestAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 1000;
                    }
                    long due = resolveEnabled ? Math.Max(nextRequestAt, index.NextResolutionAt) : long.MaxValue;
                    await Refresh.WaitAsync(due == long.MaxValue ? long.MaxValue : Math.Max(0, due - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()), cancellation);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // No exception messages: upstream libraries can include URLs or local metadata in them.
                    Logs.Warning($"WhatTheDuck: Civitai index work failed ({ex.GetType().Name}); retrying in one minute.");
                    await Task.Delay(TimeSpan.FromMinutes(1), cancellation);
                }
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception ex)
        {
            index = null;
            Logs.Warning($"WhatTheDuck: Civitai index unavailable ({ex.GetType().Name}). Existing index file was preserved.");
        }
    }

    public static bool TryParseItems(JObject raw, out CivitaiMatchItem[] items)
    {
        items = [];
        if (raw?["items"] is not JArray array || array.Count > 500)
        {
            return false;
        }
        List<CivitaiMatchItem> parsed = [];
        foreach (JToken token in array)
        {
            if (token is not JObject item || item["modelId"]?.Type != JTokenType.Integer || item["modelVersionId"]?.Type != JTokenType.Integer
                || !long.TryParse(item["modelId"].ToString(), out long model) || !long.TryParse(item["modelVersionId"].ToString(), out long version)
                || model <= 0 || version <= 0 || model > 9007199254740991 || version > 9007199254740991)
            {
                return false;
            }
            string type = CivitaiIdentityMetadata.Text(item["modelType"]);
            if (type is not ("Checkpoint" or "LoRA" or "LORA" or "LoCon" or "LoCON" or "DoRA"))
            {
                return false;
            }
            long? publication = null;
            if (item["publishedAt"] is JToken date && date.Type != JTokenType.Null)
            {
                if (date.Type != JTokenType.Integer || !long.TryParse(date.ToString(), out long value) || value < 0 || value > 253402300799999)
                {
                    return false;
                }
                publication = value;
            }
            parsed.Add(new(model, version, type == "Checkpoint" ? "Stable-Diffusion" : "LoRA", publication));
        }
        items = parsed.ToArray();
        return true;
    }

    [API.APIDescription("Matches up to 500 displayed Civitai versions against accessible local files. Performs no HTTP requests or hashing. Publication times are Unix milliseconds; omitted/null means unknown.",
        "\"schemaVersion\": 1, \"indexRevision\": \"opaque or null\", \"indexState\": \"ready|partial|unavailable\", \"coverage\": {\"localFiles\": 1, \"identifiedFiles\": 1, \"unresolvedFiles\": 0}, \"results\": [{\"modelId\": 1, \"modelVersionId\": 2, \"status\": \"downloaded|older|different|unknown\", \"ownedVersionIds\": [2], \"reason\": \"exact_version\"}]")]
    public static Task<JObject> WhatTheDuckMatchCivitaiVersions(Session session,
        [API.APIParameter("Body containing items (0-500 objects): positive integer modelId/modelVersionId, modelType Checkpoint/LoRA/LORA/LoCon/LoCON/DoRA, and optional publishedAt (Unix milliseconds or null). IDs must be JavaScript-safe integers. No observations are persisted.")] JObject raw)
    {
        if (!TryParseItems(raw, out CivitaiMatchItem[] items))
        {
            return Task.FromResult(new JObject { ["error"] = "Invalid items. Supply at most 500 valid Civitai version observations.", ["error_id"] = "invalid_civitai_batch" });
        }
        CivitaiIdentityIndex current = index;
        if (current is null)
        {
            return Task.FromResult(new JObject
            {
                ["schemaVersion"] = 1, ["indexRevision"] = null, ["indexState"] = "unavailable", ["coverage"] = null,
                ["results"] = new JArray(items.Select(item => new JObject
                {
                    ["modelId"] = item.ModelId, ["modelVersionId"] = item.VersionId, ["status"] = "unknown",
                    ["ownedVersionIds"] = new JArray(), ["reason"] = "index_unavailable"
                }))
            });
        }
        return Task.FromResult(current.Match(items, Inventory(), session.User.IsAllowedModel));
    }
}
