using SwarmUI.WebAPI;

namespace WhatTheDuck;

/// <summary>Shared authentication for model probes and downloads, including SwarmUI
/// versions without the Session argument on Utilities.DownloadFile. Callers must not log the returned URL.</summary>
public static class ModelDownloadAuth
{
    public static (string Url, Dictionary<string, string> Headers) Prepare(string url, Func<string, string> getApiKey)
    {
        Dictionary<string, string> headers = [];
        if (url.StartsWith("https://civitai.com/"))
        {
            url = $"https://civitai.red/{url["https://civitai.com/".Length..]}";
        }
        if (url.StartsWith("https://civitai.red/"))
        {
            string key = getApiKey("civitai_api");
            if (!string.IsNullOrEmpty(key) && !url.Contains("?token=") && !url.Contains("&token="))
            {
                url += (url.Contains('?') ? "&token=" : "?token=") + ModelsAPI.TokenTextLimiter.TrimToMatches(key);
            }
        }
        else if (url.StartsWith("https://huggingface.co/"))
        {
            string key = getApiKey("huggingface_api");
            if (!string.IsNullOrEmpty(key))
            {
                headers["Authorization"] = $"Bearer {ModelsAPI.TokenTextLimiter.TrimToMatches(key)}";
            }
        }
        return (url, headers);
    }
}
