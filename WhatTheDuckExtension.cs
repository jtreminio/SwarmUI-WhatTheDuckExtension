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

    /// <summary>Whether values resolved by prompt setvar tags should have leading
    /// and trailing whitespace removed before they are stored for the generation.</summary>
    public static bool TrimPromptVariables { get; set; }

    /// <summary>Server-side path prefix rewritten out of the Comfy workflow dump paths that get
    /// copied to the clipboard, eg "/workspace" when SwarmUI runs in a container.</summary>
    public static string ClipboardPathFrom { get; set; } = "";

    /// <summary>What <see cref="ClipboardPathFrom"/> is replaced with, ie where that directory
    /// lives on the machine the user actually edits files on.</summary>
    public static string ClipboardPathTo { get; set; } = "";

    /// <summary>Architecture-to-folder mappings, as an array of
    /// { architectures, baseFolder, checkpointFolder, loraFolder } objects, where architectures
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

        Logs.Info("WhatTheDuck Extension initializing...");

        PromptVariableTrimming.Register();

        API.RegisterAPICall(WhatTheDuckGetSettings, false, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(WhatTheDuckSaveSettings, true, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(PromptEditApi.WhatTheDuckEditPrompt, true, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(ModelDownloadApi.WhatTheDuckDownloadModelWS, true, Permissions.DownloadModels);
        API.RegisterAPICall(ArchDetectionApi.WhatTheDuckDetectModelArch, false, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(ComfyWorkflowSaveApi.WhatTheDuckSaveComfyWorkflow, true, Permissions.FundamentalGenerateTabAccess);
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
                if (settings.TryGetValue("trimPromptVariables", out JToken trimPromptVariablesToken))
                {
                    TrimPromptVariables = trimPromptVariablesToken.Value<bool>();
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
                ["trimPromptVariables"] = TrimPromptVariables,
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
                ["baseFolder"] = obj["baseFolder"]?.Type == JTokenType.String && obj.Value<string>("baseFolder") == "diffusion_models" ? "diffusion_models" : "Stable-Diffusion",
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
            ["trimPromptVariables"] = TrimPromptVariables,
            ["clipboardPathFrom"] = ClipboardPathFrom,
            ["clipboardPathTo"] = ClipboardPathTo,
            // Swarm's own base path, offered as the Server Path Prefix placeholder since dumps
            // are written under it.
            ["serverRootPath"] = Environment.CurrentDirectory,
            ["archFolderMappings"] = ArchFolderMappings,
            ["architectures"] = ArchDetectionApi.ListArchitectures()
        };
    }

    public async Task<JObject> WhatTheDuckSaveSettings(Session session, bool keyboardNavigationEnabled, bool trimPromptVariables = false, string archFolderMappings = null, string clipboardPathFrom = "", string clipboardPathTo = "")
    {
        try
        {
            KeyboardNavigationEnabled = keyboardNavigationEnabled;
            TrimPromptVariables = trimPromptVariables;
            ClipboardPathFrom = clipboardPathFrom?.Trim() ?? "";
            ClipboardPathTo = clipboardPathTo?.Trim() ?? "";
            // Null means the caller didn't send the field; don't wipe saved mappings.
            if (archFolderMappings is not null)
            {
                ArchFolderMappings = SanitizeArchMappings(JArray.Parse(string.IsNullOrWhiteSpace(archFolderMappings) ? "[]" : archFolderMappings));
            }
            SaveSettings();
            Logs.Info($"WhatTheDuck: Settings updated - keyboard navigation: {keyboardNavigationEnabled}, trim prompt variables: {trimPromptVariables}");

            return new JObject
            {
                ["success"] = true
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

    #endregion
}
