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
    /// <summary>Settings file path.</summary>
    private string SettingsFilePath => $"{Program.DataDir}/WhatTheDuckSettings.json";

    public override void OnPreInit()
    {
        ScriptFiles.Add("Assets/whattheduck.js");
        StyleSheetFiles.Add("Assets/whattheduck.css");
    }

    public override void OnInit()
    {
        LoadSettings();

        Logs.Info($"WhatTheDuck Extension initializing (large file threshold: {WildcardHandler.LargeFileSizeThreshold / (1024 * 1024)}MB)...");

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
                if (settings.TryGetValue("largeFileSizeThresholdMB", out JToken thresholdToken))
                {
                    long thresholdMB = thresholdToken.Value<long>();
                    WildcardHandler.LargeFileSizeThreshold = thresholdMB * 1024 * 1024;
                    Logs.Debug($"WhatTheDuck: Loaded settings - threshold: {thresholdMB}MB");
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
                ["largeFileSizeThresholdMB"] = WildcardHandler.LargeFileSizeThreshold / (1024 * 1024)
            };
            File.WriteAllText(SettingsFilePath, settings.ToString());
            Logs.Debug($"WhatTheDuck: Saved settings - threshold: {WildcardHandler.LargeFileSizeThreshold / (1024 * 1024)}MB");
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
            ["largeFileSizeThresholdMB"] = WildcardHandler.LargeFileSizeThreshold / (1024 * 1024)
        };
    }

    /// <summary>API endpoint to save settings.</summary>
    public async Task<JObject> WhatTheDuckSaveSettings(Session session, long largeFileSizeThresholdMB)
    {
        try
        {
            if (largeFileSizeThresholdMB < 1)
            {
                return new JObject
                {
                    ["success"] = false,
                    ["error"] = "Threshold must be at least 1 MB"
                };
            }

            WildcardHandler.LargeFileSizeThreshold = largeFileSizeThresholdMB * 1024 * 1024;
            SaveSettings();

            // Notify wildcard handler that settings changed
            WildcardHandler.OnSettingsChanged();

            Logs.Info($"WhatTheDuck: Settings updated - threshold: {largeFileSizeThresholdMB}MB");

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
