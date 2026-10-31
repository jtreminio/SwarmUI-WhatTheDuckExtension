using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json.Linq;
using WhatTheDuck;
using Xunit;

public class CivitaiIdentityIndexTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "wtd-civitai-" + Guid.NewGuid().ToString("N"));
    private const long Now = 1800000000000;
    private string StorePath => Path.Combine(root, "index.json");

    private CivitaiLocalFile FileModel(string name, JObject metadata = null, string subtype = "Stable-Diffusion")
    {
        Directory.CreateDirectory(root);
        string path = Path.Combine(root, name);
        WriteModel(path, metadata ?? new());
        return new(subtype, name, path);
    }

    private static void WriteModel(string path, JObject metadata)
    {
        byte[] header = Encoding.UTF8.GetBytes(new JObject { ["__metadata__"] = metadata }.ToString());
        using FileStream stream = File.Create(path);
        stream.Write(BitConverter.GetBytes((long)header.Length));
        stream.Write(header);
        stream.Write(new byte[16]);
    }

    private static JObject Identity(long version = 10, long model = 1, string published = "2025-01-01T00:00:00Z") => new()
    {
        ["modelId"] = model, ["modelVersionId"] = version, ["publishedAt"] = published
    };

    private static CivitaiMatchItem Item(long version = 10, long model = 1, long? published = Now, string subtype = "Stable-Diffusion") => new(model, version, subtype, published);

    private static JObject Response(CivitaiIdentityIndex index, CivitaiLocalFile[] files, params CivitaiMatchItem[] items)
        => index.Match(items.Length == 0 ? [Item()] : items, files, _ => true);

    private static string Status(JObject response, int position = 0) => response["results"]![position]!.Value<string>("status")!;

    [Fact]
    public async Task PersistsIdentityAndReusesUnchangedFilesAcrossRestart()
    {
        CivitaiLocalFile file = FileModel("first.safetensors", Identity());
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        string saved = System.IO.File.ReadAllText(StorePath);
        CivitaiIdentityIndex reloaded = new(StorePath);
        await reloaded.ReconcileAsync([file]);
        Assert.Equal(saved, System.IO.File.ReadAllText(StorePath));
        Assert.Equal("downloaded", Status(Response(reloaded, [file])));
        Assert.Equal("ready", Response(reloaded, [file]).Value<string>("indexState"));
        Assert.Single(Directory.GetFiles(root, "index*"));
    }

    [Fact]
    public async Task RemovalIsRejectedBeforeScanAndRemovedFromPersistentStore()
    {
        CivitaiLocalFile file = FileModel("first.safetensors", Identity());
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        System.IO.File.Delete(file.Path);
        Assert.Equal("unknown", Status(Response(index, [file])));
        Assert.Equal("partial", Response(index, [file]).Value<string>("indexState"));
        await index.ReconcileAsync([file]); // A stale host registry must not preserve a deleted file.
        Assert.Empty(new CivitaiIdentityIndex(StorePath).Snapshot());
    }

    [Fact]
    public async Task RemovedRegistrationAndPermissionChangesImmediatelyHideOwnership()
    {
        CivitaiLocalFile file = FileModel("private.safetensors", Identity());
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        Assert.Equal("unknown", Status(Response(index, [])));
        JObject hidden = index.Match([Item()], [file], _ => false);
        Assert.Equal("unknown", Status(hidden));
        Assert.Empty((JArray)hidden["results"]![0]!["ownedVersionIds"]!);
        Assert.Equal(0, hidden["coverage"]!.Value<int>("localFiles"));
        await index.ReconcileAsync([]);
        Assert.Empty(new CivitaiIdentityIndex(StorePath).Snapshot());
    }

    [Fact]
    public async Task ReplacementAndSidecarEditsInvalidateOldIdentity()
    {
        CivitaiLocalFile file = FileModel("first.safetensors");
        string sidecar = Path.ChangeExtension(file.Path, ".swarm.json");
        System.IO.File.WriteAllText(sidecar, Identity().ToString());
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        Assert.Equal("downloaded", Status(Response(index, [file])));
        WriteModel(file.Path, new JObject { ["different"] = "replacement file" });
        Assert.Equal("unknown", Status(Response(index, [file])));
        await index.ReconcileAsync([file]);
        Assert.Null(Assert.Single(index.Snapshot()).VersionId); // The old sidecar must not attach to the replacement.
        index = new(StorePath);
        file = file with
        {
            CachedDescription = "From <a href=\"https://civitai.com/models/1?modelVersionId=10\">stale sidecar copied into host cache</a>",
            CachedFileVersion = new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file.Path)).ToUnixTimeMilliseconds()
        };
        await index.ReconcileAsync([file]);
        Assert.Null(Assert.Single(index.Snapshot()).VersionId);
        System.IO.File.WriteAllText(sidecar, Identity(100).ToString());
        await index.ReconcileAsync([file]);
        Assert.Equal("downloaded", Status(Response(index, [file], Item(100))));
        Assert.Equal("different", Status(Response(index, [file], Item(10, published: null))));
    }

    [Fact]
    public async Task EmbeddedReplacementDoesNotRetainPreviousVersion()
    {
        CivitaiLocalFile file = FileModel("first.safetensors", Identity());
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        WriteModel(file.Path, Identity(100));
        await index.ReconcileAsync([file]);
        Assert.Equal(100, Assert.Single(index.Snapshot()).VersionId);
    }

    [Fact]
    public async Task ExactVersionWinsAndOlderRequiresEveryOwnedVersionToBeEarlier()
    {
        CivitaiLocalFile old = FileModel("old.safetensors", Identity(100));
        CivitaiLocalFile newer = FileModel("new.safetensors", Identity(2, published: "2028-01-01T00:00:00Z"));
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([old]);
        Assert.Equal("older", Status(Response(index, [old], Item(3)))); // ID ordering is irrelevant.
        Assert.Equal("different", Status(Response(index, [old], Item(3, published: null))));
        await index.ReconcileAsync([old, newer]);
        Assert.Equal("different", Status(Response(index, [old, newer], Item(3))));
        Assert.Equal("downloaded", Status(Response(index, [old, newer], Item(100))));
        Assert.Equal("unknown", Status(Response(index, [old, newer], Item(100, subtype: "LoRA"))));
    }

    [Fact]
    public async Task MissingLocalDateAndUnknownFilesExposePartialCoverage()
    {
        CivitaiLocalFile old = FileModel("old.safetensors", Identity(published: null));
        CivitaiLocalFile unknown = FileModel("unknown.gguf");
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([old, unknown]);
        JObject response = Response(index, [old, unknown], Item(11));
        Assert.Equal("different", Status(response));
        Assert.Equal("partial", response.Value<string>("indexState"));
        Assert.Equal(1, response["coverage"]!.Value<int>("unresolvedFiles"));
        Assert.Equal("unknown", Status(Response(index, [old, unknown], Item(model: 999))));
    }

    [Theory]
    [InlineData("From <a href=\"https://civitai.red/models/3023619?modelVersionId=3433581\">source</a>", true)]
    [InlineData(" From <a href='https://civitai.com/models/3023619/name?foo=1&amp;modelVersionId=3433581'>source</a>", true)]
    [InlineData("Credits: From <a href=\"https://civitai.red/models/3023619?modelVersionId=3433581\">source</a>", false)]
    [InlineData("From <a href=\"https://civitai.red.attacker.test/models/3023619?modelVersionId=3433581\">source</a>", false)]
    [InlineData("From <a href=\"https://civitai.red/models/3023619?modelVersionId=1&modelVersionId=3433581\">source</a>", false)]
    public void OnlyLeadingTrustedSourceLinkProvesVersion(string source, bool expected)
    {
        (long Model, long Version)? parsed = CivitaiIdentityMetadata.ParseSource(source);
        Assert.Equal(expected, parsed.HasValue);
        if (expected)
        {
            Assert.Equal((3023619L, 3433581L), parsed!.Value);
        }
    }

    [Theory]
    [InlineData(".swarm.json", "modelId", "modelVersionId")]
    [InlineData(".cm-info.json", "ModelId", "VersionId")]
    [InlineData(".json", "modelId", "modelVersionId")]
    [InlineData(".civitai.info", "modelId", "id")]
    public void ReadsSupportedSidecarIdentitySchemas(string suffix, string modelKey, string versionKey)
    {
        CivitaiLocalFile file = FileModel("model.gguf");
        JObject metadata = new() { [modelKey] = 1, [versionKey] = 10, ["files"] = new JArray() };
        System.IO.File.WriteAllText(Path.ChangeExtension(file.Path, null) + suffix, metadata.ToString());
        CivitaiIdentity result = CivitaiIdentityMetadata.Read(file);
        Assert.Equal(1, result.ModelId);
        Assert.Equal(10, result.VersionId);
    }

    [Fact]
    public void StructuredIdentityWinsOverCreditLinkAndCreationDateIsNotPublication()
    {
        JObject metadata = Identity(published: null);
        metadata["modelspec.description"] = "From <a href=\"https://civitai.com/models/99?modelVersionId=123\">ingredient</a>";
        metadata["modelspec.date"] = "2025-01-01";
        metadata["createdAt"] = "2025-01-01T00:00:00Z";
        CivitaiIdentity result = CivitaiIdentityMetadata.Read(FileModel("model.safetensors", metadata));
        Assert.Equal(10, result.VersionId);
        Assert.Null(result.PublishedAt);
    }

    [Fact]
    public void ConflictingStructuredMetadataCannotProveOwnership()
    {
        CivitaiLocalFile file = FileModel("model.safetensors", Identity());
        System.IO.File.WriteAllText(Path.ChangeExtension(file.Path, ".swarm.json"), Identity(11).ToString());
        CivitaiIdentity result = CivitaiIdentityMetadata.Read(file);
        Assert.Null(result.VersionId);
        Assert.Equal("conflict", result.State);
        Assert.Null(result.LookupKey);
    }

    [Fact]
    public async Task CachedTensorHashUsesAutoV3AndNeverBecomesWholeFileHash()
    {
        CivitaiLocalFile file = FileModel("model.safetensors");
        file = file with
        {
            CachedTensorHash = "0x" + new string('a', 64),
            CachedFileVersion = new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file.Path)).ToUnixTimeMilliseconds()
        };
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        CivitaiIdentity entry = Assert.Single(index.Snapshot());
        Assert.Equal("AAAAAAAAAAAA", entry.Hashes["AutoV3"]);
        Assert.False(entry.Hashes.ContainsKey("SHA256"));
        FakeHttp handler = new(_ => Success());
        using HttpClient http = new(handler);
        await index.ResolveNextAsync(new(http), Now);
        Assert.Equal("/api/v1/model-versions/by-hash/AAAAAAAAAAAA", Assert.Single(handler.Uris).AbsolutePath);
        string stored = System.IO.File.ReadAllText(StorePath);
        CivitaiIdentityIndex reloaded = new(StorePath);
        await reloaded.ReconcileAsync([file]);
        Assert.Equal(stored, System.IO.File.ReadAllText(StorePath));
    }

    [Fact]
    public void StaleHostCacheAndPooledHashesDoNotProveIdentity()
    {
        CivitaiLocalFile file = FileModel("model.safetensors", new JObject { ["hashes"] = new JArray(new string('a', 64)) });
        file = file with { CachedTensorHash = new string('a', 64), CachedFileVersion = 1 };
        Assert.Empty(CivitaiIdentityMetadata.Read(file).Hashes);
    }

    [Fact]
    public async Task ResolutionDeduplicatesAndBrowsingAndRestartCauseNoNewRequests()
    {
        CivitaiLocalFile one = FileModel("one.safetensors", Identity(published: null));
        CivitaiLocalFile two = FileModel("two.safetensors", Identity(published: null), "LoRA");
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([one, two]);
        FakeHttp handler = new(_ => Success());
        using HttpClient http = new(handler);
        CivitaiIdentityResolver resolver = new(http);
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => index.ResolveNextAsync(resolver, Now)));
        Assert.Single(handler.Uris);
        for (int i = 0; i < 20; i++)
        {
            Assert.Equal("downloaded", Status(Response(index, [one, two])));
        }
        CivitaiIdentityIndex reloaded = new(StorePath);
        await reloaded.ReconcileAsync([one, two]);
        Assert.False(await reloaded.ResolveNextAsync(resolver, Now + 10000));
        Assert.Single(handler.Uris);
        Assert.All(reloaded.Snapshot(), e => Assert.Equal("resolved", e.State));
    }

    [Fact]
    public async Task NewCopyReusesAlreadyResolvedVersionWithoutHttp()
    {
        CivitaiLocalFile one = FileModel("one.safetensors", Identity());
        CivitaiLocalFile two = FileModel("two.safetensors", Identity(published: null));
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([one, two]);
        FakeHttp handler = new(_ => throw new Exception("HTTP must not run"));
        using HttpClient http = new(handler);
        await index.ResolveNextAsync(new(http), Now);
        Assert.Empty(handler.Uris);
        Assert.All(index.Snapshot(), e => Assert.Equal("resolved", e.State));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RateLimitPausesAllResolutionAndSurvivesRestart(bool useDate)
    {
        CivitaiLocalFile one = FileModel("one.safetensors", Identity(published: null));
        CivitaiLocalFile two = FileModel("two.safetensors", Identity(11, published: null));
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([one, two]);
        FakeHttp handler = new(_ => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
        {
            Headers = { RetryAfter = useDate ? new RetryConditionHeaderValue(DateTimeOffset.FromUnixTimeMilliseconds(Now).AddMinutes(5)) : new RetryConditionHeaderValue(TimeSpan.FromMinutes(5)) }
        });
        using HttpClient http = new(handler);
        CivitaiIdentityResolver resolver = new(http);
        Assert.True(await index.ResolveNextAsync(resolver, Now));
        CivitaiIdentityIndex reloaded = new(StorePath);
        await reloaded.ReconcileAsync([one, two]);
        Assert.False(await reloaded.ResolveNextAsync(resolver, Now + 299999));
        Assert.Single(handler.Uris);
        Assert.True(await reloaded.ResolveNextAsync(resolver, Now + 300000));
        Assert.Equal(2, handler.Uris.Count);
    }

    [Fact]
    public async Task MissingIdentityIsNegativeCachedAndTransientFailuresBackOff()
    {
        CivitaiLocalFile one = FileModel("one.safetensors", Identity(published: null));
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([one]);
        FakeHttp handler = new(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using HttpClient http = new(handler);
        await index.ResolveNextAsync(new(http), Now);
        CivitaiIdentity failed = Assert.Single(index.Snapshot());
        Assert.Equal("not_found", failed.State);
        Assert.Equal(Now + TimeSpan.FromDays(7).TotalMilliseconds, failed.RetryAt);
        Assert.False(await index.ResolveNextAsync(new(http), Now + 60000));
        Assert.Equal("downloaded", Status(Response(index, [one]))); // Reliable local source IDs remain useful.
        FakeHttp errors = new(_ => new HttpResponseMessage(HttpStatusCode.BadGateway));
        using HttpClient errorClient = new(errors);
        await index.ResolveNextAsync(new(errorClient), failed.RetryAt);
        Assert.Equal(failed.RetryAt + 120000, Assert.Single(index.Snapshot()).RetryAt);
    }

    [Fact]
    public async Task HashResolutionAssociatesOnlyMatchingFileAndNeverRewritesModels()
    {
        string tensor = new('a', 64);
        CivitaiLocalFile file = FileModel("model.safetensors", new JObject { ["modelspec.hash_sha256"] = "0x" + tensor });
        file = file with
        {
            CachedTensorHash = "0x" + tensor,
            CachedFileVersion = new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file.Path)).ToUnixTimeMilliseconds()
        };
        byte[] before = System.IO.File.ReadAllBytes(file.Path);
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        FakeHttp handler = new(_ => Success(new JArray(
            new JObject { ["id"] = 77, ["hashes"] = new JObject { ["AutoV3"] = tensor[..12], ["SHA256"] = new string('b', 64) } },
            new JObject { ["id"] = 88, ["hashes"] = new JObject { ["SHA256"] = new string('c', 64) } })));
        using HttpClient http = new(handler);
        await index.ResolveNextAsync(new(http), Now);
        CivitaiIdentity entry = Assert.Single(index.Snapshot());
        Assert.Equal(77, entry.FileId);
        Assert.False(entry.Hashes.ContainsKey("SHA256"));
        Assert.Equal(new string('A', 64), entry.Hashes["TensorSHA256"]);
        Assert.Equal(before, System.IO.File.ReadAllBytes(file.Path));
    }

    [Fact]
    public async Task HeaderAndSidecarHashesCannotTriggerRequestsWithoutSwarmCache()
    {
        JObject hashes = new()
        {
            ["modelspec.hash_sha256"] = new string('a', 64),
            ["hashes"] = new JObject { ["SHA256"] = new string('b', 64), ["AutoV3"] = new string('c', 12) }
        };
        CivitaiLocalFile file = FileModel("model.safetensors", hashes);
        System.IO.File.WriteAllText(Path.ChangeExtension(file.Path, ".cm-info.json"), hashes.ToString());
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        Assert.Empty(Assert.Single(index.Snapshot()).Hashes);
        FakeHttp handler = new(_ => throw new Exception("No Swarm hash means no hash lookup"));
        using HttpClient http = new(handler);
        Assert.False(await index.ResolveNextAsync(new(http), Now));
        Assert.Empty(handler.Uris);

        // A subsequently available Swarm hash is the only accepted hash, even with conflicting sidecars.
        file = file with
        {
            CachedTensorHash = new string('d', 64),
            CachedFileVersion = new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file.Path)).ToUnixTimeMilliseconds()
        };
        await index.ReconcileAsync([file]);
        Assert.Equal("hash/AutoV3/DDDDDDDDDDDD", Assert.Single(index.Snapshot()).LookupKey);
        Assert.False(Assert.Single(index.Snapshot()).Hashes.ContainsKey("SHA256"));
    }

    [Fact]
    public async Task PreviouslyPersistedHashesMustBeRevalidatedUnderSwarmOnlyPolicy()
    {
        CivitaiLocalFile file = FileModel("model.safetensors");
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        JObject saved = JObject.Parse(System.IO.File.ReadAllText(StorePath));
        JObject old = (JObject)saved["entries"]![0]!;
        old.Remove("HashPolicyVersion");
        old["Hashes"] = new JObject { ["SHA256"] = new string('a', 64), ["AutoV3"] = new string('b', 12) };
        old["ModelId"] = 1;
        old["VersionId"] = 10;
        old["State"] = "resolved";
        System.IO.File.WriteAllText(StorePath, saved.ToString());
        index = new(StorePath);
        Assert.Equal("unknown", Status(Response(index, [file])));
        FakeHttp handler = new(_ => throw new Exception("Old records cannot trigger lookup"));
        using HttpClient http = new(handler);
        Assert.False(await index.ResolveNextAsync(new(http), Now));
        await index.ReconcileAsync([file]);
        CivitaiIdentity current = Assert.Single(new CivitaiIdentityIndex(StorePath).Snapshot());
        Assert.Empty(current.Hashes);
        Assert.Null(current.VersionId);
        Assert.Equal(1, current.HashPolicyVersion);
        Assert.Empty(handler.Uris);
    }

    [Fact]
    public async Task ReplacementAcceptsFreshSwarmHashAcrossRepeatedRefreshes()
    {
        CivitaiLocalFile file = FileModel("model.safetensors");
        file = file with { CachedTensorHash = new string('a', 64), CachedFileVersion = new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file.Path)).ToUnixTimeMilliseconds() };
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        WriteModel(file.Path, new JObject { ["replacement"] = true });
        file = file with { CachedTensorHash = new string('b', 64), CachedFileVersion = new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file.Path)).ToUnixTimeMilliseconds() };
        await index.ReconcileAsync([file]);
        await index.ReconcileAsync([file]);
        Assert.Equal("hash/AutoV3/BBBBBBBBBBBB", Assert.Single(index.Snapshot()).LookupKey);
    }

    [Fact]
    public async Task PreviouslyDiscardedValidHashRecoversOnNextRefresh()
    {
        CivitaiLocalFile file = FileModel("model.safetensors");
        file = file with { CachedTensorHash = new string('b', 64), CachedFileVersion = new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file.Path)).ToUnixTimeMilliseconds() };
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        JObject saved = JObject.Parse(System.IO.File.ReadAllText(StorePath));
        saved["entries"]![0]!["Hashes"] = new JObject();
        saved["entries"]![0]!["State"] = "unresolved";
        System.IO.File.WriteAllText(StorePath, saved.ToString());
        index = new(StorePath);
        await index.ReconcileAsync([file]);
        Assert.Equal("hash/AutoV3/BBBBBBBBBBBB", Assert.Single(index.Snapshot()).LookupKey);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.BadGateway)]
    public async Task FailedFirstVersionDoesNotStarveNextVersion(HttpStatusCode failure)
    {
        CivitaiLocalFile one = FileModel("one.safetensors", Identity(10, published: null));
        CivitaiLocalFile two = FileModel("two.safetensors", Identity(11, published: null));
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([one, two]);
        FakeHttp handler = new(request => request.RequestUri!.AbsolutePath.EndsWith("/10") ? new(failure) : new(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"id\":11,\"modelId\":1,\"publishedAt\":\"2025-01-01T00:00:00Z\"}")
        });
        using HttpClient http = new(handler);
        CivitaiIdentityResolver resolver = new(http);
        await index.ResolveNextAsync(resolver, Now);
        long next = Math.Max(Now, index.NextResolutionAt);
        if (failure == HttpStatusCode.Forbidden)
        {
            Assert.Equal(Now, next); // Resource-specific failure does not delay other files.
        }
        await index.ResolveNextAsync(resolver, next);
        Assert.Equal("/api/v1/model-versions/11", handler.Uris[1].AbsolutePath);
        Assert.Equal("resolved", index.Snapshot().Single(e => e.VersionId == 11).State);
    }

    [Fact]
    public async Task CompletedQueueSleepsUntilRefreshAndFailedCommitRemainsScheduled()
    {
        CivitaiLocalFile file = FileModel("one.safetensors", Identity(published: null));
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        System.IO.File.Delete(StorePath);
        Directory.CreateDirectory(StorePath); // Force atomic replacement to fail without touching user data.
        FakeHttp handler = new(_ => Success());
        using HttpClient http = new(handler);
        CivitaiIdentityResolver resolver = new(http);
        await Assert.ThrowsAnyAsync<IOException>(() => index.ResolveNextAsync(resolver, Now));
        Assert.True(index.NextResolutionAt <= Now);
        Directory.Delete(StorePath);
        Assert.True(await index.ResolveNextAsync(resolver, Now));
        Assert.Equal(long.MaxValue, index.NextResolutionAt);
        Assert.False(await index.ResolveNextAsync(resolver, Now + 86400000));
        Assert.Equal(2, handler.Uris.Count);
    }

    [Fact]
    public async Task FailedRefreshIsRetriedAndConcurrentNotificationIsPreserved()
    {
        CivitaiLocalFile file = FileModel("one.safetensors", Identity());
        CivitaiIdentityIndex index = new(StorePath);
        CivitaiRefreshSignal signal = new();
        Directory.CreateDirectory(StorePath);
        await Assert.ThrowsAnyAsync<IOException>(() => signal.ReconcileAsync(() => index.ReconcileAsync([file])));
        Assert.Empty(index.Snapshot());
        Directory.Delete(StorePath);
        await signal.ReconcileAsync(() => index.ReconcileAsync([file]));
        Assert.Single(new CivitaiIdentityIndex(StorePath).Snapshot());
        int calls = 0;
        signal.Request();
        await signal.ReconcileAsync(() => { calls++; signal.Request(); return Task.CompletedTask; });
        await signal.ReconcileAsync(() => { calls++; return Task.CompletedTask; });
        await signal.ReconcileAsync(() => { calls++; return Task.CompletedTask; });
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task LateResolutionCannotAttachToReplacementAndDoesNotRepeatLookup()
    {
        CivitaiLocalFile file = FileModel("one.safetensors", Identity(published: null));
        CivitaiIdentityIndex index = new(StorePath);
        await index.ReconcileAsync([file]);
        FakeHttp handler = new(_ =>
        {
            WriteModel(file.Path, new JObject { ["changed"] = "new physical file" });
            return Success();
        });
        using HttpClient http = new(handler);
        CivitaiIdentityResolver resolver = new(http);
        await index.ResolveNextAsync(resolver, Now);
        Assert.Equal("unknown", Status(Response(index, [file])));
        Assert.False(await index.ResolveNextAsync(resolver, Now + 1000));
        Assert.Single(handler.Uris);
        await index.ReconcileAsync([file]);
        Assert.Null(Assert.Single(index.Snapshot()).VersionId);
    }

    [Fact]
    public void CorruptOrUnknownSchemaStoreIsPreserved()
    {
        Directory.CreateDirectory(root);
        foreach (string bad in new[] { "{broken", "{\"schemaVersion\":99,\"entries\":[]}" })
        {
            System.IO.File.WriteAllText(StorePath, bad);
            Assert.ThrowsAny<Exception>(() => new CivitaiIdentityIndex(StorePath));
            Assert.Equal(bad, System.IO.File.ReadAllText(StorePath));
        }
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"items\":[null]}")]
    [InlineData("{\"items\":[{\"modelId\":\"1\",\"modelVersionId\":2,\"modelType\":\"Checkpoint\"}]}")]
    [InlineData("{\"items\":[{\"modelId\":1,\"modelVersionId\":0,\"modelType\":\"Checkpoint\"}]}")]
    [InlineData("{\"items\":[{\"modelId\":1,\"modelVersionId\":2,\"modelType\":\"VAE\"}]}")]
    [InlineData("{\"items\":[{\"modelId\":1,\"modelVersionId\":2,\"modelType\":\"Checkpoint\",\"publishedAt\":\"2026-01-01\"}]}")]
    [InlineData("{\"items\":[{\"modelId\":1,\"modelVersionId\":2,\"modelType\":\"Checkpoint\",\"publishedAt\":-1}]}")]
    [InlineData("{\"items\":[{\"modelId\":99999999999999999999999999,\"modelVersionId\":2,\"modelType\":\"Checkpoint\"}]}")]
    public void MalformedBatchesAreRejectedWithoutCoercion(string json)
    {
        Assert.False(CivitaiIndexApi.TryParseItems(JObject.Parse(json), out _));
    }

    [Fact]
    public void BatchLimitAndNullPublicationAreExplicit()
    {
        JObject raw = new() { ["items"] = new JArray(Enumerable.Range(0, 500).Select(_ => new JObject
        {
            ["modelId"] = 1, ["modelVersionId"] = 2, ["modelType"] = "LoCon", ["publishedAt"] = null
        })) };
        Assert.True(CivitaiIndexApi.TryParseItems(raw, out CivitaiMatchItem[] items));
        Assert.Equal(500, items.Length);
        Assert.Equal("LoRA", items[0].Subtype);
        Assert.Null(items[0].PublishedAt);
        ((JArray)raw["items"]!).Add(new JObject());
        Assert.False(CivitaiIndexApi.TryParseItems(raw, out _));
        Assert.True(CivitaiIndexApi.TryParseItems(new JObject { ["items"] = new JArray() }, out _));
    }

    private static HttpResponseMessage Success(JArray files = null) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(new JObject
        {
            ["id"] = 10, ["modelId"] = 1, ["publishedAt"] = "2025-01-01T00:00:00Z", ["files"] = files
        }.ToString())
    };

    private sealed class FakeHttp(Func<HttpRequestMessage, HttpResponseMessage> response) : HttpMessageHandler
    {
        public readonly List<Uri> Uris = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Uris.Add(request.RequestUri!);
            Assert.Null(request.Headers.Authorization);
            return Task.FromResult(response(request));
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, true);
        }
    }
}
