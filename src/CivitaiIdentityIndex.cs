using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.IO;

namespace WhatTheDuck;

/// <summary>Persistent local ownership, with atomic snapshots and no client-created records.</summary>
public sealed class CivitaiIdentityIndex
{
    /// <summary>Protects publication of snapshots; disk IO never holds this lock.</summary>
    private readonly object gate = new();
    /// <summary>Serializes background reconciliation and resolution, including test callers.</summary>
    private readonly SemaphoreSlim work = new(1, 1);
    /// <summary>Extension-owned persistence location.</summary>
    private readonly string path;
    /// <summary>Published immutable records, replaced only after a successful disk commit.</summary>
    private Dictionary<string, CivitaiIdentity> entries = [];
    /// <summary>Opaque revision of the persisted snapshot.</summary>
    private string revision = Guid.NewGuid().ToString("N");
    /// <summary>Whether startup reconciliation has completed.</summary>
    private bool reconciled;
    /// <summary>Persisted global upstream cooldown, including Retry-After.</summary>
    private long resolveAfter;
    /// <summary>Only pending identity groups, ordered by their persisted retry deadlines.</summary>
    private readonly PriorityQueue<CivitaiIdentity[], long> pending = new();
    /// <summary>Successful version results available for copies added later.</summary>
    private readonly Dictionary<long, CivitaiIdentity> resolvedVersions = [];
    /// <summary>Next scheduled resolution, or long.MaxValue when the worker can sleep until refresh.</summary>
    private long nextResolutionAt = long.MaxValue;

    public long NextResolutionAt => Interlocked.Read(ref nextResolutionAt);

    public CivitaiIdentityIndex(string filePath)
    {
        path = filePath;
        if (!File.Exists(path))
        {
            return;
        }
        JObject saved = JObject.Parse(File.ReadAllText(path));
        if (saved.Value<int?>("schemaVersion") != 1 || saved["entries"] is not JArray records)
        {
            throw new InvalidDataException("Unsupported Civitai index schema. Existing file was preserved.");
        }
        CivitaiIdentity[] loaded = records.ToObject<CivitaiIdentity[]>();
        if (loaded.Any(e => e?.Local is null || e.FileStamp is null || e.Hashes is null || e.SidecarStamps is null || e.RejectedSidecarStamps is null
            || e.Local.Subtype is not ("Stable-Diffusion" or "LoRA") || string.IsNullOrEmpty(e.Local.Path)))
        {
            throw new InvalidDataException("Invalid Civitai index. Existing file was preserved.");
        }
        entries = loaded.ToDictionary(e => e.Local.Key);
        revision = saved.Value<string>("indexRevision") ?? revision;
        resolveAfter = saved.Value<long?>("resolveAfter") ?? 0;
        RebuildPending();
    }

    public CivitaiIdentity[] Snapshot()
    {
        lock (gate)
        {
            return entries.Values.ToArray();
        }
    }

    private void Commit(Dictionary<string, CivitaiIdentity> next, long cooldown)
    {
        // Both callers own work, so only publication needs the reader lock.
        string nextRevision = Guid.NewGuid().ToString("N");
        JObject document = new()
        {
            ["schemaVersion"] = 1, ["indexRevision"] = nextRevision, ["resolveAfter"] = cooldown,
            ["entries"] = JArray.FromObject(next.Values)
        };
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (FileStream stream = new(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                byte[] bytes = Encoding.UTF8.GetBytes(document.ToString(Formatting.None));
                stream.Write(bytes);
                stream.Flush(true);
            }
            File.Move(temp, path, true);
            lock (gate)
            {
                entries = next;
                resolveAfter = cooldown;
                revision = nextRevision;
            }
        }
        finally
        {
            if (File.Exists(temp))
            {
                File.Delete(temp);
            }
        }
    }

    private void UpdateNextResolution() => Interlocked.Exchange(ref nextResolutionAt,
        pending.TryPeek(out _, out long due) ? Math.Max(due, resolveAfter) : long.MaxValue);

    private void Schedule(IEnumerable<CivitaiIdentity> group)
    {
        CivitaiIdentity[] remaining = group.Where(e => e.HashPolicyVersion == 1 && e.LookupKey is not null && e.State != "resolved").ToArray();
        if (remaining.Length > 0)
        {
            pending.Enqueue(remaining, remaining.Min(e => e.RetryAt));
        }
    }

    private void RebuildPending()
    {
        pending.Clear();
        resolvedVersions.Clear();
        foreach (CivitaiIdentity entry in entries.Values.Where(e => e.HashPolicyVersion == 1 && e.State == "resolved" && e.VersionId.HasValue))
        {
            resolvedVersions[entry.VersionId.Value] = entry;
        }
        foreach (IGrouping<string, CivitaiIdentity> group in entries.Values.Where(e => e.LookupKey is not null).GroupBy(e => e.LookupKey))
        {
            Schedule(group);
        }
        UpdateNextResolution();
    }

    /// <summary>Runs outside host inventory locks. Drops removed files and rereads changed metadata only.</summary>
    public async Task ReconcileAsync(IReadOnlyList<CivitaiLocalFile> inventory, CancellationToken cancellation = default)
    {
        await work.WaitAsync(cancellation);
        try
        {
            Dictionary<string, CivitaiIdentity> next = [];
            foreach (CivitaiLocalFile local in inventory)
            {
                cancellation.ThrowIfCancellationRequested();
                entries.TryGetValue(local.Key, out CivitaiIdentity previous);
                try
                {
                    // Re-read records poisoned by the previous replacement guard even if their stamps now match.
                    bool missingCachedHash = previous?.State == "unresolved" && previous.Hashes.Count == 0
                        && CivitaiIdentityMetadata.NormalizeHash(local.CachedTensorHash, 64) is not null;
                    CivitaiIdentity current = previous is not null && !missingCachedHash && previous.HashPolicyVersion == 1 && previous.CachedMetadataStamp == local.CachedMetadataStamp && CivitaiIdentityMetadata.IsCurrent(previous)
                        ? previous : CivitaiIdentityMetadata.Read(local, previous);
                    if (current is not null)
                    {
                        next[local.Key] = current;
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // An unreadable or disappearing file cannot prove current ownership.
                }
            }
            if (next.Count != entries.Count || next.Any(pair => !entries.TryGetValue(pair.Key, out CivitaiIdentity old) || !ReferenceEquals(pair.Value, old)))
            {
                Commit(next, resolveAfter);
            }
            RebuildPending();
            lock (gate)
            {
                reconciled = true;
            }
        }
        finally
        {
            work.Release();
        }
    }

    /// <summary>Resolves at most one deduplicated group. Request matching never calls this method.</summary>
    public async Task<bool> ResolveNextAsync(CivitaiIdentityResolver resolver, long now, CancellationToken cancellation = default)
    {
        await work.WaitAsync(cancellation);
        CivitaiIdentity[] selected = null;
        try
        {
            if (now < resolveAfter)
            {
                return false;
            }
            if (!pending.TryPeek(out _, out long due) || due > now)
            {
                return false;
            }
            selected = pending.Dequeue();
            // A stale group is dormant until a real model-list refresh. Never stat it every idle second.
            CivitaiIdentity[] group = selected.Where(CivitaiIdentityMetadata.IsCurrent).ToArray();
            CivitaiIdentity first = group.FirstOrDefault(e => e.RetryAt <= now);
            if (first is null)
            {
                Schedule(group);
                selected = null;
                return false;
            }
            CivitaiIdentity cached = first.VersionId.HasValue ? resolvedVersions.GetValueOrDefault(first.VersionId.Value) : null;
            CivitaiResolution result = cached is not null
                ? new() { ModelId = cached.ModelId, VersionId = cached.VersionId, PublishedAt = cached.PublishedAt, State = "resolved" }
                : await resolver.ResolveAsync(first, now, cancellation);
            Dictionary<string, CivitaiIdentity> next = new(entries);
            List<CivitaiIdentity> updatedEntries = [];
            foreach (CivitaiIdentity entry in group)
            {
                if (!CivitaiIdentityMetadata.IsCurrent(entry))
                {
                    // Keep the old stamp until reconciliation so replacements cannot inherit old sidecars.
                    continue;
                }
                bool conflict = (entry.ModelId.HasValue && result.ModelId.HasValue && entry.ModelId != result.ModelId)
                    || (entry.VersionId.HasValue && result.VersionId.HasValue && entry.VersionId != result.VersionId);
                long? fileId = entry.FileId;
                if (!conflict && result.Files is not null)
                {
                    JObject[] files = result.Files.OfType<JObject>().Where(file => file["hashes"] is JObject fileHashes
                        && entry.Hashes.Any(pair => pair.Key != "TensorSHA256"
                            && CivitaiIdentityMetadata.NormalizeHash(CivitaiIdentityMetadata.Text(fileHashes[pair.Key]), pair.Value.Length) == pair.Value)).ToArray();
                    if (files.Length == 1)
                    {
                        fileId = CivitaiIdentityMetadata.PositiveId(files[0]["id"]);
                    }
                }
                next[entry.Local.Key] = entry with
                {
                    ModelId = conflict ? null : result.ModelId ?? entry.ModelId,
                    VersionId = conflict ? null : result.VersionId ?? entry.VersionId,
                    PublishedAt = conflict ? null : result.PublishedAt ?? entry.PublishedAt,
                    FileId = conflict ? null : fileId,
                    State = conflict ? "conflict" : result.State,
                    Provenance = conflict ? "conflicting_resolver_identity" : result.ModelId.HasValue ? entry.Provenance + ":civitai_" + first.LookupKey.Split('/')[0] : entry.Provenance,
                    Attempts = result.State == "resolved" ? 0 : entry.Attempts + 1,
                    RetryAt = result.RetryAt
                };
                updatedEntries.Add(next[entry.Local.Key]);
            }
            Commit(next, result.GlobalRetryAt);
            foreach (CivitaiIdentity updated in updatedEntries.Where(e => e.State == "resolved" && e.VersionId.HasValue))
            {
                resolvedVersions[updated.VersionId.Value] = updated;
            }
            // Unchanged entries were modified during HTTP and wait for the next refresh instead of retrying.
            Schedule(updatedEntries);
            selected = null;
            return true;
        }
        catch
        {
            if (selected is not null)
            {
                Schedule(selected);
            }
            throw;
        }
        finally
        {
            UpdateNextResolution();
            work.Release();
        }
    }


    /// <summary>Uses in-memory inventory and stats only for candidate matches; performs no scan, hashing or HTTP.</summary>
    public JObject Match(IReadOnlyList<CivitaiMatchItem> items, IReadOnlyList<CivitaiLocalFile> inventory, Func<string, bool> allowed)
    {
        CivitaiIdentity[] snapshot;
        string currentRevision;
        bool ready;
        lock (gate)
        {
            snapshot = entries.Values.ToArray();
            currentRevision = revision;
            ready = reconciled;
        }
        HashSet<string> accessible = inventory.Where(e => allowed(e.Name)).Select(e => e.Key).ToHashSet();
        CivitaiIdentity[] visible = snapshot.Where(e => e.HashPolicyVersion == 1 && accessible.Contains(e.Local.Key)).ToArray();
        HashSet<(string Subtype, long Model)> requested = items.Select(i => (i.Subtype, i.ModelId)).ToHashSet();
        CivitaiIdentity[] candidates = visible.Where(e => e.ModelId.HasValue && e.VersionId.HasValue && requested.Contains((e.Local.Subtype, e.ModelId.Value))).ToArray();
        HashSet<string> stale = candidates.Where(e => !CivitaiIdentityMetadata.IsCurrent(e)).Select(e => e.Local.Key).ToHashSet();
        ILookup<(string, long), CivitaiIdentity> matches = candidates.Where(e => !stale.Contains(e.Local.Key)).ToLookup(e => (e.Local.Subtype, e.ModelId.Value));
        int identified = visible.Count(e => e.ModelId.HasValue && e.VersionId.HasValue && !stale.Contains(e.Local.Key));
        JArray results = [];
        foreach (CivitaiMatchItem item in items)
        {
            CivitaiIdentity[] owned = matches[(item.Subtype, item.ModelId)].ToArray();
            bool exact = owned.Any(e => e.VersionId == item.VersionId);
            bool older = owned.Length > 0 && item.PublishedAt.HasValue && owned.All(e => e.PublishedAt.HasValue && e.PublishedAt < item.PublishedAt);
            string status = exact ? "downloaded" : older ? "older" : owned.Length > 0 ? "different" : "unknown";
            results.Add(new JObject
            {
                ["modelId"] = item.ModelId, ["modelVersionId"] = item.VersionId, ["status"] = status,
                ["ownedVersionIds"] = new JArray(owned.Select(e => e.VersionId.Value).Distinct().Order()),
                ["reason"] = exact ? "exact_version" : older ? "earlier_publication" : owned.Length > 0 ? "different_or_unordered_version" : "no_identified_local_version"
            });
        }
        return new JObject
        {
            ["schemaVersion"] = 1, ["indexRevision"] = currentRevision,
            ["indexState"] = ready && identified == accessible.Count ? "ready" : "partial",
            ["coverage"] = new JObject { ["localFiles"] = accessible.Count, ["identifiedFiles"] = identified, ["unresolvedFiles"] = accessible.Count - identified },
            ["results"] = results
        };
    }
}

/// <summary>Validated client observations; never stored as local identity evidence.</summary>
public sealed record CivitaiMatchItem(long ModelId, long VersionId, string Subtype, long? PublishedAt);
