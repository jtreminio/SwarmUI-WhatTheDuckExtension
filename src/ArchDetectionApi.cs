using FreneticUtilities.FreneticExtensions;
using Newtonsoft.Json.Linq;
using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using SwarmUI.WebAPI;
using System.IO;
using System.Net.Http;

namespace WhatTheDuck;

/// <summary>Identifies a remote model file's architecture by fetching only its metadata header
/// and running SwarmUI's <see cref="T2IModelClassSorter"/> against it.</summary>
public static class ArchDetectionApi
{
    /// <summary>Same cap SwarmUI's own header reader applies to a safetensors header length.</summary>
    public const long MaxSafetensorsHeader = 100 * 1024 * 1024;

    /// <summary>GGUF doesn't declare a header length up front; fetch at most this much.</summary>
    public const long GgufFetchCap = 32 * 1024 * 1024;

    /// <summary>All compat-class IDs SwarmUI can detect, sorted — the values the settings UI offers.</summary>
    public static JArray ListArchitectures()
    {
        List<string> ids = [];
        foreach (T2IModelClass clazz in T2IModelClassSorter.ModelClasses.Values)
        {
            string id = clazz.CompatClass?.ID;
            if (id is not null && !ids.Contains(id))
            {
                ids.Add(id);
            }
        }
        ids.Sort(StringComparer.OrdinalIgnoreCase);
        return [.. ids];
    }

    /// <summary>API route: fetch a remote model file's header and identify its architecture.
    /// Failures are routine, so they return <c>success: false</c> with a <c>reason</c> rather than
    /// an <c>error</c> key (which would raise an error popup in the SwarmUI frontend).</summary>
    public static async Task<JObject> WhatTheDuckDetectModelArch(Session session, string url)
    {
        static JObject failed(string reason) => new() { ["success"] = false, ["reason"] = reason };
        string tempPath = null;
        try
        {
            url = (url ?? "").Trim().Before('#');
            if (!url.StartsWith("https://") && !url.StartsWith("http://"))
            {
                return failed("URL must start with http:// or https://");
            }
            if (url.StartsWith("https://civitai.com/"))
            {
                url = $"https://civitai.red/{url["https://civitai.com/".Length..]}";
            }
            if (url.StartsWith("https://civitai.red/"))
            {
                string civitaiApiKey = session.User.GetGenericData("civitai_api", "key");
                if (!string.IsNullOrEmpty(civitaiApiKey) && !url.Contains("?token=") && !url.Contains("&token="))
                {
                    url += (url.Contains('?') ? "&token=" : "?token=") + ModelsAPI.TokenTextLimiter.TrimToMatches(civitaiApiKey);
                }
            }
            using HttpRequestMessage request = new(HttpMethod.Get, url);
            if (url.StartsWith("https://huggingface.co/"))
            {
                string hfApiKey = session.User.GetGenericData("huggingface_api", "key");
                if (!string.IsNullOrEmpty(hfApiKey))
                {
                    request.Headers.Add("Authorization", $"Bearer {ModelsAPI.TokenTextLimiter.TrimToMatches(hfApiKey)}");
                }
            }
            using HttpResponseMessage response = await Utilities.UtilWebClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, Program.GlobalProgramCancel);
            if (!response.IsSuccessStatusCode)
            {
                return failed($"Remote server responded {(int)response.StatusCode} {response.StatusCode}");
            }
            using Stream stream = await response.Content.ReadAsStreamAsync(Program.GlobalProgramCancel);
            byte[] prefix = new byte[8];
            await stream.ReadExactlyAsync(prefix, 0, 8, Program.GlobalProgramCancel);
            // Sniff from content, not the URL: civitai download URLs have no file extension.
            bool isGguf = prefix[0] == 'G' && prefix[1] == 'G' && prefix[2] == 'U' && prefix[3] == 'F';
            tempPath = Path.Combine(Path.GetTempPath(), $"whattheduck-archprobe-{Guid.NewGuid():N}.{(isGguf ? "gguf" : "safetensors")}");
            using (FileStream file = File.Create(tempPath))
            {
                await file.WriteAsync(prefix, Program.GlobalProgramCancel);
                if (isGguf)
                {
                    await CopyUpTo(stream, file, GgufFetchCap);
                }
                else
                {
                    long headerLen = BitConverter.ToInt64(prefix, 0);
                    if (headerLen <= 0 || headerLen > MaxSafetensorsHeader)
                    {
                        return failed("File does not look like a safetensors or GGUF model");
                    }
                    if (await CopyUpTo(stream, file, headerLen) < headerLen)
                    {
                        return failed("Remote file ended before the full metadata header arrived");
                    }
                }
            }
            JObject header = T2IModel.GetMetadataHeaderFrom(tempPath);
            string name = url.Before('?').AfterLast('/');
            T2IModel model = new(null, null, tempPath, string.IsNullOrWhiteSpace(name) ? "remote-model" : name);
            T2IModelClass clazz = T2IModelClassSorter.IdentifyClassFor(model, header, "Stable-Diffusion");
            if (clazz is null)
            {
                return failed("Fetched the model header, but the architecture is not one SwarmUI recognizes");
            }
            return new JObject
            {
                ["success"] = true,
                ["archId"] = clazz.ID,
                ["archName"] = clazz.Name,
                ["compatClass"] = clazz.CompatClass?.ID,
                ["isLora"] = clazz.IsLora
            };
        }
        catch (SwarmReadableErrorException ex)
        {
            return failed(ex.Message);
        }
        catch (EndOfStreamException)
        {
            return failed("Remote file's metadata section is larger than the probe limit or the file is truncated");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            Logs.Debug($"WhatTheDuck: arch detection request failed for '{url}': {ex.Message}");
            return failed($"Could not fetch the remote file: {ex.Message}");
        }
        finally
        {
            if (tempPath is not null)
            {
                try
                {
                    File.Delete(tempPath);
                }
                catch (Exception) { }
            }
        }
    }

    /// <summary>Copy up to <paramref name="maxBytes"/>, returning how many bytes actually arrived.</summary>
    private static async Task<long> CopyUpTo(Stream source, Stream dest, long maxBytes)
    {
        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        while (total < maxBytes)
        {
            int toRead = (int)Math.Min(buffer.Length, maxBytes - total);
            int read = await source.ReadAsync(buffer.AsMemory(0, toRead), Program.GlobalProgramCancel);
            if (read <= 0)
            {
                break;
            }
            await dest.WriteAsync(buffer.AsMemory(0, read), Program.GlobalProgramCancel);
            total += read;
        }
        return total;
    }
}
