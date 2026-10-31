using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Net;
using System.Net.Http;

namespace WhatTheDuck;

/// <summary>Sanitized resolver output. URLs, tokens and descriptions are never persisted.</summary>
public sealed record CivitaiResolution
{
    /// <summary>Established model and version identifiers.</summary>
    public long? ModelId, VersionId;
    /// <summary>Publication time in Unix milliseconds, if supplied by Civitai.</summary>
    public long? PublishedAt;
    /// <summary>File records used only to associate a known local hash with a file ID.</summary>
    public JArray Files;
    /// <summary>Resolution outcome.</summary>
    public string State = "retry";
    /// <summary>Per-identity retry time in Unix milliseconds.</summary>
    public long RetryAt;
    /// <summary>Server-wide cooldown in Unix milliseconds.</summary>
    public long GlobalRetryAt;
}

/// <summary>Resolves local versions or algorithm-qualified hashes through fixed, public Civitai routes.</summary>
public sealed class CivitaiIdentityResolver(HttpClient client)
{
    public async Task<CivitaiResolution> ResolveAsync(CivitaiIdentity entry, long now, CancellationToken cancellation)
    {
        string key = entry.LookupKey;
        if (key is null)
        {
            return new() { State = "unresolved", RetryAt = long.MaxValue };
        }
        string endpoint = entry.VersionId.HasValue ? entry.VersionId.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)
            : "by-hash/" + key.Split('/')[2];
        try
        {
            using HttpRequestMessage request = new(HttpMethod.Get, "https://civitai.red/api/v1/model-versions/" + endpoint);
            request.Headers.UserAgent.ParseAdd("SwarmUI-WhatTheDuck/1.0");
            // These public identity endpoints need no user credentials. Never borrow one user's key for a shared index.
            using HttpResponseMessage response = await client.SendAsync(request, cancellation);
            if (response.StatusCode == HttpStatusCode.TooManyRequests || response.StatusCode == HttpStatusCode.ServiceUnavailable)
            {
                long retry = now + (long)TimeSpan.FromMinutes(1).TotalMilliseconds;
                if (response.Headers.RetryAfter?.Delta is TimeSpan delta)
                {
                    retry = Math.Max(retry, now + (long)delta.TotalMilliseconds);
                }
                else if (response.Headers.RetryAfter?.Date is DateTimeOffset date)
                {
                    retry = Math.Max(retry, date.ToUnixTimeMilliseconds());
                }
                return new() { State = "retry", RetryAt = retry, GlobalRetryAt = retry };
            }
            if (response.StatusCode == HttpStatusCode.NotFound || response.StatusCode == HttpStatusCode.Gone)
            {
                return new() { State = "not_found", RetryAt = now + (long)TimeSpan.FromDays(7).TotalMilliseconds };
            }
            if ((int)response.StatusCode is >= 400 and < 500)
            {
                // Access restrictions and invalid resources must not stall unrelated local identities.
                return new() { State = "unresolved", RetryAt = now + (long)TimeSpan.FromDays(1).TotalMilliseconds };
            }
            if (!response.IsSuccessStatusCode)
            {
                return Failure(entry, now);
            }
            JObject body = JObject.Parse(await response.Content.ReadAsStringAsync(cancellation));
            long? model = CivitaiIdentityMetadata.PositiveId(body["modelId"]);
            long? version = CivitaiIdentityMetadata.PositiveId(body["id"]);
            if (!model.HasValue || !version.HasValue)
            {
                return Failure(entry, now, false);
            }
            return new()
            {
                ModelId = model, VersionId = version,
                PublishedAt = CivitaiIdentityMetadata.Publication(body["publishedAt"]),
                Files = body["files"] as JArray, State = "resolved"
            };
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            return Failure(entry, now);
        }
        catch (HttpRequestException)
        {
            return Failure(entry, now);
        }
        catch (JsonException)
        {
            return Failure(entry, now, false);
        }
    }

    private static CivitaiResolution Failure(CivitaiIdentity entry, long now, bool global = true)
    {
        long retry = now + (long)TimeSpan.FromMinutes(Math.Min(360, Math.Pow(2, Math.Min(entry.Attempts, 9)))).TotalMilliseconds;
        // A transient outage must not cause one failing request per local model.
        return new() { State = "retry", RetryAt = retry, GlobalRetryAt = global ? retry : 0 };
    }
}
