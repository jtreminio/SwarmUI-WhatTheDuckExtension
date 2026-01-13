using FreneticUtilities.FreneticExtensions;
using SwarmUI.Core;
using SwarmUI.Text2Image;
using SwarmUI.Utils;
using System.IO;

namespace WhatTheDuck;

/// <summary>
/// Handles wildcard processing for WhatTheDuck extension.
/// Provides optimized handling for large wildcard files using lazy loading.
/// </summary>
public static class WildcardHandler
{
    /// <summary>Threshold in bytes above which a wildcard file is considered "large" and uses lazy loading.</summary>
    public static long LargeFileSizeThreshold = 5;

    /// <summary>Store the original wildcard processor so we can delegate to it for small files.</summary>
    private static Func<string, T2IPromptHandling.PromptTagContext, string> OriginalWildcardProcessor;

    /// <summary>Store the original length estimator.</summary>
    private static Func<string, T2IPromptHandling.PromptTagContext, string> OriginalLengthEstimator;

    /// <summary>
    /// Initializes the wildcard handler by capturing original processors and installing overrides.
    /// </summary>
    public static void Initialize()
    {
        if (T2IPromptHandling.PromptTagProcessors.TryGetValue("wildcard", out var origProcessor))
        {
            OriginalWildcardProcessor = origProcessor;
        }
        if (T2IPromptHandling.PromptTagLengthEstimators.TryGetValue("wildcard", out var origEstimator))
        {
            OriginalLengthEstimator = origEstimator;
        }

        T2IPromptHandling.PromptTagProcessors["wildcard"] = WildcardProcessor;
        T2IPromptHandling.PromptTagProcessors["wc"] = WildcardProcessor;
        T2IPromptHandling.PromptTagLengthEstimators["wildcard"] = WildcardLengthEstimator;
        T2IPromptHandling.PromptTagLengthEstimators["wc"] = WildcardLengthEstimator;

        // Hook into the model refresh event to clear our cache
        Program.ModelRefreshEvent += LazyWildcardManager.ClearCache;
    }

    /// <summary>
    /// Shuts down the wildcard handler, unhooking events.
    /// </summary>
    public static void Shutdown()
    {
        Program.ModelRefreshEvent -= LazyWildcardManager.ClearCache;
    }

    /// <summary>
    /// Called when settings change to clear cached data.
    /// </summary>
    public static void OnSettingsChanged()
    {
        LazyWildcardManager.ClearCache();
    }

    /// <summary>Checks if a wildcard file is considered "large" based on file size.</summary>
    public static bool IsLargeWildcard(string card)
    {
        string filePath = $"{WildcardsHelper.Folder}/{card}.txt";
        try
        {
            FileInfo fileInfo = new(filePath);
            return fileInfo.Exists && fileInfo.Length >= LargeFileSizeThreshold * 1024 * 1024;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Custom wildcard processor that handles large files efficiently.</summary>
    private static string WildcardProcessor(string data, T2IPromptHandling.PromptTagContext context)
    {
        data = context.Parse(data);
        string[] dataParts = data.SplitFast(',', 1);
        string wildcardName = dataParts[0];

        string card = T2IParamTypes.GetBestInList(wildcardName, WildcardsHelper.ListFiles);
        if (card is null)
        {
            context.TrackWarning($"Wildcard input '{wildcardName}' does not match any wildcard file and will be ignored.");
            return null;
        }

        if (IsLargeWildcard(card))
        {
            string filePath = $"{WildcardsHelper.Folder}/{card}.txt";
            return ProcessLargeWildcard(data, dataParts, card, filePath, context);
        }

        return OriginalWildcardProcessor(data, context);
    }

    /// <summary>Process a large wildcard file using lazy line indexing.</summary>
    private static string ProcessLargeWildcard(
        string data,
        string[] dataParts,
        string card,
        string filePath,
        T2IPromptHandling.PromptTagContext context)
    {
        HashSet<string> exclude = [];
        if (dataParts.Length > 1 && dataParts[1].StartsWithFast("not="))
        {
            exclude.UnionWith(T2IPromptHandling.SplitSmart(dataParts[1].After('=')));
        }

        (int count, string partSeparator) = T2IPromptHandling.InterpretPredataForRandom("random", context.PreData, data, context);
        if (partSeparator is null)
        {
            return null;
        }

        if (data.Length < card.Length)
        {
            Logs.Warning($"Wildcard input '{data}' is not a valid wildcard name, but appears to match '{card}', will use that instead.");
        }

        List<string> usedWildcards = context.Input.ExtraMeta.GetOrCreate("used_wildcards", () => new List<string>()) as List<string>;
        usedWildcards.Add(card);

        LazyWildcard lazyWildcard = LazyWildcardManager.GetOrCreate(card, filePath);

        if (lazyWildcard.LineCount == 0)
        {
            return "";
        }

        string result = "";
        HashSet<int> usedIndices = [];

        for (int i = 0; i < count; i++)
        {
            int index;
            string choice;
            int attempts = 0;
            const int maxAttempts = 1000;

            do
            {
                if (context.Input.Get(T2IParamTypes.WildcardSeedBehavior, "Random") == "Index")
                {
                    index = context.Input.GetWildcardSeed() % lazyWildcard.LineCount;
                }
                else
                {
                    index = context.Input.GetWildcardRandom().Next(lazyWildcard.LineCount);
                }

                choice = lazyWildcard.GetLine(index);
                attempts++;

                if (attempts >= maxAttempts)
                {
                    break;
                }
            }
            while ((exclude.Contains(choice) || usedIndices.Contains(index)) && attempts < maxAttempts);

            usedIndices.Add(index);
            result += context.Parse(choice).Trim() + partSeparator;
        }

        return result.Trim();
    }

    /// <summary>Custom length estimator for wildcards.</summary>
    private static string WildcardLengthEstimator(string data, T2IPromptHandling.PromptTagContext context)
    {
        string card = T2IParamTypes.GetBestInList(data.Before(','), WildcardsHelper.ListFiles);
        if (card is null)
        {
            return "";
        }

        if (IsLargeWildcard(card))
        {
            // For large files, we can't efficiently compute max length
            // Return a reasonable placeholder
            return "[large wildcard]";
        }

        return OriginalLengthEstimator(data, context);
    }
}
