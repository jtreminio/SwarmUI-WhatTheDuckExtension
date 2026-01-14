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

    public override void OnPreInit()
    {
        ScriptFiles.Add("Assets/whattheduck.js");
        ScriptFiles.Add("Assets/keyboard-navigation.js");
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
                ["datadumpFolder"] = DatadumpManager.DatadumpFolder
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

    #endregion

    #region API Endpoints

    public async Task<JObject> WhatTheDuckGetSettings(Session session)
    {
        return new JObject
        {
            ["success"] = true,
            ["keyboardNavigationEnabled"] = KeyboardNavigationEnabled,
            ["datadumpEnabled"] = DatadumpManager.Enabled,
            ["datadumpFolder"] = DatadumpManager.DatadumpFolder,
            ["datadumpCount"] = DatadumpManager.Count,
            ["datadumpActive"] = DatadumpManager.IsActive,
            ["modifiedPlaceholders"] = new JArray(DatadumpManager.GetModifiedPlaceholders())
        };
    }

    public async Task<JObject> WhatTheDuckSaveSettings(Session session, bool keyboardNavigationEnabled, bool datadumpEnabled = false, string datadumpFolder = "")
    {
        try
        {
            KeyboardNavigationEnabled = keyboardNavigationEnabled;
            DatadumpManager.Enabled = datadumpEnabled;
            DatadumpManager.DatadumpFolder = datadumpFolder ?? "";
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

    public async Task<JObject> WhatTheDuckRefreshDatadump(Session session)
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
