using SwarmUI.Core;
using SwarmUI.Utils;
using SwarmUI.WebAPI;
using SwarmUI.Accounts;
using Newtonsoft.Json.Linq;
using System.IO;

namespace WhatTheDuck;

public class WhatTheDuckExtension : Extension
{
    private string SettingsFilePath => $"{Program.DataDir}/WhatTheDuckSettings.json";

    public static bool KeyboardNavigationEnabled { get; set; } = true;

    /// <summary>Server-side path prefix rewritten out of the Comfy workflow dump paths that get
    /// copied to the clipboard, eg "/workspace" when SwarmUI runs in a container.</summary>
    public static string ClipboardPathFrom { get; set; } = "";

    /// <summary>What <see cref="ClipboardPathFrom"/> is replaced with, ie where that directory
    /// lives on the machine the user actually edits files on.</summary>
    public static string ClipboardPathTo { get; set; } = "";

    /// <summary>Architecture-to-folder mappings, as an array of
    /// { architectures, checkpointFolder, loraFolder } objects, where architectures
    /// holds SwarmUI compat-class IDs (e.g. "flux-1", "stable-diffusion-xl-v1").</summary>
    public static JArray ArchFolderMappings { get; set; } = [];

    public override void OnPreInit()
    {
        ScriptFiles.Add("Assets/whattheduck.js");
        StyleSheetFiles.Add("Assets/whattheduck.css");
    }

    public override void OnInit()
    {
        LoadSettings();

        string datadumpStatus = DatadumpManager.IsActive
            ? $"enabled, folder: {DatadumpManager.DatadumpFolder}"
            : "disabled";
        Logs.Info($"WhatTheDuck Extension initializing (datadump: {datadumpStatus})...");

        DatadumpManager.Initialize();
        WildcardHandler.Initialize();

        API.RegisterAPICall(WhatTheDuckGetSettings, false, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(WhatTheDuckSaveSettings, true, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(WhatTheDuckRefreshDatadump, true, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(PromptEditApi.WhatTheDuckEditPrompt, true, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(ArchDetectionApi.WhatTheDuckDetectModelArch, false, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(ComfyWorkflowSaveApi.WhatTheDuckSaveComfyWorkflow, true, Permissions.FundamentalGenerateTabAccess);
    }

    public override void OnShutdown()
    {
        DatadumpManager.Shutdown();
        WildcardHandler.Shutdown();
    }

    #region Settings Management

    private void LoadSettings()
    {
        try
        {
            if (File.Exists(SettingsFilePath))
            {
                string json = File.ReadAllText(SettingsFilePath);
                JObject settings = JObject.Parse(json);
                if (settings.TryGetValue("keyboardNavigationEnabled", out JToken keyboardNavToken))
                {
                    KeyboardNavigationEnabled = keyboardNavToken.Value<bool>();
                }
                if (settings.TryGetValue("datadumpEnabled", out JToken datadumpEnabledToken))
                {
                    DatadumpManager.Enabled = datadumpEnabledToken.Value<bool>();
                }
                if (settings.TryGetValue("datadumpFolder", out JToken datadumpFolderToken))
                {
                    DatadumpManager.DatadumpFolder = datadumpFolderToken.Value<string>();
                }
                if (settings.TryGetValue("clipboardPathFrom", out JToken clipboardFromToken))
                {
                    ClipboardPathFrom = clipboardFromToken.Value<string>() ?? "";
                }
                if (settings.TryGetValue("clipboardPathTo", out JToken clipboardToToken))
                {
                    ClipboardPathTo = clipboardToToken.Value<string>() ?? "";
                }
                if (settings.TryGetValue("archFolderMappings", out JToken archMappingsToken) && archMappingsToken is JArray archMappings)
                {
                    ArchFolderMappings = SanitizeArchMappings(archMappings);
                }

                foreach (var setting in settings.Properties())
                {
                    Logs.Debug($"WhatTheDuck: Loaded setting - {setting.Name}: {setting.Value}");
                }
            }
        }
        catch (Exception ex)
        {
            Logs.Warning($"WhatTheDuck: Failed to load settings: {ex.Message}");
        }
    }

    private void SaveSettings()
    {
        try
        {
            JObject settings = new()
            {
                ["keyboardNavigationEnabled"] = KeyboardNavigationEnabled,
                ["datadumpEnabled"] = DatadumpManager.Enabled,
                ["datadumpFolder"] = DatadumpManager.DatadumpFolder,
                ["clipboardPathFrom"] = ClipboardPathFrom,
                ["clipboardPathTo"] = ClipboardPathTo,
                ["archFolderMappings"] = ArchFolderMappings
            };
            File.WriteAllText(SettingsFilePath, settings.ToString());   

            foreach (var setting in settings.Properties())
            {
                Logs.Debug($"WhatTheDuck: Saved setting - {setting.Name}: {setting.Value}");
            }
        }
        catch (Exception ex)
        {
            Logs.Warning($"WhatTheDuck: Failed to save settings: {ex.Message}");
        }
    }

    /// <summary>Filter an untrusted mappings array down to well-formed rows:
    /// at least one architecture plus at least one folder, all values trimmed.</summary>
    private static JArray SanitizeArchMappings(JArray raw)
    {
        JArray result = [];
        foreach (JToken token in raw)
        {
            if (token is not JObject obj)
            {
                continue;
            }
            JArray architectures = [];
            if (obj["architectures"] is JArray archArray)
            {
                foreach (JToken archToken in archArray)
                {
                    string value = archToken.Type == JTokenType.String ? archToken.Value<string>().Trim() : "";
                    if (value != "" && !architectures.Any(t => t.Value<string>() == value))
                    {
                        architectures.Add(value);
                    }
                }
            }
            string checkpointFolder = obj.Value<string>("checkpointFolder")?.Trim() ?? "";
            string loraFolder = obj.Value<string>("loraFolder")?.Trim() ?? "";
            if (architectures.Count == 0 || (checkpointFolder == "" && loraFolder == ""))
            {
                continue;
            }
            result.Add(new JObject
            {
                ["architectures"] = architectures,
                ["checkpointFolder"] = checkpointFolder,
                ["loraFolder"] = loraFolder
            });
        }
        return result;
    }

    #endregion

    #region API Endpoints

    public async Task<JObject> WhatTheDuckGetSettings(Session _)
    {
        return new JObject
        {
            ["success"] = true,
            ["keyboardNavigationEnabled"] = KeyboardNavigationEnabled,
            ["datadumpEnabled"] = DatadumpManager.Enabled,
            ["datadumpFolder"] = DatadumpManager.DatadumpFolder,
            ["datadumpCount"] = DatadumpManager.Count,
            ["datadumpActive"] = DatadumpManager.IsActive,
            ["modifiedPlaceholders"] = new JArray(DatadumpManager.GetModifiedPlaceholders()),
            ["clipboardPathFrom"] = ClipboardPathFrom,
            ["clipboardPathTo"] = ClipboardPathTo,
            // Swarm's own base path, offered as the Server Path Prefix placeholder since dumps
            // are written under it.
            ["serverRootPath"] = Environment.CurrentDirectory,
            ["archFolderMappings"] = ArchFolderMappings,
            ["architectures"] = ArchDetectionApi.ListArchitectures()
        };
    }

    public async Task<JObject> WhatTheDuckSaveSettings(Session session, bool keyboardNavigationEnabled, bool datadumpEnabled = false, string datadumpFolder = "", string archFolderMappings = null, string clipboardPathFrom = "", string clipboardPathTo = "")
    {
        try
        {
            KeyboardNavigationEnabled = keyboardNavigationEnabled;
            DatadumpManager.Enabled = datadumpEnabled;
            DatadumpManager.DatadumpFolder = datadumpFolder ?? "";
            ClipboardPathFrom = clipboardPathFrom?.Trim() ?? "";
            ClipboardPathTo = clipboardPathTo?.Trim() ?? "";
            // Null means the caller didn't send the field; don't wipe saved mappings.
            if (archFolderMappings is not null)
            {
                ArchFolderMappings = SanitizeArchMappings(JArray.Parse(string.IsNullOrWhiteSpace(archFolderMappings) ? "[]" : archFolderMappings));
            }
            DatadumpManager.SyncPlaceholders();
            SaveSettings();
            WildcardHandler.OnSettingsChanged();

            string datadumpStatus = DatadumpManager.IsActive
                ? $"enabled, folder: {DatadumpManager.DatadumpFolder}"
                : "disabled";
            Logs.Info($"WhatTheDuck: Settings updated - datadump: {datadumpStatus}, keyboard navigation: {keyboardNavigationEnabled}");

            return new JObject
            {
                ["success"] = true,
                ["datadumpActive"] = DatadumpManager.IsActive,
                ["datadumpCount"] = DatadumpManager.Count
            };
        }
        catch (Exception ex)
        {
            return new JObject
            {
                ["success"] = false,
                ["error"] = ex.Message
            };
        }
    }

    public async Task<JObject> WhatTheDuckRefreshDatadump(Session _)
    {
        var (success, fileCount, message, error) = DatadumpManager.Refresh();

        if (success)
        {
            var modifiedPlaceholders = DatadumpManager.GetModifiedPlaceholders();

            return new JObject
            {
                ["success"] = true,
                ["datadumpCount"] = fileCount,
                ["message"] = message,
                ["modifiedPlaceholders"] = new JArray(modifiedPlaceholders)
            };
        }

        return new JObject
        {
            ["success"] = false,
            ["error"] = error
        };
    }

    #endregion
}
