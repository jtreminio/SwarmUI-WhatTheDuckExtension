using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Buffers.Binary;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace WhatTheDuck;

/// <summary>A local inventory entry. Remote inventories and output hash overrides are never included.</summary>
public sealed record CivitaiLocalFile(string Subtype, string Name, string Path,
    [property: JsonIgnore] string CachedTensorHash = null,
    [property: JsonIgnore] string CachedDescription = null,
    [property: JsonIgnore] long CachedFileVersion = 0)
{
    [JsonIgnore]
    public string Key => Subtype + "\n" + Name + "\n" + Path;

    [JsonIgnore]
    public string CachedMetadataStamp => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{CachedFileVersion}\n{CachedTensorHash}\n{CachedDescription}")));
}

/// <summary>Immutable-by-convention persistent identity evidence for one physical file.</summary>
public sealed record CivitaiIdentity
{
    /// <summary>Inventory location, including the absolute path to disambiguate model roots.</summary>
    public CivitaiLocalFile Local;
    /// <summary>Physical file stamp; used for invalidation, never as ownership evidence.</summary>
    public string FileStamp;
    /// <summary>Digest of host metadata inputs, excluding their content from persistence.</summary>
    public string CachedMetadataStamp;
    /// <summary>Metadata file stamps; used to discover edits independently of host metadata caches.</summary>
    public Dictionary<string, string> SidecarStamps = [];
    /// <summary>Sidecars left behind by a replacement, excluded until their content stamp changes.</summary>
    public Dictionary<string, string> RejectedSidecarStamps = [];
    /// <summary>Civitai model, version and optional physical file identifiers.</summary>
    public long? ModelId, VersionId, FileId;
    /// <summary>Established version publication time in Unix milliseconds, not creation time.</summary>
    public long? PublishedAt;
    /// <summary>Algorithm-qualified hashes. TensorSHA256 is never a whole-file SHA256.</summary>
    public Dictionary<string, string> Hashes = [];
    /// <summary>Version of the policy requiring hashes from Swarm's existing metadata cache. Zero identifies older records.</summary>
    public int HashPolicyVersion;
    /// <summary>Origin of the identity evidence.</summary>
    public string Provenance = "none";
    /// <summary>Resolution state: pending, resolved, unresolved, conflict, retry, or not_found.</summary>
    public string State = "unresolved";
    /// <summary>Number of failed resolution attempts.</summary>
    public int Attempts;
    /// <summary>Next permitted resolution attempt in Unix milliseconds.</summary>
    public long RetryAt;

    [JsonIgnore]
    public string LookupKey => State == "conflict" ? null : VersionId is > 0 ? $"version/{VersionId}"
        : HashPolicyVersion == 1 && Hashes.TryGetValue("TensorSHA256", out string tensor)
            && CivitaiIdentityMetadata.NormalizeHash(tensor, 64) is string normalized ? $"hash/AutoV3/{normalized[..12]}" : null;
}

/// <summary>Reads bounded metadata without hashing tensor bytes or modifying model files.</summary>
public static class CivitaiIdentityMetadata
{
    /// <summary>Same suffixes and precedence as Swarm's metadata loader.</summary>
    private static readonly string[] Suffixes = [".swarm.json", ".json", ".cm-info.json", ".civitai.info"];
    /// <summary>Bound metadata reads to avoid loading model contents as JSON.</summary>
    private const int MaxMetadataBytes = 16 * 1024 * 1024;
    /// <summary>Only Swarm's leading provenance link qualifies; description links do not.</summary>
    private static readonly Regex SourceLink = new("\\A\\s*From\\s+<a\\s+href=[\"'](?<url>[^\"']+)[\"']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    public static string Stamp(string path)
    {
        FileInfo info = new(path);
        return info.Exists ? $"{info.Length}:{info.LastWriteTimeUtc.Ticks}:{info.CreationTimeUtc.Ticks}" : null;
    }

    public static Dictionary<string, string> Sidecars(string path) => Suffixes.ToDictionary(suffix => suffix,
        suffix => Stamp(System.IO.Path.ChangeExtension(path, null) + suffix));

    public static bool IsCurrent(CivitaiIdentity entry)
    {
        try
        {
            return entry.FileStamp is not null && Stamp(entry.Local.Path) == entry.FileStamp
                && Sidecars(entry.Local.Path).All(pair => entry.SidecarStamps.TryGetValue(pair.Key, out string stamp) && stamp == pair.Value);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public static CivitaiIdentity Read(CivitaiLocalFile local, CivitaiIdentity previous = null)
    {
        CivitaiIdentity entry = new() { Local = local, FileStamp = Stamp(local.Path), SidecarStamps = Sidecars(local.Path), CachedMetadataStamp = local.CachedMetadataStamp, HashPolicyVersion = 1 };
        entry.RejectedSidecarStamps = previous is null ? [] : new(previous.RejectedSidecarStamps);
        if (entry.FileStamp is null)
        {
            return null;
        }
        List<(JObject Data, string Source)> sources = [];
        string extension = System.IO.Path.GetExtension(local.Path).ToLowerInvariant();
        if (extension is ".safetensors" or ".sft")
        {
            try
            {
                using FileStream stream = File.OpenRead(local.Path);
                byte[] size = new byte[8];
                stream.ReadExactly(size);
                long length = BinaryPrimitives.ReadInt64LittleEndian(size);
                if (length > 0 && length <= MaxMetadataBytes && length <= stream.Length - 8)
                {
                    byte[] header = new byte[(int)length];
                    stream.ReadExactly(header);
                    JObject data = JObject.Parse(Encoding.UTF8.GetString(header));
                    sources.Add((data["__metadata__"] as JObject ?? new(), "embedded_metadata"));
                }
            }
            catch (Exception ex) when (ex is IOException or JsonException) { }
        }
        foreach ((string suffix, string stamp) in entry.SidecarStamps)
        {
            // A replacement must not inherit identity from an unchanged sidecar belonging to the old file.
            if (previous is not null && previous.FileStamp != entry.FileStamp && stamp is not null
                && previous.SidecarStamps.GetValueOrDefault(suffix) == stamp)
            {
                entry.RejectedSidecarStamps[suffix] = stamp;
            }
            if (stamp is null || entry.RejectedSidecarStamps.GetValueOrDefault(suffix) == stamp)
            {
                continue;
            }
            entry.RejectedSidecarStamps.Remove(suffix);
            string path = System.IO.Path.ChangeExtension(local.Path, null) + suffix;
            try
            {
                if (new FileInfo(path).Length <= MaxMetadataBytes)
                {
                    sources.Add((JObject.Parse(File.ReadAllText(path)), "sidecar" + suffix));
                }
            }
            catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { }
        }
        // Hashes come exclusively from Swarm's existing cache, validated against the physical file.
        // Never compute missing model hashes or import hashes directly from headers, sidecars, or Civitai.
        if (local.CachedFileVersion == new DateTimeOffset(File.GetLastWriteTimeUtc(local.Path)).ToUnixTimeMilliseconds())
        {
            JObject cached = new();
            string tensor = NormalizeHash(local.CachedTensorHash, 64);
            if (tensor is not null && extension is ".safetensors" or ".sft")
            {
                entry.Hashes["TensorSHA256"] = tensor;
                entry.Hashes["AutoV3"] = tensor[..12];
            }
            if ((previous is null || previous.FileStamp == entry.FileStamp) && entry.RejectedSidecarStamps.Count == 0
                && !sources.Any(s => s.Data["modelspec.description"] is not null || s.Data["description"] is not null))
            {
                cached["modelspec.description"] = local.CachedDescription;
            }
            sources.Add((cached, "host_metadata_cache"));
        }
        foreach ((JObject data, string source) in sources)
        {
            long? model = PositiveId(data["modelId"]) ?? PositiveId(data["ModelId"]);
            long? version = PositiveId(data["modelVersionId"]) ?? PositiveId(data["VersionId"]);
            if (model.HasValue && (data["files"] is JArray || data["model"] is JObject || source == "sidecar.civitai.info"))
            {
                version ??= PositiveId(data["id"]);
            }
            if (model.HasValue && version.HasValue)
            {
                SetIdentity(entry, model.Value, version.Value, source, Publication(data["publishedAt"]));
            }
        }
        // Structured IDs have priority over the leading legacy source URL.
        if (entry.VersionId is null && entry.State != "conflict")
        {
            foreach ((JObject data, string source) in sources)
            {
                (long Model, long Version)? ids = ParseSource(Text(data["modelspec.description"]) ?? Text(data["description"]));
                if (ids.HasValue)
                {
                    SetIdentity(entry, ids.Value.Model, ids.Value.Version, source + ":source_link", null);
                }
            }
        }
        if (!IsCurrent(entry))
        {
            return null; // The file or its metadata changed during the read.
        }
        if (entry.State != "conflict")
        {
            entry.State = entry.VersionId.HasValue && entry.PublishedAt.HasValue ? "resolved" : entry.LookupKey is null ? "unresolved" : "pending";
        }
        return entry;
    }

    private static void SetIdentity(CivitaiIdentity entry, long model, long version, string source, long? publication)
    {
        if (entry.State == "conflict")
        {
            return;
        }
        if ((entry.ModelId.HasValue && entry.ModelId != model) || (entry.VersionId.HasValue && entry.VersionId != version))
        {
            entry.ModelId = entry.VersionId = entry.PublishedAt = null;
            entry.State = "conflict";
            entry.Provenance = "conflicting_metadata";
            return;
        }
        entry.ModelId = model;
        entry.VersionId = version;
        entry.PublishedAt = publication ?? entry.PublishedAt;
        entry.Provenance = source;
    }

    public static (long Model, long Version)? ParseSource(string description)
    {
        if (string.IsNullOrEmpty(description))
        {
            return null;
        }
        Match match = SourceLink.Match(description);
        if (!match.Success || !Uri.TryCreate(System.Net.WebUtility.HtmlDecode(match.Groups["url"].Value), UriKind.Absolute, out Uri uri)
            || uri.Scheme != "https" || (uri.Host != "civitai.com" && uri.Host != "civitai.red"))
        {
            return null;
        }
        string[] path = uri.AbsolutePath.Trim('/').Split('/');
        if (path.Length < 2 || path[0] != "models" || !long.TryParse(path[1], out long model) || model <= 0)
        {
            return null;
        }
        string[] values = uri.Query.TrimStart('?').Split('&').Where(p => p.StartsWith("modelVersionId=", StringComparison.Ordinal)).ToArray();
        return values.Length == 1 && long.TryParse(values[0][15..], out long version) && version > 0 ? (model, version) : null;
    }

    public static string Text(JToken value) => value?.Type == JTokenType.String ? value.Value<string>() : null;

    public static long? PositiveId(JToken value) => value?.Type is JTokenType.Integer or JTokenType.String
        && long.TryParse(value.ToString(), out long id) && id > 0 ? id : null;

    public static long? Publication(JToken value)
    {
        if (value?.Type == JTokenType.Date)
        {
            return new DateTimeOffset(value.Value<DateTime>().ToUniversalTime()).ToUnixTimeMilliseconds();
        }
        return value?.Type == JTokenType.String
            && DateTimeOffset.TryParse(value.Value<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out DateTimeOffset date)
            ? date.ToUnixTimeMilliseconds() : null;
    }

    public static string NormalizeHash(string value, int length)
    {
        value = value?.Trim();
        if (value?.StartsWith("0x", StringComparison.OrdinalIgnoreCase) == true)
        {
            value = value[2..];
        }
        return value?.Length == length && value.All(Uri.IsHexDigit) ? value.ToUpperInvariant() : null;
    }
}
