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

    /// <summary>Civitai architecture-to-folder mappings, as an array of
    /// { architecture, checkpointFolder, loraFolder } objects.</summary>
    public static JArray CivitaiFolderMappings { get; set; } = [];

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
                if (settings.TryGetValue("civitaiFolderMappings", out JToken civitaiMappingsToken) && civitaiMappingsToken is JArray civitaiMappings)
                {
                    CivitaiFolderMappings = SanitizeCivitaiMappings(civitaiMappings);
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
                ["civitaiFolderMappings"] = CivitaiFolderMappings
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
    /// at least one architecture plus at least one folder, all values trimmed.
    /// Accepts both the current `architectures` array shape and the legacy
    /// single-string `architecture` key (pre-multi-select settings files),
    /// always emitting the array shape.</summary>
    private static JArray SanitizeCivitaiMappings(JArray raw)
    {
        JArray result = [];
        foreach (JToken token in raw)
        {
            if (token is not JObject obj)
            {
                continue;
            }
            JArray architectures = [];
            void AddArchitecture(string value)
            {
                value = value?.Trim() ?? "";
                if (value != "" && !architectures.Any(t => t.Value<string>() == value))
                {
                    architectures.Add(value);
                }
            }
            if (obj["architectures"] is JArray archArray)
            {
                foreach (JToken archToken in archArray)
                {
                    AddArchitecture(archToken.Type == JTokenType.String ? archToken.Value<string>() : null);
                }
            }
            AddArchitecture(obj.Value<string>("architecture"));
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
            ["civitaiFolderMappings"] = CivitaiFolderMappings
        };
    }

    public async Task<JObject> WhatTheDuckSaveSettings(Session session, bool keyboardNavigationEnabled, bool datadumpEnabled = false, string datadumpFolder = "", string civitaiFolderMappings = null)
    {
        try
        {
            KeyboardNavigationEnabled = keyboardNavigationEnabled;
            DatadumpManager.Enabled = datadumpEnabled;
            DatadumpManager.DatadumpFolder = datadumpFolder ?? "";
            // Null means the caller didn't send the field; don't wipe saved mappings.
            if (civitaiFolderMappings is not null)
            {
                CivitaiFolderMappings = SanitizeCivitaiMappings(JArray.Parse(string.IsNullOrWhiteSpace(civitaiFolderMappings) ? "[]" : civitaiFolderMappings));
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
