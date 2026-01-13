using SwarmUI.Core;
using SwarmUI.Utils;
using SwarmUI.WebAPI;
using SwarmUI.Accounts;
using Newtonsoft.Json.Linq;
using System.IO;

namespace WhatTheDuck;

/// <summary>
/// WhatTheDuck Extension
/// </summary>
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

        Logs.Info($"WhatTheDuck Extension initializing (large file threshold: {WildcardHandler.LargeFileSizeThreshold}MB)...");

        WildcardHandler.Initialize();

        API.RegisterAPICall(WhatTheDuckGetSettings, false, Permissions.FundamentalGenerateTabAccess);
        API.RegisterAPICall(WhatTheDuckSaveSettings, true, Permissions.FundamentalGenerateTabAccess);
    }

    public override void OnShutdown()
    {
        WildcardHandler.Shutdown();
    }

    #region Settings Management

    /// <summary>Loads settings from the settings file.</summary>
    private void LoadSettings()
    {
        try
        {
            if (File.Exists(SettingsFilePath))
            {
                string json = File.ReadAllText(SettingsFilePath);
                JObject settings = JObject.Parse(json);
                if (settings.TryGetValue("largeFileSizeThreshold", out JToken thresholdToken))
                {
                    WildcardHandler.LargeFileSizeThreshold = thresholdToken.Value<long>();
                }
                if (settings.TryGetValue("keyboardNavigationEnabled", out JToken keyboardNavToken))
                {
                    KeyboardNavigationEnabled = keyboardNavToken.Value<bool>();
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

    /// <summary>Saves settings to the settings file.</summary>
    private void SaveSettings()
    {
        try
        {
            JObject settings = new()
            {
                ["largeFileSizeThreshold"] = WildcardHandler.LargeFileSizeThreshold,
                ["keyboardNavigationEnabled"] = KeyboardNavigationEnabled
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

    /// <summary>API endpoint to get current settings.</summary>
    public async Task<JObject> WhatTheDuckGetSettings(Session session)
    {
        return new JObject
        {
            ["success"] = true,
            ["largeFileSizeThreshold"] = WildcardHandler.LargeFileSizeThreshold,
            ["keyboardNavigationEnabled"] = KeyboardNavigationEnabled
        };
    }

    /// <summary>API endpoint to save settings.</summary>
    public async Task<JObject> WhatTheDuckSaveSettings(Session session, long largeFileSizeThreshold, bool keyboardNavigationEnabled)
    {
        try
        {
            if (largeFileSizeThreshold < 1)
            {
                return new JObject
                {
                    ["success"] = false,
                    ["error"] = "Threshold must be at least 1 MB"
                };
            }

            WildcardHandler.LargeFileSizeThreshold = largeFileSizeThreshold;
            KeyboardNavigationEnabled = keyboardNavigationEnabled;
            SaveSettings();
            WildcardHandler.OnSettingsChanged();

            Logs.Info($"WhatTheDuck: Settings updated - threshold: {largeFileSizeThreshold}MB, keyboard navigation: {keyboardNavigationEnabled}");

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
