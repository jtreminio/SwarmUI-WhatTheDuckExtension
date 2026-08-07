using SwarmUI.Accounts;
using SwarmUI.Core;
using SwarmUI.Utils;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.IO;
using System.Text.RegularExpressions;

namespace WhatTheDuck;

/// <summary>API endpoint that dumps a ComfyUI workflow (and the generate-tab payload it was
/// built from) to disk on the machine running SwarmUI, for debugging / archival.</summary>
public static class ComfyWorkflowSaveApi
{
    /// <summary>Directory the dumps are written to, under the SwarmUI data directory.</summary>
    public static string SaveFolder => Path.Combine(Program.DataDir, "WhatTheDuck", "ComfyWorkflows");

    /// <summary>Shortest base64 blob that gets cropped. Anything under this is small enough
    /// to be a real (readable) value rather than embedded binary.</summary>
    public const int MinBase64Length = 128;

    /// <summary>How much of the base64 payload is kept, as a hint of what it was.</summary>
    public const int KeptBase64Chars = 24;

    /// <summary>A data URI, eg <c>data:image/png;base64,iVBOR...</c>, with the header and the payload captured separately.</summary>
    private static readonly Regex DataUriRegex = new($@"(data:[a-zA-Z0-9.+/-]*;base64,)([A-Za-z0-9+/]{{{MinBase64Length},}}={{0,2}})", RegexOptions.Compiled);

    /// <summary>A bare base64 blob (no data-URI header), as SwarmUI passes raw init images.</summary>
    private static readonly Regex BareBase64Regex = new($@"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{{{MinBase64Length},}}={{0,2}}(?![A-Za-z0-9+/=])", RegexOptions.Compiled);

    /// <summary>Crop one base64 blob down to a short, obviously-truncated stand-in that still
    /// shows what it was and how big it was.</summary>
    private static string CropBase64(string base64) =>
        $"{base64[..KeptBase64Chars]}...[truncated, {base64.Length} base64 chars]";

    /// <summary>Replaces every embedded base64 blob (data URIs and bare base64, eg init images
    /// and masks) in <paramref name="text"/> with a cropped stand-in, so dumps stay small and
    /// readable. The result is deliberately no longer decodable.</summary>
    public static string StripBase64(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return text;
        }
        text = DataUriRegex.Replace(text, match => $"{match.Groups[1].Value}{CropBase64(match.Groups[2].Value)}");
        return BareBase64Regex.Replace(text, match => CropBase64(match.Value));
    }

    /// <summary>Walks a parsed JSON tree and crops the base64 out of every string value.</summary>
    private static void StripBase64(JToken token)
    {
        switch (token)
        {
            case JObject obj:
                foreach (JProperty prop in obj.Properties())
                {
                    StripBase64(prop.Value);
                }
                break;
            case JArray array:
                foreach (JToken item in array)
                {
                    StripBase64(item);
                }
                break;
            case JValue value when value.Type == JTokenType.String:
                string str = value.Value<string>();
                string stripped = StripBase64(str);
                if (stripped != str)
                {
                    value.Value = stripped;
                }
                break;
        }
    }

    /// <summary>Pretty-prints <paramref name="raw"/> with embedded base64 cropped out. Text that
    /// isn't valid JSON is still base64-stripped, just left unformatted.</summary>
    public static string CleanForDump(string raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return raw ?? "";
        }
        JToken parsed;
        try
        {
            parsed = JToken.Parse(raw);
        }
        catch (JsonReaderException)
        {
            return StripBase64(raw);
        }
        StripBase64(parsed);
        return parsed.ToString(Formatting.Indented);
    }

    /// <summary>Rewrites a server-side path into the equivalent path on the machine the user
    /// edits files on, eg "/workspace/Data/x.json" to "~/swarm-data/Data/x.json" when SwarmUI
    /// runs in a container. Returns <paramref name="path"/> unchanged when no prefix is configured
    /// or the path sits outside it.</summary>
    public static string MapToLocalPath(string path, string from, string to)
    {
        if (string.IsNullOrEmpty(path) || string.IsNullOrWhiteSpace(from) || string.IsNullOrWhiteSpace(to))
        {
            return path;
        }
        from = from.Trim().TrimEnd('/', '\\');
        to = to.Trim().TrimEnd('/', '\\');
        if (from == "" || !path.StartsWith(from, StringComparison.Ordinal))
        {
            return path;
        }
        string rest = path[from.Length..];
        // Only a whole path segment counts: "/workspace" must not match "/workspaces/x".
        if (rest != "" && rest[0] != '/' && rest[0] != '\\')
        {
            return path;
        }
        return to + rest;
    }

    /// <summary>Timestamp-based file name stem that doesn't collide with an existing dump
    /// (two saves within the same second get a "-2", "-3", ... suffix).</summary>
    private static string PickUniqueStem(string folder, DateTimeOffset now)
    {
        string baseStem = now.ToString("yyyy-MM-dd_HH-mm-ss");
        string stem = baseStem;
        for (int i = 2; File.Exists(Path.Combine(folder, $"{stem}_workflow.json")) || File.Exists(Path.Combine(folder, $"{stem}_payload.json")); i++)
        {
            stem = $"{baseStem}-{i}";
        }
        return stem;
    }

    /// <summary>Writes the request payload sent to <c>ComfyGetGeneratedWorkflow</c> and the ComfyUI
    /// workflow it returned as a pair of JSON files on the server.</summary>
    public static async Task<JObject> WhatTheDuckSaveComfyWorkflow(Session session, string payload, string workflow)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(workflow))
            {
                return new JObject { ["success"] = false, ["error"] = "No workflow to save." };
            }
            string folder = Path.GetFullPath(SaveFolder);
            Directory.CreateDirectory(folder);
            string stem = PickUniqueStem(folder, DateTimeOffset.Now);
            string payloadPath = Path.Combine(folder, $"{stem}_payload.json");
            string workflowPath = Path.Combine(folder, $"{stem}_workflow.json");
            await File.WriteAllTextAsync(payloadPath, CleanForDump(payload));
            await File.WriteAllTextAsync(workflowPath, CleanForDump(workflow));
            Logs.Info($"WhatTheDuck: User {session.User.UserID} saved a Comfy workflow dump to '{folder}' as '{stem}_*.json'.");
            string from = WhatTheDuckExtension.ClipboardPathFrom;
            string to = WhatTheDuckExtension.ClipboardPathTo;
            return new JObject
            {
                ["success"] = true,
                ["folder"] = folder,
                ["payloadFile"] = Path.GetFileName(payloadPath),
                ["workflowFile"] = Path.GetFileName(workflowPath),
                ["payloadPath"] = payloadPath,
                ["workflowPath"] = workflowPath,
                // Where those files live from the user's point of view - what the frontend copies
                // to the clipboard. Same as the real paths unless a path mapping is configured.
                ["payloadLocalPath"] = MapToLocalPath(payloadPath, from, to),
                ["workflowLocalPath"] = MapToLocalPath(workflowPath, from, to)
            };
        }
        catch (Exception ex)
        {
            Logs.Error($"WhatTheDuck SaveComfyWorkflow failed: {ex}");
            return new JObject { ["success"] = false, ["error"] = "Failed to save the workflow to the server." };
        }
    }
}
